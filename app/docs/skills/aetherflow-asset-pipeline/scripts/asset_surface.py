"""Deterministic asset inventory, face partition, foliage and export operations.
Run only with --background --factory-startup --disable-autoexec --threads 1.
Configuration is supplied by the AetherFlow service and all files are operation-owned.
"""
import hashlib, json, math, struct, sys, traceback, time
from pathlib import Path
import bpy
from mathutils import Matrix
sys.path.insert(0,str(Path(__file__).resolve().parent))
from asset_mesh_helpers import components, split_component
from asset_safe_import import safe_import

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()
def outfile(root,name):
    result=(root/name).resolve()
    if result.parent!=root or result.exists(): raise ValueError('Unsafe or existing output path.')
    return result
def export_selected(objects,file,format):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    if format=='fbx': bpy.ops.export_scene.fbx(filepath=str(file),use_selection=True,object_types={'MESH'},use_mesh_modifiers=False,add_leaf_bones=False,bake_anim=False,path_mode='COPY',embed_textures=True)
    else: bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,export_extras=True)
def ensure_mask(glb,only_foliage=False):
    raw=glb.read_bytes();magic,version,total=struct.unpack_from('<4sII',raw,0);length,kind=struct.unpack_from('<I4s',raw,12)
    if magic!=b'glTF' or version!=2 or total!=len(raw) or kind!=b'JSON': raise ValueError('Invalid glTF export.')
    document=json.loads(raw[20:20+length]);materials=document.get('materials',[])
    if not materials: raise ValueError('Foliage preview lacks its material.')
    matched=0
    for material in materials:
        if only_foliage and not material.get('name','').startswith('Foliage Alpha Clip'): continue
        material['alphaMode']='MASK';material['alphaCutoff']=.5;material['doubleSided']=False;matched+=1
    if not matched: raise ValueError('Foliage material was not found in glTF export.')
    encoded=json.dumps(document,separators=(',',':')).encode('utf8');encoded+=b' '*((-len(encoded))%4);tail=raw[20+length:];glb.write_bytes(struct.pack('<4sII',b'glTF',2,12+8+len(encoded)+len(tail))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+tail)

def import_meshes(source,manifest,scratch):
    objects,meshes,_=safe_import(source,manifest,scratch)
    return objects,meshes
def verify_partition(source,copied,indices,vertices):
    if len(copied.data.polygons)!=len(indices) or copied.matrix_world!=source.matrix_world: raise ValueError('Split changed face count or world transform.')
    provenance=copied.data.attributes.get('aetherflow_source_face')
    if not provenance or [x.value for x in provenance.data]!=indices: raise ValueError('Face provenance mismatch.')
    if len(copied.data.materials)!=len(source.data.materials): raise ValueError('Split changed material slots.')
    for target,source_index in zip(copied.data.polygons,indices):
        original=source.data.polygons[source_index]
        if target.material_index!=original.material_index or len(target.vertices)!=len(original.vertices): raise ValueError('Split changed face topology or material.')
        for new_vertex,old_vertex in zip(target.vertices,original.vertices):
            if (copied.data.vertices[new_vertex].co-source.data.vertices[old_vertex].co).length>1e-6: raise ValueError('Split changed face coordinates.')
        for uv in source.data.uv_layers:
            layer=copied.data.uv_layers.get(uv.name)
            if not layer: raise ValueError('Split lost a UV layer.')
            for new_loop,old_loop in zip(target.loop_indices,original.loop_indices):
                if (layer.data[new_loop].uv-uv.data[old_loop].uv).length>1e-6: raise ValueError('Split changed a UV coordinate.')

    source_loops=[loop for face in indices for loop in source.data.polygons[face].loop_indices]
    source_edges={tuple(sorted(edge.vertices)):edge.index for edge in source.data.edges}
    edges=[source_edges[tuple(sorted(vertices[vertex] for vertex in edge.vertices))] for edge in copied.data.edges]
    domains={'POINT':vertices,'FACE':indices,'CORNER':source_loops,'EDGE':edges};uv_names={layer.name for layer in source.data.uv_layers}
    for attribute in source.data.attributes:
        if attribute.name=='position' or attribute.name in uv_names or getattr(attribute,'is_internal',False): continue
        target=copied.data.attributes.get(attribute.name)
        if not target or target.domain!=attribute.domain or target.data_type!=attribute.data_type: raise ValueError('Split lost a mesh attribute.')
        for new_index,old_index in enumerate(domains[attribute.domain]):
            old=attribute.data[old_index];new=target.data[new_index];prop=next((key for key in ('value','vector','color') if hasattr(old,key)),None)
            if not prop: raise ValueError('Unsupported mesh attribute.')
            old_value=getattr(old,prop);new_value=getattr(new,prop)
            if isinstance(old_value,(int,float,bool,str)):
                if old_value!=new_value: raise ValueError('Split changed a mesh attribute.')
            elif any(abs(a-b)>1e-6 for a,b in zip(old_value,new_value)): raise ValueError('Split changed a mesh attribute.')
    if len(source.data.corner_normals)==len(source.data.loops) and len(copied.data.corner_normals)==len(copied.data.loops):
        for new_index,old_index in enumerate(source_loops):
            if (copied.data.corner_normals[new_index].vector-source.data.corner_normals[old_index].vector).length>1e-5: raise ValueError('Split changed a corner normal.')
    for group in source.vertex_groups:
        target=copied.vertex_groups.get(group.name)
        if not target: raise ValueError('Split lost a vertex group.')
        for new_index,old_index in enumerate(vertices):
            before=next((weight.weight for weight in source.data.vertices[old_index].groups if weight.group==group.index),None)
            after=next((weight.weight for weight in copied.data.vertices[new_index].groups if weight.group==target.index),None)
            if before is None and after is None: continue
            if before is None or after is None or abs(before-after)>1e-6: raise ValueError('Split changed vertex weights.')

