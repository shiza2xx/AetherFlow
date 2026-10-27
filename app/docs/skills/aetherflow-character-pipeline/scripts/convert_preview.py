"""Convert a registered source to a derived GLB without editing the source."""
import bpy,sys,json,os,pathlib,hashlib,re,urllib.parse,shlex
import math
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from gltf_weight_export import export_glb_preserving_all_weights
from validate_workflow import enforce_blender_memory_budget
from registered_dependency import resolve_registered_dependency,registered_dependency_candidates
from texture_source_memory import cached_image_pixel_hash

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

def clothing_atlas_recipe(material, source_hash, output_hash, work_root):
    """Package one recognized graph as inert indexed data and raw textures."""
    from preservation_fingerprint import material_graph_snapshot
    graph=material_graph_snapshot(material,include_image_pixels=False)
    if not graph or graph.get('schemaVersion')!=2:return None,[]
    nodes={row['index']:row for row in graph['nodes']}
    by_name={row['name']:row for row in graph['nodes']}
    links=graph['links']
    if len(nodes)!=len(graph['nodes']) or len(by_name)!=len(graph['nodes']):return None,[]
    for row in graph['nodes']:
        if len({socket['index'] for socket in row.get('inputs',[])})!=len(row.get('inputs',[])) or len({socket['index'] for socket in row.get('outputs',[])})!=len(row.get('outputs',[])):return None,[]
    seen_links=set()
    for row in links:
        key=(row.get('fromNode'),row.get('fromSocket'),row.get('toNode'),row.get('toSocket'))
        source=nodes.get(row.get('fromNode'));target=nodes.get(row.get('toNode'))
        if not source or not target or key in seen_links or not any(socket['index']==row.get('fromSocket') for socket in source.get('outputs',[])) or not any(socket['index']==row.get('toSocket') for socket in target.get('inputs',[])):return None,[]
        seen_links.add(key)
    def linked(node_name, socket_index, source_name=None, source_socket=None):
        target=by_name.get(node_name)
        if not target:return False
        matches=[row for row in links if row['toNode']==target['index'] and row['toSocket']==socket_index]
        if source_name is not None:
            source=by_name.get(source_name)
            matches=[row for row in matches if source and row['fromNode']==source['index'] and (source_socket is None or row['fromSocket']==source_socket)]
        return bool(matches)
    outputs=[row for row in graph['nodes'] if row['type']=='ShaderNodeOutputMaterial' and row.get('activeOutput')]
    root_link=next((row for row in links if outputs and row['toNode']==outputs[0]['index'] and row['toSocket']==0),None)
    root_mix=nodes.get(root_link['fromNode']) if root_link else None
    expected_types={'Mix Shader.003':'ShaderNodeMixShader','Math.005':'ShaderNodeMath','Mix Shader.002':'ShaderNodeMixShader','Mix Shader.001':'ShaderNodeMixShader','Geometry':'ShaderNodeNewGeometry','Transparent BSDF':'ShaderNodeBsdfTransparent'}
    if not root_mix or root_mix['type']!='ShaderNodeMixShader' or root_mix['name']!='Mix Shader.003':return None,[]
    if any(by_name.get(name,{}).get('type')!=kind for name,kind in expected_types.items()):return None,[]
    operations={'Math':'ADD','Math.001':'MULTIPLY','Math.002':'MULTIPLY','Math.003':'ADD','Math.004':'SUBTRACT','Math.005':'MULTIPLY','Vector Math':'SCALE','Vector Math.001':'ADD'}
    for name,operation in operations.items():
        node=by_name.get(name)
        if not node or node.get('properties',{}).get('operation')!=operation:return None,[]
    if by_name.get('Map Range.001',{}).get('properties',{}).get('data_type')!='FLOAT':return None,[]
    def socket_default(name,index):
        node=by_name.get(name);socket=next((row for row in node.get('inputs',[]) if row['index']==index),None) if node else None
        return socket.get('default') if socket and socket.get('enabled') else None
    expected_defaults={'Vector Math':{3:2.125},'Vector Math.001':{1:[-.03125,-.03125,0]},'Map Range.001':{1:0.0,2:1.0,3:.25,4:.16},'Math.001':{1:.12},'Math.002':{1:.22},'Math.004':{0:.5}}
    for name,values in expected_defaults.items():
        for index,expected in values.items():
            actual=socket_default(name,index)
            if isinstance(expected,list):
                if not isinstance(actual,list) or len(actual)<len(expected) or any(not math.isfinite(float(value)) or abs(float(value)-float(target))>1e-6 for value,target in zip(actual,expected)):return None,[]
            elif not isinstance(actual,(int,float)) or not math.isfinite(actual) or abs(actual-expected)>1e-6:return None,[]
    required_routes=[('Principled BSDF',0,'Image Texture',0),('Principled BSDF',2,'Image Texture.001',0),('Principled BSDF',1,'Image Texture.002',0),('Principled BSDF.001',0,'Image Texture.004',0),('Principled BSDF.001',2,'Image Texture.006',0),('Principled BSDF.001',1,'Image Texture.007',0)]
    if any(not linked(target,socket,source,source_socket) for target,socket,source,source_socket in required_routes):return None,[]
    if not any(row['fromNode']==by_name['Geometry']['index'] and row['fromSocket']==6 and row['toNode']==by_name['Mix Shader.002']['index'] and row['toSocket']==0 for row in links):return None,[]
    if not linked('Mix Shader.003',1,'Mix Shader.002',0) or not linked('Mix Shader.003',2,'Transparent BSDF',0):return None,[]
    if not linked('Mix Shader.003',0,'Math.005',0):return None,[]
    if not linked('Mix Shader.002',2,'Mix Shader.001',0):return None,[]
    settings=graph.get('settings') or {}
    if bool(settings.get('use_backface_culling')) or settings.get('surface_render_method') not in ('DITHERED','BLENDED'):return None,[]
    image_nodes=[];package_files=[]
    image_by_node={node.name:node.image for node in material.node_tree.nodes if getattr(node,'image',None)}
    for row in graph['nodes']:
        if row.get('type')=='ShaderNodeTexImage' and (row.get('properties',{}).get('extension')!='REPEAT' or row.get('properties',{}).get('projection')!='FLAT'):return None,[]
        proof=row.get('image')
        if not proof:continue
        image=image_by_node.get(row['name'])
        if image is None:continue
        expected_color='sRGB' if re.search(r'color_v1|reverse_color_v6',image.name) else 'Non-Color'
        if image.colorspace_settings.name!=expected_color:return None,[]
        if image.packed_file:
            payload=bytes(image.packed_file.data)
        elif image.source=='FILE' and image.filepath:
            image_path=os.path.realpath(bpy.path.abspath(image.filepath))
            if not os.path.isfile(image_path):raise ValueError('Recognized material graph texture is unavailable: '+image.name)
            with open(image_path,'rb') as stream:payload=stream.read()
        else:
            raise ValueError('Recognized material graph contains a texture source that cannot be packaged losslessly: '+image.name)
        digest=hashlib.sha256(payload).hexdigest()
        if proof.get('payloadSHA256') and digest!=proof['payloadSHA256']:raise ValueError('Recognized material raw texture hash differs from its indexed graph snapshot: '+image.name)
        proof['payloadSHA256']=digest;proof['payloadBytes']=len(payload)
        extension=pathlib.Path(image.filepath or image.name).suffix.lower()
        if extension not in ('.png','.jpg','.jpeg','.tif','.tiff','.webp','.bmp'):extension='.bin'
        logical='material-graphs/clothing-atlas-v1/'+digest+extension
        target=os.path.join(work_root,*logical.split('/'));os.makedirs(os.path.dirname(target),exist_ok=True)
        if not os.path.exists(target):
            with open(target,'xb') as stream:stream.write(payload)
        image_nodes.append({'nodeIndex':row['index'],'nodeName':row['name'],'imageName':image.name,'logicalPath':logical,'sha256':digest,'bytes':len(payload),'colorSpace':image.colorspace_settings.name,'size':[int(x) for x in image.size]})
        package_files.append({'sourcePath':target,'logicalPath':logical,'sha256':digest,'role':'recognized-material-graph-texture'})
    required={'Clothing_Atlas_color_v1.png','Clothing_Atlas_roughness_v1.png','Clothing_Atlas_metallic_v1.png','Clothing_Atlas_normal_v1.png','Clothing_Atlas_settings_v1.png','cloak_reverse_color_v6.png','cloak_reverse_normal_v6.png','cloak_reverse_roughness_v6.png','cloak_reverse_metallic_v6.png','cloak_inset_gold_hem_mask.png'}
    if not required.issubset({item['imageName'] for item in image_nodes}):return None,[]
    recipe={'schemaVersion':1,'profileId':'clothing-atlas-mixed-front-back','profileVersion':2,'sourceHash':source_hash,'derivativeHash':output_hash,'materialName':material.name,'graphSchemaVersion':2,'graph':graph,'textures':image_nodes,'rendererUvBasis':{'version':1,'source':'Blender UVMap','candidate':'glTF accessor with V flip','scale':2.125,'sourceOffset':[-.03125,-.03125],'rendererOffset':[-.03125,-1.09375],'mapping':'F*T*F; v_glTF=1-v_Blender'},'rendererLimitations':['The trusted Atelier interpreter implements this recognized profile as a bounded realtime approximation. Blender remains the reference for closure mixing, hashed transparency and full Principled BSDF shading.']}
    return recipe,package_files
