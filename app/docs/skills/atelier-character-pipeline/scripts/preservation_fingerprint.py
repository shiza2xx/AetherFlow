"""Content fingerprints shared by trusted Blender preservation tools/checks."""
import array, base64, hashlib, json, math, os, struct, sys, zlib
from functools import wraps
try:
    import numpy as _np
except ImportError:
    _np=None

def _digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

def _mat4(matrix):
    return [[round(float(v),8) for v in row] for row in matrix]

def animation_fingerprint():
    """Fingerprint action data, bindings, NLA and armature object/rest transforms."""
    bpy=__import__('bpy');bpy.context.view_layer.update()
    actions=[]
    for action in sorted(list(bpy.data.actions),key=lambda x:x.name):
        layers=[]
        for layer in action.layers:
            strips=[]
            for strip in layer.strips:
                bags=[]
                for bag in getattr(strip,'channelbags',[]):
                    curves=[]
                    for curve in bag.fcurves:
                        keys=[]
                        for point in curve.keyframe_points:
                            keys.append({'co':[round(float(v),7) for v in point.co], 'interpolation':point.interpolation,
                                'easing':getattr(point,'easing',None),'handleLeft':[round(float(v),7) for v in point.handle_left],
                                'handleRight':[round(float(v),7) for v in point.handle_right],
                                'handleLeftType':point.handle_left_type,'handleRightType':point.handle_right_type})
                        modifiers=[]
                        for modifier in curve.modifiers:
                            props={}
                            for prop in modifier.bl_rna.properties:
                                if prop.is_readonly or prop.identifier in ('rna_type','type'): continue
                                try:
                                    value=getattr(modifier,prop.identifier)
                                    if isinstance(value,(str,int,float,bool)): props[prop.identifier]=value
                                    elif hasattr(value,'__len__') and len(value)<=16: props[prop.identifier]=[round(float(x),7) for x in value]
                                except Exception: pass
                            modifiers.append({'type':modifier.type,'properties':props})
                        curves.append({'dataPath':curve.data_path,'arrayIndex':curve.array_index,'group':curve.group.name if curve.group else None,'keys':keys,'modifiers':modifiers})
                    bags.append({'slot':getattr(getattr(bag,'slot',None),'identifier',None),'curves':sorted(curves,key=lambda x:(x['dataPath'],x['arrayIndex']))})
                strips.append({'type':strip.type,'channelbags':bags})
            layers.append({'name':layer.name,'strips':strips})
        slots=[{'identifier':getattr(s,'identifier',None),'name':getattr(s,'name_display',getattr(s,'name',None)),'targetIdType':getattr(s,'target_id_type',None)} for s in action.slots]
        actions.append({'name':action.name,'layers':layers,'slots':slots})
    bindings=[]
    for obj in sorted(bpy.context.scene.objects,key=lambda x:(x.type,x.name)):
        ad=obj.animation_data
        if not ad: continue
        tracks=[]
        for track in ad.nla_tracks:
            tracks.append({'name':track.name,'mute':track.mute,'solo':track.is_solo,'strips':[{'name':s.name,'action':s.action.name if s.action else None,'frameStart':round(float(s.frame_start),6),'frameEnd':round(float(s.frame_end),6),'actionFrameStart':round(float(s.action_frame_start),6),'actionFrameEnd':round(float(s.action_frame_end),6),'scale':round(float(s.scale),7),'repeat':round(float(s.repeat),7),'blendType':s.blend_type,'influence':round(float(s.influence),7)} for s in track.strips]})
        bindings.append({'object':obj.name,'type':obj.type,'action':ad.action.name if ad.action else None,'slot':getattr(getattr(ad,'action_slot',None),'identifier',None),'nla':tracks})
    armatures=[]
    for obj in sorted((x for x in bpy.context.scene.objects if x.type=='ARMATURE'),key=lambda x:x.name):
        armatures.append({'object':obj.name,'world':_mat4(obj.matrix_world),'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'rest':_mat4(b.matrix_local)} for b in obj.data.bones]})
    payload={'actions':actions,'bindings':bindings,'armatures':armatures}
    return {'fingerprint':_digest(payload),'payload':payload}

def sampled_animation_state(frame_map=None,time_mapping='scene-relative'):
    """Sample every action slot compatible with each scene armature.

    Evaluation is isolated from NLA and the user's currently active action. All
    temporary bindings, track states and frame state are restored even when a
    clip cannot be evaluated. Without an explicit frame map, this captures the
    exporter's integer-frame bake boundaries only. It does not assert exact
    authored subframe-key or interpolation preservation; those remain covered
    by editable-source fingerprints and a format limitation.
    """
    bpy=__import__('bpy'); scene=bpy.context.scene; result=[]; old_frame=scene.frame_current; old_sub=scene.frame_subframe
    saved=[]
    try:
        for obj in sorted(bpy.context.scene.objects,key=lambda x:x.name):
            ad=obj.animation_data
            if obj.type!='ARMATURE':continue
            if ad:
                saved.append((ad,ad.action,ad.action_slot,ad.use_nla,[track.mute for track in ad.nla_tracks]))
                ad.use_nla=False
                for track in ad.nla_tracks: track.mute=True
            for action in sorted(bpy.data.actions,key=lambda x:x.name):
                slots=[slot for slot in action.slots if getattr(slot,'target_id_type',None)=='OBJECT']
                if not slots: continue
                # Actions with an object slot are required clips for the armature
                # when their curves target pose bones or the armature object.
                candidate_slots=[]
                for slot in slots:
                    curves=[]
                    for layer in action.layers:
                        for strip in layer.strips:
                            for bag in getattr(strip,'channelbags',[]):
                                if bag.slot_handle==slot.handle: curves.extend(list(bag.fcurves))
                    if curves and any(c.data_path.startswith(('pose.bones[','location','rotation_','scale')) for c in curves):
                        candidate_slots.append((slot,curves))
                for slot,curves in candidate_slots:
                    obj.animation_data_create(); ad=obj.animation_data
                    # Avoid silently sampling a stale or differently bound slot.
                    ad.action=action;ad.action_slot=slot;ad.use_nla=False
                    key=(obj.name,action.name,slot.identifier)
                    source_slot=None;action_time_mapping=time_mapping
                    if frame_map is not None:
                        mapped_values=frame_map.get(key)
                        frame_values=mapped_values
                        if frame_values is None:
                            source_bindings=[(source_key,values) for source_key,values in frame_map.items() if source_key[:2]==key[:2]]
                            if len(source_bindings)>1:raise ValueError('Animation action has an ambiguous source-to-imported slot mapping: '+repr(key[:2]))
                            if source_bindings:source_slot=source_bindings[0][0][2];frame_values=source_bindings[0][1];mapped_values=frame_values
                        else:source_slot=key[2]
                        if isinstance(mapped_values,dict) and 'timesSeconds' in mapped_values:
                            action_time_mapping=mapped_values.get('timeMapping',time_mapping)
                            fps=float(scene.render.fps)/max(1e-12,float(scene.render.fps_base))
                            if action_time_mapping=='gltf-absolute-frame':frame_values=[float(t)*fps for t in mapped_values['timesSeconds']]
                            else:frame_values=[float(scene.frame_start)+float(t)*fps for t in mapped_values['timesSeconds']]
                        else:frame_values=sorted(set(float(x) for x in (frame_values or [])))
                    else:
                        times={float(point.co[0]) for curve in curves for point in curve.keyframe_points}
                        ordered=sorted(times)
                        # Blender's GLTF exporter bakes animation at integer
                        # frame boundaries. Keep this coverage faithful to that
                        # serialized representation; authored subframe keys
                        # are preserved in the editable source package and are
                        # not claimed as equivalent baked samples here.
                        baked_frames=range(math.floor(ordered[0]),math.ceil(ordered[-1])+1) if ordered else []
                        frame_values=[float(frame) for frame in baked_frames]
                    sampled_frames=[]; pose_bytes=bytearray(); bone_names=None
                    for frame in frame_values:
                        base=math.floor(frame);scene.frame_set(base,subframe=frame-base);bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(deps)
                        if bone_names is None: bone_names=sorted(bone.name for bone in evaluated.pose.bones)
                        pose_by_name={bone.name:bone for bone in evaluated.pose.bones}
                        for name in bone_names:
                            pose=evaluated.matrix_world@pose_by_name[name].matrix
                            pose_bytes.extend(struct.pack('<16f',*(float(pose[r][c]) for r in range(4) for c in range(4))))
                        sampled_frames.append(round(frame,6))
                    fps=float(scene.render.fps)/max(1e-12,float(scene.render.fps_base));frame_start=float(scene.frame_start)
                    sample_times=[round(frame/fps,8) if action_time_mapping=='gltf-absolute-frame' else round((frame-frame_start)/fps,8) for frame in sampled_frames]
                    result.append({'object':obj.name,'action':action.name,'slot':slot.identifier,'sourceSlot':source_slot,'boneNames':bone_names or [],'frames':sampled_frames,'sampleTimesSeconds':sample_times,'timeMapping':action_time_mapping,'fps':fps,'fpsBase':float(scene.render.fps_base),'frameStart':frame_start,'sampling':'integer baked frames; authored subframe interpolation is not asserted',
                        'poseDataZlibF32':base64.b64encode(zlib.compress(bytes(pose_bytes),6)).decode('ascii')})
    finally:
        for ad,action,slot,use_nla,mutes in reversed(saved):
            ad.action=action
            if action and slot:
                try: ad.action_slot=slot
                except (TypeError,RuntimeError): pass
            ad.use_nla=use_nla
            for track,mute in zip(ad.nla_tracks,mutes): track.mute=mute
        scene.frame_set(old_frame,subframe=old_sub)
    return result

_IMAGE_FINGERPRINT_CACHE={}
_IMAGE_FINGERPRINT_STATS={'imagesHashed':0,'uniqueImages':0,'hashPasses':0,'cacheHits':0,'seconds':0.0,'pixels':0}
IMAGE_FINGERPRINT_VERSION=6
_CAPTURE_GENERATION=0
_RAW_IMAGE_PAYLOAD_CACHE={}
_READ_ONLY_CAPTURE_DEPTH=0

def _material_render_settings(material):
    settings={}
    for identifier in ('blend_method','surface_render_method','alpha_threshold','use_backface_culling','show_transparent_back','use_nodes','diffuse_color','roughness','metallic','specular_color','specular_intensity'):
        if not hasattr(material,identifier):continue
        value=getattr(material,identifier)
        try:settings[identifier]=[round(float(x),8) for x in value]
        except (TypeError,ValueError):
            try:settings[identifier]=round(float(value),8)
            except (TypeError,ValueError):settings[identifier]=str(value)
    return settings

def read_only_image_capture(function):
    """Give one public verification capture a fresh, immutable image snapshot.

    Nested graph/component readers share this generation. Separate public
    calls start a new generation so in-place datablock edits cannot reuse an
    earlier digest keyed only by Blender's stable image pointer.
    """
    @wraps(function)
    def wrapped(*args,**kwargs):
        global _READ_ONLY_CAPTURE_DEPTH
        outer=_READ_ONLY_CAPTURE_DEPTH==0
        if outer:clear_image_fingerprint_cache()
        _READ_ONLY_CAPTURE_DEPTH+=1
        try:return function(*args,**kwargs)
        finally:_READ_ONLY_CAPTURE_DEPTH-=1
    return wrapped

@read_only_image_capture
def material_graph_snapshot(material, include_image_pixels=True):
    """Capture Blender's graph without lossy socket-name keyed dictionaries.

    Socket order/identifier is the stable identity within a Blender node type;
    duplicate display names remain distinct. This is evidence data, never code.
    """
    if not material:return None
    if not material.use_nodes:
        return {'name':material.name,'nodes':[],'links':[],'settings':_material_render_settings(material),
            'diffuse':[round(float(x),8) for x in material.diffuse_color],
            'roughness':round(float(material.roughness),8),
            'metallic':round(float(material.metallic),8), 'schemaVersion':2}
    tree=material.node_tree;nodes=[];links=[]
    connected=set();pending=[n for n in tree.nodes if n.bl_idname=='ShaderNodeOutputMaterial' and n.is_active_output]
    while pending:
        current=pending.pop()
        if current in connected:continue
        connected.add(current)
        pending.extend(link.from_node for link in tree.links if link.to_node==current)
    for node_index,node in enumerate(tree.nodes):
        def socket_rows(sockets):
            rows=[]
            for index,socket in enumerate(sockets):
                value=None
                if hasattr(socket,'default_value'):
                    raw=socket.default_value
                    try:value=[round(float(x),8) for x in raw]
                    except (TypeError,ValueError):
                        try:value=round(float(raw),8)
                        except (TypeError,ValueError):value=str(raw)
                rows.append({'index':index,'identifier':getattr(socket,'identifier',''),
                    'name':socket.name,'type':getattr(socket,'bl_idname',''),
                    'enabled':bool(getattr(socket,'enabled',True)),
                    'hideValue':bool(getattr(socket,'hide_value',False)),
                    'default':value})
            return rows
        props={}
        for identifier in ('operation','blend_type','data_type','clamp','interpolation_type',
                           'vector_type','space','distribution','projection','extension',
                           'use_clamp','invert','mode','uv_map'):
            if hasattr(node,identifier):
                val=getattr(node,identifier)
                if isinstance(val,(str,int,float,bool)):props[identifier]=val
        image=getattr(node,'image',None)
        image_proof=None
        if image:
            image_proof={'name':image.name,'source':image.source,'size':[int(x) for x in image.size],
                'channels':int(image.channels),'colorspace':image.colorspace_settings.name,
                'packed':bool(image.packed_file)}
            if node in connected:
                payload_key=(_CAPTURE_GENERATION,int(image.as_pointer()))
                payload=_RAW_IMAGE_PAYLOAD_CACHE.get(payload_key)
                if payload is None and image.packed_file:
                    packed=bytes(image.packed_file.data);payload={'payloadBytes':len(packed),'payloadSHA256':hashlib.sha256(packed).hexdigest()};del packed
                elif payload is None and image.source=='FILE':
                    filepath=os.path.realpath(__import__('bpy').path.abspath(image.filepath))
                    if not os.path.isfile(filepath):raise ValueError('Connected image dependency is unavailable: '+image.name)
                    digest=hashlib.sha256();size=0
                    with open(filepath,'rb') as stream:
                        for block in iter(lambda:stream.read(1024*1024),b''):size+=len(block);digest.update(block)
                    payload={'payloadBytes':size,'payloadSHA256':digest.hexdigest()}
                if payload is not None:
                    _RAW_IMAGE_PAYLOAD_CACHE[payload_key]=payload;image_proof.update(payload)
            if include_image_pixels and node in connected:
                image_proof['content']=image_pixel_fingerprint(image)
        nodes.append({'index':node_index,'name':node.name,'type':node.bl_idname,
            'inputs':socket_rows(node.inputs),'outputs':socket_rows(node.outputs),
            'properties':props,'activeOutput':bool(getattr(node,'is_active_output',False)),
            'image':image_proof})
    indices={node:index for index,node in enumerate(tree.nodes)}
    for link in tree.links:
        links.append({'fromNode':indices[link.from_node],
            'fromSocket':next(i for i,s in enumerate(link.from_node.outputs) if s==link.from_socket),
            'fromIdentifier':getattr(link.from_socket,'identifier',''),
            'toNode':indices[link.to_node],
            'toSocket':next(i for i,s in enumerate(link.to_node.inputs) if s==link.to_socket),
            'toIdentifier':getattr(link.to_socket,'identifier','')})
    settings=_material_render_settings(material)
    return {'schemaVersion':2,'name':material.name,'settings':settings,'nodes':nodes,'links':links}

def clear_image_fingerprint_cache():
    """Start a new read-only content snapshot, invalidating pointer/content caches."""
    global _CAPTURE_GENERATION
    _CAPTURE_GENERATION+=1
    _IMAGE_FINGERPRINT_CACHE.clear()
    _RAW_IMAGE_PAYLOAD_CACHE.clear()
    _IMAGE_FINGERPRINT_STATS.update(imagesHashed=0,uniqueImages=0,hashPasses=0,cacheHits=0,seconds=0.0,pixels=0)

@read_only_image_capture
def image_channel_fingerprints(image, required_components=()):
    """Hash pixel content in bounded blocks; never create full-image Python lists/JSON."""
    if not image or min(image.size)<1:
        label=getattr(image,'name','<missing>') if image else '<missing>'
        raise ValueError('Material image is missing or undecodable: '+str(label)+' ('+str(list(image.size) if image else 'no datablock')+')')
    if image.source!='FILE' and image.source!='GENERATED': raise ValueError('Material image source is unsupported.')
    width,height=(int(image.size[0]),int(image.size[1]));channels=int(image.channels)
    if channels<1 or channels>4:raise ValueError('Material image channel count is unsupported.')
    colorspace=image.colorspace_settings.name
    key=(_CAPTURE_GENERATION,int(image.as_pointer()),image.name,width,height,channels,image.source,colorspace,str(getattr(image,'filepath_raw','')))
    requested_full=not required_components
    required=set(int(x) for x in required_components)
    if any(x<0 or x>=channels for x in required):raise ValueError('Requested image component is outside its channel count.')
    cached=_IMAGE_FINGERPRINT_CACHE.get(key)
    needed_request=set(range(channels)) if requested_full else required
    if cached is not None and (not requested_full or 'pixels' in cached) and needed_request.issubset(set(cached.get('components',{}))):
        _IMAGE_FINGERPRINT_STATS['cacheHits']+=1
        return cached
    started=__import__('time').perf_counter()
    count=width*height;pixels=image.pixels;full=hashlib.sha256() if requested_full and (cached is None or 'pixels' not in cached) else None
    old_components=(set(cached.get('components',{})) if cached else set())
    # Fingerprint only channels actually consumed by Principled BSDF inputs.
    needed=needed_request-old_components
    components={component:hashlib.sha256() for component in needed}
    float_count=count*channels
    contiguous_bytes=float_count*4
    if contiguous_bytes<=1_500_000_000:
        # Blender RNA iteration materializes millions of Python floats. Its
        # foreach_get path fills a packed float buffer in C (an 8K RGBA image
        # takes ~0.1s to copy); hashes and channel gathers then stay in C too.
        # This is bounded to one image buffer, which is released after its final
        # material user by validate_workflow.py.
        values=array.array('f',[0.0])*float_count
        pixels.foreach_get(values)
        if sys.byteorder!='little':values.byteswap()
        if _np is not None:
            finite=bool(_np.isfinite(_np.frombuffer(values,dtype=_np.float32)).all())
        else:
            finite=all(math.isfinite(float(x)) for x in values)
        if not finite:raise ValueError('Material image contains non-finite pixels.')
        if full:full.update(memoryview(values).cast('B'))
        # Keep each strided gather below 1 MiB, even for 8K and larger maps.
        texels_per_chunk=max(1,262144//channels)
        for first in range(0,count,texels_per_chunk):
            stop=min(count,first+texels_per_chunk)
            for component,digest in components.items():
                selected=values[first*channels+component:stop*channels:channels]
                if sys.byteorder!='little':selected.byteswap()
                digest.update(memoryview(selected).cast('B'))
        del values
    else:
        # Oversized images retain a strictly bounded compatibility path rather
        # than allocating a multi-gigabyte contiguous copy.
        texels_per_chunk=max(1,262144//channels)
        for first in range(0,count,texels_per_chunk):
            stop=min(count,first+texels_per_chunk);block=pixels[first*channels:stop*channels]
            values=array.array('f',block)
            if sys.byteorder!='little':values.byteswap()
            if full:full.update(memoryview(values).cast('B'))
            if _np is not None:
                finite=bool(_np.isfinite(_np.frombuffer(values,dtype=_np.float32)).all())
            else:
                finite=all(math.isfinite(float(x)) for x in values)
            if not finite:raise ValueError('Material image contains non-finite pixels.')
            for component,digest in components.items():
                selected=values[component::channels]
                if sys.byteorder!='little':selected.byteswap()
                digest.update(memoryview(selected).cast('B'))
    result=dict(cached or {})
    result.update({'size':[width,height],'channels':channels,'colorspace':colorspace,
        'fingerprintVersion':IMAGE_FINGERPRINT_VERSION})
    if full:result['pixels']=full.hexdigest()
    result['components']={**result.get('components',{}),**{i:components[i].hexdigest() for i in components}}
    was_known=key in _IMAGE_FINGERPRINT_CACHE
    _IMAGE_FINGERPRINT_CACHE[key]=result
    _IMAGE_FINGERPRINT_STATS['imagesHashed']+=1
    _IMAGE_FINGERPRINT_STATS['hashPasses']+=1
    if not was_known:_IMAGE_FINGERPRINT_STATS['uniqueImages']+=1
    _IMAGE_FINGERPRINT_STATS['seconds']+=__import__('time').perf_counter()-started
    _IMAGE_FINGERPRINT_STATS['pixels']+=count
    return result

@read_only_image_capture
def image_pixel_fingerprint(image, colorspace=None):
    result=image_channel_fingerprints(image)
    return {'size':result['size'],'channels':result['channels'],'colorspace':colorspace or result['colorspace'],
        'pixels':result['pixels'],'components':{str(k):v for k,v in result.get('components',{}).items()},'fingerprintVersion':IMAGE_FINGERPRINT_VERSION}

@read_only_image_capture
def image_component_fingerprint(image, component, colorspace=None):
    components={'Red':0,'Green':1,'Blue':2,'Alpha':3,'R':0,'G':1,'B':2,'A':3}
    index=components.get(component)
    if index is None:raise ValueError('Unsupported PBR image component selector: '+str(component))
    result=image_channel_fingerprints(image,[index])
    return {'size':result['size'],'colorspace':colorspace or result['colorspace'],'component':component,
        'pixels':result['components'][index],'fingerprintVersion':IMAGE_FINGERPRINT_VERSION}