def inventory(meshes,sourcehash):
    rows=[]; mapping={}
    for obj in meshes:
        if obj.data.shape_keys or obj.modifiers or obj.constraints or obj.animation_data: raise ValueError('Resolve modifiers, animation and shape keys before partitioning.')
        used={vertex for face in obj.data.polygons for vertex in face.vertices}
        if len(used)!=len(obj.data.vertices): raise ValueError('Loose vertices must be resolved before partitioning.')
        if obj.data.attributes.get('aetherflow_source_face'): raise ValueError('Source uses reserved provenance attribute.')
        for faces in components(obj.data):
            identity=json.dumps([sourcehash,obj.name,faces],separators=(',',':'))
            cid=hashlib.sha256(identity.encode()).hexdigest()[:24]
            points=[obj.matrix_world @ obj.data.vertices[v].co for i in faces for v in obj.data.polygons[i].vertices]
            row={'componentId':cid,'object':obj.name,'faceIndices':faces,'faceCount':len(faces),'bounds':{'min':[min(p[i] for p in points) for i in range(3)],'max':[max(p[i] for p in points) for i in range(3)]},'materials':[m.name if m else None for m in obj.data.materials]}
            rows.append(row);mapping[cid]=(obj,faces)
    return rows,mapping

def mesh_fingerprint(meshes,uv=False):
    records=[]
    for obj in meshes:
        h=hashlib.sha256();mesh=obj.data
        if uv and not mesh.uv_layers: return None
        h.update(json.dumps([len(mesh.vertices),len(mesh.polygons)],separators=(',',':')).encode())
        if uv:
            for layer in mesh.uv_layers:
                for loop in layer.data: h.update(struct.pack('<2f',*loop.uv))
        else:
            for row in obj.matrix_world:
                h.update(struct.pack('<4f',*row))
            for vertex in mesh.vertices: h.update(struct.pack('<3f',*vertex.co))
            for polygon in mesh.polygons:
                h.update(struct.pack('<I',len(polygon.vertices)))
                for index in polygon.vertices: h.update(struct.pack('<I',index))
        records.append(h.hexdigest())
    return hashlib.sha256(''.join(sorted(records)).encode()).hexdigest()