def inside(root, path):
    root=os.path.realpath(root); target=os.path.realpath(path)
    if os.path.commonpath([root,target])!=root: raise ValueError('A referenced file escaped the registered dependency folder.')
    return target
def check_uri(root, base, uri, dependency_map=None):
    if uri.startswith('data:'): return
    parsed=urllib.parse.urlparse(uri)
    # FBX commonly stores stale drive-qualified absolute texture paths. Never
    # open those paths; allow them only when the managed dependency manifest
    # identifies one unique, hash-verified replacement by logical path/name.
    windows_absolute=bool(re.match(r'^[A-Za-z]:[\\/]',uri))
    if windows_absolute:
        staged=resolve_registered_dependency(uri,root,dependency_map)
        if staged:return staged
        raise ValueError('Missing or ambiguous registered dependency: '+uri)
    if parsed.scheme not in ('','file'): raise ValueError('Network texture dependencies are not loaded by the local converter.')
    decoded=urllib.parse.unquote(parsed.path if parsed.scheme else uri)
    if not os.path.isabs(decoded): decoded=os.path.join(base,decoded)
    try: target=inside(root,decoded)
    except ValueError: target=None
    if target and os.path.isfile(target): return target
    staged=resolve_registered_dependency(uri,root,dependency_map)
    if staged:return staged
    raise ValueError('Missing or ambiguous registered dependency: '+uri)
