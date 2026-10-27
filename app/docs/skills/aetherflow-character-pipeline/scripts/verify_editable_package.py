"""Independently compare a managed portable BLEND with its exact source semantics."""
import bpy,sys,json,os,hashlib,struct,shutil
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from preservation_fingerprint import material_graph_snapshot,animation_fingerprint,clear_image_fingerprint_cache
from validate_workflow import enforce_blender_memory_budget

def digest_json(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def image_dependency_inventory():
    rows=[]
    for image in sorted(bpy.data.images,key=lambda item:item.name):
        if image.source!='FILE':
            rows.append({'name':image.name,'source':image.source,'packed':bool(image.packed_file),'size':[int(x) for x in image.size],'channels':int(image.channels),'colorspace':image.colorspace_settings.name,'payloadSHA256':None,'payloadBytes':None})
            continue
        if image.packed_file:
            payload=bytes(image.packed_file.data);size=len(payload);digest=hashlib.sha256(payload).hexdigest();del payload
        else:
            path=os.path.realpath(bpy.path.abspath(image.filepath))
            if not os.path.isfile(path):raise ValueError('Editable source dependency is missing: '+image.name)
            digest_state=hashlib.sha256();size=0
            with open(path,'rb') as stream:
                for block in iter(lambda:stream.read(1024*1024),b''):size+=len(block);digest_state.update(block)
            digest=digest_state.hexdigest()
        rows.append({'name':image.name,'source':image.source,'packed':bool(image.packed_file),'size':[int(x) for x in image.size],'channels':int(image.channels),'colorspace':image.colorspace_settings.name,'payloadSHA256':digest,'payloadBytes':size})
    return rows
def scene_summary(path):
    bpy.ops.wm.open_mainfile(filepath=path);bpy.context.preferences.filepaths.use_scripts_auto_execute=False;clear_image_fingerprint_cache();enforce_blender_memory_budget('editable package scene load')
    meshes=[];materials={};all_images=[];image_dependencies=image_dependency_inventory()
    for object_index,obj in enumerate(sorted((x for x in bpy.context.scene.objects if x.type=='MESH'),key=lambda x:x.name)):
        if object_index%4==0:enforce_blender_memory_budget('editable package mesh and graph verification')
        mesh=obj.data;h=hashlib.sha256()
        for v in mesh.vertices:h.update(struct.pack('<3d',*v.co))
        for e in mesh.edges:h.update(struct.pack('<2I',*e.vertices))
        for p in mesh.polygons:h.update(struct.pack('<I',len(p.vertices)));h.update(struct.pack('<'+str(len(p.vertices))+'I',*p.vertices));h.update(struct.pack('<i',p.material_index))
        for layer in mesh.uv_layers:
            h.update(layer.name.encode('utf-8')+b'\0')
            for loop in layer.data:h.update(struct.pack('<2d',*loop.uv))
        for loop in mesh.corner_normals:h.update(struct.pack('<3d',*loop.vector))
        weights=[];group_names=[g.name for g in obj.vertex_groups]
        for vertex in mesh.vertices:weights.append(sorted((group_names[g.group],float(g.weight)) for g in vertex.groups if g.weight>0.0))
        for row in weights:h.update(json.dumps(row,separators=(',',':')).encode()+b'\n')
        mats=[]
        used={p.material_index for p in mesh.polygons}
        for i in sorted(used):
            material=mesh.materials[i] if i<len(mesh.materials) else None
            mats.append([i,material.name if material else None])
            if material and material.name not in materials:
                graph=material_graph_snapshot(material,False)
                for node in graph.get('nodes',[]):
                    image=node.get('image')
                    if image:
                        image.pop('packed',None)
                        if image.get('payloadSHA256'):all_images.append({'material':material.name,'node':node['name'],'sha256':image['payloadSHA256'],'bytes':image['payloadBytes']})
                materials[material.name]=graph
        object_row={'name':obj.name,'matrix':[[round(float(x),9) for x in row] for row in obj.matrix_world],'vertices':len(mesh.vertices),'polygons':len(mesh.polygons),'geometrySHA256':h.hexdigest(),'materials':mats}
        meshes.append(object_row)
    # An editable source package preserves every material datablock, including
    # unused materials and their unlinked historical nodes. Final-render GLB
    # equivalence uses per-face used materials in validate_workflow.py instead.
    for material in sorted(bpy.data.materials,key=lambda item:item.name):
        if material.name not in materials:materials[material.name]=material_graph_snapshot(material,False)
        for node in materials[material.name].get('nodes',[]):
            if node.get('image'):node['image'].pop('packed',None)
    materials_payload=[materials[name] for name in sorted(materials)]
    actions=animation_fingerprint()
    armatures=[{'name':obj.name,'world':[[round(float(x),9) for x in row] for row in obj.matrix_world],'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,'rest':[[round(float(x),9) for x in row] for row in b.matrix_local]} for b in obj.data.bones]} for obj in sorted((x for x in bpy.context.scene.objects if x.type=='ARMATURE'),key=lambda x:x.name)]
    return {'meshes':meshes,'materials':materials_payload,'images':sorted(all_images,key=lambda x:(x['material'],x['node'])),'imageDependencies':image_dependencies,'armatures':armatures,'animationFingerprint':actions['fingerprint']}

def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'))
    source=scene_summary(os.path.abspath(cfg['source']));managed=scene_summary(os.path.abspath(cfg['managed']))
    def semantic_view(summary):
        copy=json.loads(json.dumps(summary))
        for image in copy['imageDependencies']:image.pop('packed',None)
        return copy
    source_semantics=semantic_view(source);managed_semantics=semantic_view(managed)
    if digest_json(source_semantics)!=digest_json(managed_semantics):raise ValueError('Managed editable BLEND changed indexed material graph/settings, raw image dependency bytes, mesh/UV/normal/weight data, armature rest, object transforms, action keys, bindings or NLA state.')
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(cfg['portableCopy']));bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    unpacked=[image.name for image in bpy.data.images if image.source=='FILE' and not image.packed_file]
    if unpacked:raise ValueError('NEW-folder BLEND still depends on external image paths: '+repr(unpacked))
    portable=scene_summary(os.path.abspath(cfg['portableCopy']))
    if digest_json(semantic_view(managed))!=digest_json(semantic_view(portable)):raise ValueError('NEW-folder BLEND changed its verified graph, dependency closure, geometry or animation semantics.')
    portable_unpacked=[image.name for image in bpy.data.images if image.source=='FILE' and not image.packed_file]
    if portable_unpacked:raise ValueError('NEW-folder BLEND contains unpacked file images: '+repr(portable_unpacked))
    source_hash=hashlib.sha256(open(cfg['source'],'rb').read()).hexdigest();managed_hash=hashlib.sha256(open(cfg['managed'],'rb').read()).hexdigest();portable_hash=hashlib.sha256(open(cfg['portableCopy'],'rb').read()).hexdigest()
    dependency_hash=digest_json(semantic_view(managed)['imageDependencies'])
    result={'schemaVersion':2,'sourceHash':source_hash,'managedHash':managed_hash,'portableCopyHash':portable_hash,'sourceSemanticsSHA256':digest_json(source_semantics),'managedSemanticsSHA256':digest_json(managed_semantics),'portableSemanticsSHA256':digest_json(semantic_view(portable)),'meshCount':len(managed['meshes']),'materialCount':len(managed['materials']),'usedImageReferenceCount':len(managed['images']),'imageDependencyCount':len(managed['imageDependencies']),'fileImageDependencyCount':sum(1 for image in managed['imageDependencies'] if image['source']=='FILE'),'imageDependencyInventorySHA256':dependency_hash,'allFileImagesPackedInNewFolder':True,'allUsedImagesPackedInNewFolder':True,'armatureCount':len(managed['armatures']),'animationFingerprint':managed['animationFingerprint'],'graphSchemaVersion':2,'sourceAndManagedSemanticsEqual':True,'managedAndPortableSemanticsEqual':True,'sourceBytesIdenticalToManagedDerivative':source_hash==managed_hash,'newFolderOpenVerified':True,'autoexec':'disabled'}
    json.dump(result,open(cfg['output'],'w',encoding='utf8'),indent=2)
if __name__=='__main__':main()