def face_surface(obj,face,uv_names):
    mesh=obj.data;normal_matrix=obj.matrix_world.to_3x3().inverted().transposed();corners=[]
    normals=mesh.corner_normals
    for loop_index in face.loop_indices:
        loop=mesh.loops[loop_index];position=obj.matrix_world @ mesh.vertices[loop.vertex_index].co
        normal=normal_matrix @ (normals[loop_index].vector if len(normals)==len(mesh.loops) else face.normal)
        if normal.length>0: normal.normalize()
        uvs=[]
        for name in uv_names:
            layer=mesh.uv_layers.get(name)
            if not layer: raise ValueError('Joined object lost an existing UV layer: '+name)
            uvs.append(tuple(float(value) for value in layer.data[loop_index].uv))
        corners.append({'position':tuple(float(value) for value in position),'normal':tuple(float(value) for value in normal),'uvs':uvs})
    material=mesh.materials[face.material_index] if face.material_index<len(mesh.materials) else None
    return {'corners':corners,'materialName':material.name if material else None,'materialPointer':material.as_pointer() if material else None,'uvNames':list(uv_names)}

def verify_joined_surface(joined,expected,component_attr,face_attr):
    source_components=joined.data.attributes.get(component_attr);source_faces=joined.data.attributes.get(face_attr)
    if not source_components or not source_faces: raise ValueError('Mesh join lost its temporary face provenance.')
    seen=set();maximum=0.0
    for face in joined.data.polygons:
        key=(int(source_components.data[face.index].value),int(source_faces.data[face.index].value))
        if key in seen or key not in expected: raise ValueError('Mesh join duplicated or invented a source face.')
        before=expected[key];after=face_surface(joined,face,before['uvNames'])
        if before['materialName']!=after['materialName'] or before['materialPointer']!=after['materialPointer'] or len(before['corners'])!=len(after['corners']):
            raise ValueError('Mesh join changed material assignment or face construction.')
        first,second=before['corners'],after['corners']
        def flatten(corner): return corner['position']+corner['normal']+tuple(value for uv in corner['uvs'] for value in uv)
        residual=min(max(abs(a-b) for left,right in zip(first,second[offset:]+second[:offset]) for a,b in zip(flatten(left),flatten(right))) for offset in range(len(second)))
        maximum=max(maximum,residual)
        if residual>0.00001: raise ValueError('Mesh join changed world geometry, corner normals or UV coordinates.')
        seen.add(key)
    if seen!=set(expected): raise ValueError('Mesh join omitted a source face.')
    return maximum

def join_mesh_parts(parts,name):
    parts=[obj for obj in parts if obj.type=='MESH' and obj.data.polygons]
    if not parts: raise ValueError('A semantic asset group has no mesh surfaces.')
    component_attr='__aetherflow_join_source_mesh';face_attr='__aetherflow_join_source_face'
    expected={};source_vertices=source_faces=source_components=0
    source_names=[];material_names=set();uv_names=set()
    for part_index,obj in enumerate(parts):
        if obj.data.attributes.get(component_attr) or obj.data.attributes.get(face_attr): raise ValueError('Source mesh uses a reserved temporary join attribute.')
        uv_layers=sorted(layer.name for layer in obj.data.uv_layers)
        source_names.append(obj.name);source_vertices+=len(obj.data.vertices);source_faces+=len(obj.data.polygons)
        source_components+=len(list(components(obj.data)))
        material_names.update(material.name for material in obj.data.materials if material)
        uv_names.update(uv_layers)
        for face in obj.data.polygons: expected[(part_index,face.index)]=face_surface(obj,face,uv_layers)
        owner=obj.data.attributes.new(name=component_attr,type='INT',domain='FACE')
        origin=obj.data.attributes.new(name=face_attr,type='INT',domain='FACE')
        owner.data.foreach_set('value',[part_index]*len(obj.data.polygons))
        origin.data.foreach_set('value',[face.index for face in obj.data.polygons])
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts: obj.hide_set(False);obj.select_set(True)
    bpy.context.view_layer.objects.active=parts[0]
    if len(parts)>1: bpy.ops.object.join()
    joined=bpy.context.view_layer.objects.active
    if not joined or joined.type!='MESH': raise ValueError('Blender did not produce a joined mesh object.')
    joined.name=name;joined.data.name=name+'_Mesh'
    if len(joined.data.vertices)!=source_vertices or len(joined.data.polygons)!=source_faces: raise ValueError('Mesh join changed vertex or face counts.')
    maximum=verify_joined_surface(joined,expected,component_attr,face_attr)
    joined.data.attributes.remove(joined.data.attributes[component_attr]);joined.data.attributes.remove(joined.data.attributes[face_attr])
    connected=len(list(components(joined.data)))
    if connected!=source_components: raise ValueError('Mesh join welded or split disconnected geometry components.')
    return joined,{'sourceObjectCount':len(parts),'meshObjectCount':1,'sourceConnectedComponentCount':source_components,'connectedComponentCount':connected,
                   'vertexCount':source_vertices,'faceCount':source_faces,'materialNames':sorted(material_names),'uvLayerNames':sorted(uv_names),
                   'worldSurfacePreserved':True,'uvAndMaterialPreserved':True,'cornerNormalsPreserved':True,'maxSurfaceResidual':maximum,'tolerance':0.00001,
                   'sourceObjectNames':source_names}