def preflight_dependencies(root,source,ext,dependency_map=None):
    base=os.path.dirname(source)
    missing=[]
    if ext=='.obj':
        for line in open(source,encoding='utf8',errors='replace'):
            if line.strip().lower().startswith('mtllib '):
                for ref in shlex.split(line.strip()[7:]):
                    mtl=inside(root,os.path.join(base,ref))
                    for material_line in open(mtl,encoding='utf8',errors='replace'):
                        tokens=shlex.split(material_line.strip())
                        if tokens and tokens[0].lower().startswith(('map_','bump','disp','decal')) and len(tokens)>1: check_uri(root,os.path.dirname(mtl),tokens[-1])
    elif ext=='.gltf':
        data=json.load(open(source,encoding='utf8'))
        for section in ('buffers','images'):
            for item in data.get(section,[]):
                if item.get('uri'):check_uri(root,base,item['uri'])
    elif ext=='.fbx':
        pattern=re.compile(rb'[^\x00\r\n"<>]{1,260}\.(?:png|jpe?g|tga|bmp|tif|tiff|webp|exr)',re.I)
        tail=b'';seen=set()
        with open(source,'rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):
                data=tail+chunk;matches=pattern.findall(data)
                for found in matches:
                    ref=found.decode('utf8','ignore').strip().replace('\\','/')
                    if ref and ref not in seen and not ref.startswith(('embedded://','//')):
                        seen.add(ref)
                        try:check_uri(root,base,ref,dependency_map)
                        except ValueError:
                            candidates=registered_dependency_candidates(ref,dependency_map)
                            if len(candidates)>1:raise ValueError('Ambiguous registered texture dependency: '+ref)
                            if candidates:raise
                            missing.append(ref)
                tail=data[-320:]
    return missing
def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'))
    source=inside(cfg['dependencyRoot'],cfg['source']); ext=pathlib.Path(source).suffix.lower()
    if not os.path.isfile(source): raise ValueError('Registered model is missing.')
    dependency_map=cfg.get('externalDependencyMap',[])
    missing_dependencies=preflight_dependencies(cfg['dependencyRoot'],source,ext,dependency_map)
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if ext=='.fbx': bpy.ops.import_scene.fbx(filepath=source,automatic_bone_orientation=False)
    elif ext=='.obj':
        mtl=pathlib.Path(source).with_suffix('.mtl')
        if mtl.exists(): inside(cfg['dependencyRoot'],str(mtl))
        bpy.ops.wm.obj_import(filepath=source)
    elif ext in ('.gltf','.glb'): bpy.ops.import_scene.gltf(filepath=source)
    elif ext=='.blend': bpy.ops.wm.open_mainfile(filepath=source)
    else: raise ValueError('Supported sources: FBX, OBJ + MTL/textures, GLB, glTF, and BLEND.')
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    by_hash={str(row['sha256']):row for row in dependency_map}
    hashed_paths={}
    for image in bpy.data.images:
        if image.source!='FILE' or image.packed_file or not image.filepath: continue
        referenced=os.path.realpath(bpy.path.abspath(image.filepath))
        if ext=='.fbx':
            # FBX may preserve a stale absolute path which still exists outside
            # staging. Never hash, decode, or trust that location: remap every
            # unpacked FBX image through the exact registered dependency set.
            registered=resolve_registered_dependency(image.filepath,cfg['dependencyRoot'],dependency_map)
            if not registered:
                if len(registered_dependency_candidates(image.filepath,dependency_map))>1:raise ValueError('Ambiguous registered texture dependency: '+image.filepath)
                missing_dependencies.append(image.filepath)
                for material in bpy.data.materials:
                    if not material.use_nodes:continue
                    for node in material.node_tree.nodes:
                        if node.type=='TEX_IMAGE' and node.image==image:
                            for link in list(material.node_tree.links):
                                if link.from_node==node:material.node_tree.links.remove(link)
                continue
            referenced=registered
            old_image=image
            image=bpy.data.images.load(referenced,check_existing=False)
            for material in bpy.data.materials:
                if not material.use_nodes:continue
                for node in material.node_tree.nodes:
                    if node.type=='TEX_IMAGE' and node.image==old_image:node.image=image
            image.colorspace_settings.name=old_image.colorspace_settings.name
            dimensions=tuple(int(value) for value in image.size)
            first_pixel=float(image.pixels[0]) if dimensions[0]>0 and dimensions[1]>0 else float('nan')
            if dimensions[0]<1 or dimensions[1]<1 or not math.isfinite(first_pixel):raise ValueError('Registered FBX texture could not be decoded after path remapping: '+image.name+' '+referenced)
        elif not os.path.isfile(referenced):
            referenced=resolve_registered_dependency(image.filepath,cfg['dependencyRoot'],dependency_map)
            if not referenced:
                if len(registered_dependency_candidates(image.filepath,dependency_map))>1:raise ValueError('Ambiguous registered texture dependency: '+image.filepath)
                missing_dependencies.append(image.filepath)
                for material in bpy.data.materials:
                    if not material.use_nodes:continue
                    for node in material.node_tree.nodes:
                        if node.type=='TEX_IMAGE' and node.image==image:
                            for link in list(material.node_tree.links):
                                if link.from_node==node:material.node_tree.links.remove(link)
                continue
            # Some importers create an Image datablock with a stale absolute
            # path. Some Blender builds retain the failed image state after
            # Image.reload(), so load the hash-verified managed bytes as a new
            # datablock and reconnect only nodes that used the stale image.
            old_image=image
            image=bpy.data.images.load(referenced,check_existing=False)
            for material in bpy.data.materials:
                if not material.use_nodes:continue
                for node in material.node_tree.nodes:
                    if node.type=='TEX_IMAGE' and node.image==old_image:
                        node.image=image
            image.colorspace_settings.name=old_image.colorspace_settings.name
            dimensions=tuple(int(value) for value in image.size)
            first_pixel=float(image.pixels[0]) if dimensions[0]>0 and dimensions[1]>0 else float('nan')
            if dimensions[0]<1 or dimensions[1]<1 or not math.isfinite(first_pixel):
                raise ValueError('Registered FBX texture could not be decoded after path remapping: '+image.name+' '+referenced)
        if referenced not in hashed_paths: hashed_paths[referenced]=sha(referenced)
        match=by_hash.get(hashed_paths[referenced])
        if match: image.filepath=os.path.abspath(match['path'])
    enforce_blender_memory_budget('managed preview source load')
    # Remove only slots unused by polygons from this disposable export scene.
    # Unused datablocks remain in the editable source file and are not decoded.
    pruned_slots=0
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH' or not obj.data.materials: continue
        slots=obj.data.materials
        used={int(poly.material_index) for poly in obj.data.polygons if 0<=int(poly.material_index)<len(slots)}
        remap={old:new for new,old in enumerate(sorted(used))}
        for poly in obj.data.polygons:
            old=int(poly.material_index)
            if old in remap: poly.material_index=remap[old]
        for index in range(len(slots)-1,-1,-1):
            if index not in used:
                slots.pop(index=index);pruned_slots+=1
    dependencies=[]
    # Only image datablocks referenced by an active material node are required
    # for the exported scene. Old unused image datablocks often retain stale
    # absolute paths and must not block a self-contained preview.
    used_images=set()
    used_materials={material for obj in bpy.context.scene.objects if obj.type=='MESH' for material in obj.data.materials if material}
    for material in used_materials:
        if not material or not material.use_nodes: continue
        for node in material.node_tree.nodes:
            if node.type=='TEX_IMAGE' and node.image and any(link.from_node==node for link in material.node_tree.links): used_images.add(node.image)
    for image in used_images:
        if not image.filepath or image.source=='GENERATED' or image.packed_file: continue
        referenced=bpy.path.abspath(image.filepath)
        if not os.path.exists(referenced): raise ValueError('Missing texture dependency: '+image.filepath)
        try: referenced=inside(cfg['dependencyRoot'],referenced)
        except ValueError as exc: raise ValueError('Used texture escaped the registered dependency folder: '+referenced) from exc
        if not os.path.isfile(referenced): raise ValueError('Texture dependency is not a regular file: '+image.filepath)
        if not any(item['path']==referenced for item in dependencies): dependencies.append({'path':referenced,'sha256':sha(referenced),'logicalPath':next((row.get('logicalPath') for row in dependency_map if os.path.realpath(row['path'])==referenced),None)})
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
    if not meshes: raise ValueError('Source contains no mesh objects.')
    enforce_blender_memory_budget('managed preview material and dependency capture')
    output=os.path.abspath(cfg['output']);os.makedirs(os.path.dirname(output),exist_ok=True)
    weight_export_policy=export_glb_preserving_all_weights(filepath=output,export_skins=True,export_animations=True,export_apply=False)
    enforce_blender_memory_budget('managed preview GLB export')
    output_hash=sha(output);recipes=[];recipe_dependencies=[]
    for material in sorted(used_materials,key=lambda item:item.name):
        if material.name!='Clothing_Atlas_Shared_v1':continue
        recipe,files=clothing_atlas_recipe(material,sha(source),output_hash,os.path.dirname(output))
        if recipe:
            recipes.append(recipe);recipe_dependencies.extend(files)
    material_audit=[];decoded_pixel_hashes={}
    for material in sorted(used_materials,key=lambda item:item.name):
        facts={'material':material.name,'maps':{'baseColor':None,'metallic':None,'roughness':None,'normal':None},'textures':[]}
        if material.use_nodes:
            nodes=material.node_tree.nodes;links=material.node_tree.links
            principled=next((node for node in nodes if node.type=='BSDF_PRINCIPLED'),None)
            if principled:
                for channel,socket_name in (('baseColor','Base Color'),('metallic','Metallic'),('roughness','Roughness'),('normal','Normal')):
                    socket=principled.inputs.get(socket_name)
                    link=next((link for link in links if socket and link.to_socket==socket),None)
                    image_node=link.from_node if link and link.from_node.type=='TEX_IMAGE' else None
                    if image_node and image_node.image:
                        image=image_node.image
                        if image.source=='FILE' and not image.packed_file and image.filepath:
                            image.reload()
                        dimensions=tuple(int(value) for value in image.size)
                        decoded=dimensions[0]>0 and dimensions[1]>0 and math.isfinite(float(image.pixels[0]))
                        if not decoded:raise ValueError('An assigned PBR texture could not be decoded: '+image.name)
                        pixel_hash=cached_image_pixel_hash(decoded_pixel_hashes,image)
                        facts['maps'][channel]={'image':image.name,'width':int(image.size[0]),'height':int(image.size[1]),'decodedPixelHash':pixel_hash,'colorSpace':image.colorspace_settings.name,'decoded':decoded}
                        facts['textures'].append(image.name)
        material_audit.append(facts)
    uv_audit=[{'object':obj.name,'layers':[layer.name for layer in obj.data.uv_layers],'active':obj.data.uv_layers.active.name if obj.data.uv_layers.active else None,'loopCount':len(obj.data.loops)} for obj in meshes]
    report={'schema':1,'operation':'source-preserving-glb-preview','input':source,'inputSHA256':sha(source),'output':output,'outputSHA256':output_hash,'dependencies':dependencies,'missingDependencies':sorted(set(missing_dependencies)),'materialAudit':{'materials':material_audit,'uv':uv_audit,'decodedTextureCount':sum(len(row['textures']) for row in material_audit),'missingChannels':[channel for row in material_audit for channel,value in row['maps'].items() if value is None]},'materialGraphRecipes':recipes,'materialGraphDependencies':recipe_dependencies,'blenderVersion':bpy.app.version_string,'weightExportPolicy':weight_export_policy,'sourceObjects':len(bpy.context.scene.objects),'meshObjects':len(meshes),'previewMaterialSlotPruning':pruned_slots,'clips':[a.name for a in bpy.data.actions],'autoexec':'disabled','sourceModified':False,'derivedPreviewOnly':True,'workingSetLimitBytes':6*1024*1024*1024,'limitations':['Blender GLB preview export may not retain all source-specific FBX metadata; the source remains authoritative.']}
    with open(cfg['report'],'w',encoding='utf8') as f:json.dump(report,f,indent=2)
if __name__=='__main__':main()