def render_guide(meshes,file):
    from mathutils import Vector
    corners=[obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low=[min(p[i] for p in corners) for i in range(3)];high=[max(p[i] for p in corners) for i in range(3)];center=Vector([(low[i]+high[i])/2 for i in range(3)]);span=max(high[i]-low[i] for i in range(3))
    if span<=0: raise ValueError('Cannot render a zero-size guide.')
    camera_data=bpy.data.cameras.new('GuideCamera');camera_data.type='ORTHO';camera_data.ortho_scale=span*1.2;camera=bpy.data.objects.new('GuideCamera',camera_data);bpy.context.collection.objects.link(camera);camera.location=center+Vector((0,-span*3,0));camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();bpy.context.scene.camera=camera
    scene=bpy.context.scene;scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True;scene.render.filepath=str(file);bpy.ops.render.render(write_still=True);bpy.data.objects.remove(camera,do_unlink=True)

def main(cfg):
    started=time.perf_counter();timings={}
    # Remove factory-startup objects before importing any requested source.
    for obj in list(bpy.data.objects): bpy.data.objects.remove(obj,do_unlink=True)
    mode=cfg['mode']; root=Path(cfg['outputDirectory']).resolve();root.mkdir(parents=True,exist_ok=True);outputs=[];extra={}
    if mode in ('inventory','partition','inspect','guide','export','verify','verify-preview','texture-export'):
        source=Path(cfg['source']).resolve();sourcehash=cfg['sourceHash']
        phase=time.perf_counter()
        if digest(source)!=sourcehash: raise ValueError('Source hash mismatch.')
        timings['sourceDigestMs']=round((time.perf_counter()-phase)*1000,1)
        phase=time.perf_counter()
        objects,meshes=import_meshes(source,cfg.get('sourceManifest'),Path(cfg['report']).resolve().parent)
        timings['importMs']=round((time.perf_counter()-phase)*1000,1)
        if mode in ('verify','verify-preview'):
            phase=time.perf_counter()
            if any(not all(math.isfinite(value) for value in vertex.co) for obj in meshes for vertex in obj.data.vertices): raise ValueError('Model has non-finite coordinates.')
            extra['meshCount']=len(meshes);extra['faceCount']=sum(len(obj.data.polygons) for obj in meshes);extra['uvMissingMeshes']=[obj.name for obj in meshes if not obj.data.uv_layers];extra['unassignedMaterialMeshes']=[obj.name for obj in meshes if not obj.data.materials];missing=[]
            for obj in meshes:
                for material in obj.data.materials:
                    if not material or not material.use_nodes: continue
                    for node in material.node_tree.nodes:
                        if node.type=='TEX_IMAGE' and node.image and not node.image.packed_file:
                            image_path=Path(bpy.path.abspath(node.image.filepath))
                            if not image_path.is_file(): missing.append(node.image.name)
            extra['missingTextures']=sorted(set(missing));extra['geometryFingerprint']=mesh_fingerprint(meshes);extra['uvFingerprint']=mesh_fingerprint(meshes,uv=True)
            timings['meshAndMaterialAuditMs']=round((time.perf_counter()-phase)*1000,1)
            if cfg.get('baseline'):
                phase=time.perf_counter()
                baseline=Path(cfg['baseline']).resolve()
                if digest(baseline)!=cfg.get('baselineHash'): raise ValueError('Material baseline hash mismatch.')
                baseline_objects,baseline_meshes=import_meshes(baseline,cfg.get('baselineManifest'),Path(cfg['report']).resolve().parent);base_geometry=mesh_fingerprint(baseline_meshes);base_uv=mesh_fingerprint(baseline_meshes,uv=True)
                extra['baselineHash']=cfg['baselineHash'];extra['geometryCompatible']=extra['geometryFingerprint']==base_geometry;extra['uvCompatible']=None if base_uv is None else extra['uvFingerprint']==base_uv
                for obj in baseline_objects: bpy.data.objects.remove(obj,do_unlink=True)
                timings['baselineImportAndCompareMs']=round((time.perf_counter()-phase)*1000,1)
            if mode=='verify-preview':
                from asset_preview_support import build_preview
                phase=time.perf_counter()
                preview=build_preview(objects,meshes,cfg,source,outfile(root,'preview.glb'),Path(cfg['report']).resolve().parent)
                timings['previewTotalMs']=round((time.perf_counter()-phase)*1000,1)
                timings['previewPhasesMs']=preview.pop('processingTimingsMs',{})
                outputs.append({'path':preview['outputPath'],'hash':preview['outputSHA256'],'format':'glb'})
                extra['preview']=preview
        elif mode in ('inventory','partition','inspect'):
            rows,mapping=inventory(meshes,sourcehash);extra['components']=rows
            if mode=='inspect':
                requested=cfg['componentIds']
                if not requested or len(requested)>8 or len(set(requested))!=len(requested) or any(cid not in mapping for cid in requested): raise ValueError('Inspection requires one to eight known component IDs.')
                for obj in objects: obj.hide_render=True;obj.hide_set(True)
                for cid in requested:
                    original,faces=mapping[cid];copied,vertices=split_component(bpy,original,faces,'inspect_'+cid);verify_partition(original,copied,faces,vertices);file=outfile(root,'inspect-'+cid+'.png');render_guide([copied],file);outputs.append({'path':str(file),'hash':digest(file),'format':'png','componentId':cid});bpy.data.objects.remove(copied,do_unlink=True)
            if mode=='partition':
                groups={};seen=set();expected={(cid,face) for cid,(_,faces) in mapping.items() for face in faces}
                for entry in cfg['assignments']:
                    cid=entry['componentId'];group=entry['group'];faces=entry['faceIndices'];
                    if cid not in mapping or not faces: raise ValueError('Unknown component or empty face selection.')
                    obj,original=mapping[cid]
                    for face in faces:
                        key=(cid,face)
                        if key not in expected or key in seen: raise ValueError('Face assignment is unknown or duplicated.')
                        seen.add(key)
                    copied,vertices=split_component(bpy,obj,faces,'group_'+group+'_'+cid)
                    verify_partition(obj,copied,faces,vertices)
                    copied['asset_source_component']=cid;copied['asset_source_hash']=sourcehash
                    groups.setdefault(group,[]).append(copied)
                if seen!=expected: raise ValueError('Partition must cover every source face exactly once.')
                for obj in objects: bpy.data.objects.remove(obj,do_unlink=True)
                for index,(group,parts) in enumerate(sorted(groups.items())):
                    joined,join_report=join_mesh_parts(parts,'AetherFlow_Asset_'+str(index))
                    for fmt in ('fbx','glb'):
                        file=outfile(root,f'part-{index}.'+fmt);export_selected([joined],file,fmt)
                        outputs.append({'path':str(file),'hash':digest(file),'group':group,'format':fmt,**join_report})
                file=outfile(root,'partition.blend');bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(file),check_existing=False);outputs.append({'path':str(file),'hash':digest(file),'format':'blend'})
                extra['conservation']={'sourceFaces':len(expected),'assignedFaces':len(seen),'duplicates':0,'omitted':0}
        elif mode=='texture-export':
            joined,join_report=join_mesh_parts(meshes,'AetherFlow_SharedProp')
            file=outfile(root,'shared-prop.fbx');export_selected([joined],file,'fbx')
            outputs.append({'path':str(file),'hash':digest(file),'group':cfg.get('group'),'format':'fbx',**join_report})
            extra.update(join_report)
        elif mode=='export':
            for fmt in cfg.get('formats',['fbx']):
                if fmt not in ('fbx','glb'): raise ValueError('Unsupported export format.')
                file=outfile(root,'model.'+fmt);export_selected(meshes,file,fmt)
                if fmt=='glb' and cfg.get('foliage'): ensure_mask(file)
                outputs.append({'path':str(file),'hash':digest(file),'format':fmt})
        elif mode=='guide':
            file=outfile(root,'guide.png');render_guide(meshes,file);outputs.append({'path':str(file),'hash':digest(file),'format':'png'})
    elif mode=='foliage':
        atlas=Path(cfg['atlas']).resolve()
        if digest(atlas)!=cfg['atlasHash']: raise ValueError('Foliage atlas hash mismatch.')
        tiles={tile['role']:tile['rect'] for tile in cfg['tiles']}
        if set(tiles)!={'front','back','side','top'}: raise ValueError('Four foliage atlas regions are required.')
        base=[(-.5,0,-.5),(.5,0,-.5),(.5,0,.5),(-.5,0,.5),(0,-.5,-.5),(0,.5,-.5),(0,.5,.5),(0,-.5,.5),(-.5,-.5,0),(.5,-.5,0),(.5,.5,0),(-.5,.5,0)]
        base_faces=[(0,1,2,3),(3,2,1,0),(4,5,6,7),(7,6,5,4),(8,9,10,11),(11,10,9,8)];verts=[];faces=[]
        for index,face in enumerate(base_faces):
            axis=(1,1,0,0,2,2)[index];offset=(-.0001,.0001,-.0001,.0001,-.0001,.0001)[index];start=len(verts)
            for source in face:
                vertex=list(base[source]);vertex[axis]+=offset;verts.append(tuple(vertex))
            faces.append(tuple(range(start,start+4)))
        mesh=bpy.data.meshes.new('FoliageCluster');mesh.from_pydata(verts,[],faces);mesh.update();layer=mesh.uv_layers.new(name='UVMap')
        for poly,role in zip(mesh.polygons,['front','back','side','side','top','top']):
            rect=tiles[role];u0=rect['x']/2048;u1=(rect['x']+rect['width'])/2048;v0=1-(rect['y']+rect['height'])/2048;v1=1-rect['y']/2048
            for loop,uv in zip(poly.loop_indices,[(u0,v0),(u1,v0),(u1,v1),(u0,v1)]):layer.data[loop].uv=uv
        obj=bpy.data.objects.new('FoliageCluster',mesh);bpy.context.collection.objects.link(obj);obj['asset_part']='foliage'
        mat=bpy.data.materials.new('Foliage Alpha Clip');mat.use_nodes=True
        if hasattr(mat,'surface_render_method'):mat.surface_render_method='DITHERED'
        if hasattr(mat,'alpha_threshold'):mat.alpha_threshold=.5
        shader=mat.node_tree.nodes.get('Principled BSDF');texture=mat.node_tree.nodes.new('ShaderNodeTexImage');texture.image=bpy.data.images.load(str(atlas),check_existing=False);texture.image.pack();mat.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color']);clip=mat.node_tree.nodes.new('ShaderNodeMath');clip.operation='GREATER_THAN';clip.inputs[1].default_value=.5;mat.node_tree.links.new(texture.outputs['Alpha'],clip.inputs[0]);mat.node_tree.links.new(clip.outputs[0],shader.inputs['Alpha']);obj.data.materials.append(mat)
        blend=outfile(root,'foliage.blend');bpy.ops.wm.save_as_mainfile(filepath=str(blend),check_existing=False);outputs.append({'path':str(blend),'hash':digest(blend),'format':'blend'})
        fbx=outfile(root,'foliage.fbx');export_selected([obj],fbx,'fbx');outputs.append({'path':str(fbx),'hash':digest(fbx),'format':'fbx'})
        glb=outfile(root,'foliage.glb');export_selected([obj],glb,'glb')
        ensure_mask(glb)
        outputs.append({'path':str(glb),'hash':digest(glb),'format':'glb'});extra.update({'atlasHash':cfg['atlasHash'],'planeCount':3,'directedFaces':6,'alphaMode':'MASK','alphaCutoff':.5,'tiles':cfg['tiles']})
    elif mode=='assemble':
        from mathutils import Euler, Vector
        masters={}
        for source in cfg['sources']:
            file=Path(source['path']).resolve()
            if digest(file)!=source['hash']: raise ValueError('Assembly source hash mismatch.')
            imported,meshes=import_meshes(file,source.get('manifest'),Path(cfg['report']).resolve().parent)
            if source.get('route')=='foliage':
                for obj in meshes:
                    obj['asset_part']='foliage'
                    for material in obj.data.materials:
                        if not material or not material.use_nodes: raise ValueError('Foliage material is missing.')
                        if hasattr(material,'surface_render_method'): material.surface_render_method='DITHERED'
                        if hasattr(material,'alpha_threshold'): material.alpha_threshold=.5
                        if hasattr(material,'use_backface_culling'): material.use_backface_culling=True
                        shader=material.node_tree.nodes.get('Principled BSDF')
                        if not shader: raise ValueError('Foliage material has no principled shader.')
                        alpha=shader.inputs['Alpha'];incoming=alpha.links[0].from_socket if alpha.links else None
                        if not incoming:
                            texture=next((node for node in material.node_tree.nodes if node.type=='TEX_IMAGE' and node.image),None)
                            if not texture: raise ValueError('Foliage atlas texture is missing.')
                            incoming=texture.outputs['Alpha']
                        for link in list(alpha.links): material.node_tree.links.remove(link)
                        clip=material.node_tree.nodes.new('ShaderNodeMath');clip.operation='GREATER_THAN';clip.inputs[1].default_value=.5;material.node_tree.links.new(incoming,clip.inputs[0]);material.node_tree.links.new(clip.outputs[0],alpha)
            masters[source['itemId']]=[(obj,obj.matrix_world.copy()) for obj in meshes]
            for obj in imported: obj.hide_render=True;obj.hide_set(True)
        created=[];shared=True
        for instance in cfg['instances']:
            if instance['masterItemId'] not in masters: raise ValueError('Instance master is missing.')
            transform=instance['transform'];rotation=Euler(transform['rotation'],'XYZ').to_matrix().to_4x4();scale=Matrix.Diagonal(Vector((*transform['scale'],1.0)));matrix=Matrix.Translation(Vector(transform['position'])) @ rotation @ scale
            for original,world in masters[instance['masterItemId']]:
                obj=original.copy();obj.data=original.data;bpy.context.collection.objects.link(obj);obj.hide_render=False;obj.hide_set(False);obj.matrix_world=matrix @ world;obj['asset_item_id']=instance['masterItemId'];obj['asset_instance_id']=instance['id'];created.append(obj);shared=shared and obj.data is original.data
        if not created: raise ValueError('Assembly requires at least one accepted instance.')
        for group in masters.values():
            for original,_ in group: bpy.data.objects.remove(original,do_unlink=True)
        blend=outfile(root,'scene.blend');bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(blend),check_existing=False);outputs.append({'path':str(blend),'hash':digest(blend),'format':'blend'})
        glb=outfile(root,'scene.glb');export_selected(created,glb,'glb')
        if any(source.get('route')=='foliage' for source in cfg['sources']): ensure_mask(glb,only_foliage=True)
        outputs.append({'path':str(glb),'hash':digest(glb),'format':'glb'});extra['instanceCount']=len(cfg['instances']);extra['sharedGeometry']=shared;extra['sourceHashes']={source['itemId']:source['hash'] for source in cfg['sources']}
    else: raise ValueError('Unsupported asset surface mode.')
    timings['pythonTotalMs']=round((time.perf_counter()-started)*1000,1)
    if mode=='verify-preview':
        manifest=cfg.get('sourceManifest') or {}
        timings['safeImportPhasesMs']=manifest.get('_processingTimingsMs',{})
        extra['processingTimingsMs']=timings
    return {'schemaVersion':1,'mode':mode,'ok':True,'autoexec':'disabled','sourceHash':cfg.get('sourceHash'),'outputs':outputs,**extra}

if __name__=='__main__':
    cfg=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf8'))
    report=Path(cfg['report'])
    try: result=main(cfg)
    except Exception as error: result={'schemaVersion':1,'mode':cfg.get('mode'),'ok':False,'autoexec':'disabled','sourceHash':cfg.get('sourceHash'),'outputs':[],'error':str(error),'trace':traceback.format_exc()[-12000:]}
    report.write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),encoding='utf8')
    if not result['ok']: raise SystemExit(2)
