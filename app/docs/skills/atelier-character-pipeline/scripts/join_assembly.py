"""Safely join a declared set of compatible meshes with per-face source lineage."""
import bpy,sys,json,os,hashlib,struct
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from preservation_fingerprint import animation_fingerprint
from gltf_weight_export import export_glb_preserving_all_weights,temporary_armature_mesh_parents_for_gltf

def build_loop_triangle_export_mesh(obj):
    source=obj.data
    if source.shape_keys and len(source.shape_keys.key_blocks)>1:
        raise ValueError('Loop-triangle GLB export cannot discard source mesh shape keys; use a direct non-join export.')
    if getattr(source,'color_attributes',None) and len(source.color_attributes):
        raise ValueError('Loop-triangle GLB export cannot silently omit source color attributes; use a direct non-join export.')
    source.calc_loop_triangles();loop_triangles=list(source.loop_triangles)
    source_groups=[]
    for group in obj.vertex_groups:
        by_weight={}
        for vertex in source.vertices:
            for assignment in vertex.groups:
                if assignment.group==group.index:
                    by_weight.setdefault(float(assignment.weight),[]).append(vertex.index)
        source_groups.append((group.name,group.lock_weight,by_weight))
    active_group_index=obj.vertex_groups.active_index
    target=bpy.data.meshes.new(source.name+' · source loop-triangle export')
    target.from_pydata([vertex.co.copy() for vertex in source.vertices],[tuple(edge.vertices) for edge in source.edges],[tuple(triangle.vertices) for triangle in loop_triangles])
    for material in source.materials:target.materials.append(material)
    target.update()
    for layer in source.uv_layers:
        copied=target.uv_layers.new(name=layer.name)
        for face,triangle in enumerate(loop_triangles):
            for corner,loop_index in enumerate(triangle.loops):copied.data[face*3+corner].uv=layer.data[loop_index].uv
    for face,triangle in enumerate(loop_triangles):
        polygon=source.polygons[triangle.polygon_index];target.polygons[face].material_index=polygon.material_index;target.polygons[face].use_smooth=polygon.use_smooth
    target.normals_split_custom_set([tuple(source.corner_normals[loop_index].vector) for triangle in loop_triangles for loop_index in triangle.loops])
    if source.uv_layers.active:target.uv_layers.active_index=source.uv_layers.active_index
    for index,layer in enumerate(source.uv_layers):target.uv_layers[index].active_render=layer.active_render
    obj.data=target
    try:
        for name,locked,by_weight in source_groups:
            group=obj.vertex_groups.new(name=name)
            for weight,indices in by_weight.items():group.add(indices,weight,'REPLACE')
            group.lock_weight=locked
        if source_groups:obj.vertex_groups.active_index=min(active_group_index,len(source_groups)-1)
    except Exception:
        obj.data=source;bpy.data.meshes.remove(target);raise
    return target,len(loop_triangles)

def sha(p):
 h=hashlib.sha256()
 with open(p,'rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def main():
 cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'));src=os.path.abspath(cfg['input'])
 print('ATELIER_PROGRESS|10|Opening checkpointed assembly source',flush=True)
 if sha(src)!=cfg['inputHash']:raise ValueError('Assembly source changed before join.')
 bpy.context.preferences.filepaths.use_scripts_auto_execute=False;bpy.ops.wm.open_mainfile(filepath=src);bpy.context.preferences.filepaths.use_scripts_auto_execute=False
 source_preservation=animation_fingerprint()
 names=cfg['objects']
 if not isinstance(names,list) or len(names)<2 or len(set(names))!=len(names):raise ValueError('Join requires at least two distinct explicitly selected meshes.')
 objects=[]
 for name in names:
  obj=bpy.data.objects.get(name)
  if obj is None or obj.type!='MESH':raise ValueError('Every join source must be an explicitly named mesh: '+str(name))
  objects.append(obj)
 def rig_signature(obj):
  if any(m.type!='ARMATURE' for m in obj.modifiers):raise ValueError('Join refuses non-armature modifiers that would be discarded or reordered.')
  if obj.animation_data and (obj.animation_data.action or len(obj.animation_data.nla_tracks)):raise ValueError('Join refuses animated mesh objects; preserve their object actions in a separate operation.')
  if obj.parent and obj.parent_type!='OBJECT':raise ValueError('Join refuses mesh parenting that would change on join.')
  return tuple(sorted((m.type,m.object.name if m.object else None) for m in obj.modifiers if m.type=='ARMATURE'))
 if len({rig_signature(o) for o in objects})!=1:raise ValueError('Join sources need matching vertex-group names and armature binding; reconcile rig mappings first.')
 scene=bpy.context.scene;original_meshes=[o for o in scene.objects if o.type=='MESH']
 if set(names)!=set(o.name for o in original_meshes):raise ValueError('Join must account for every mesh in the candidate; requested='+repr(names)+' actual='+repr([o.name for o in original_meshes]))
 rows=[]
 print('ATELIER_PROGRESS|45|Recording deterministic source face lineage',flush=True)
 for ordinal,obj in enumerate(objects):
  mesh=obj.data
  if any(a.name.startswith('atelier_source_') for a in mesh.attributes):raise ValueError('Source mesh already uses the reserved Atelier lineage attribute namespace.')
  source_faces=len(mesh.polygons);source_loops=len(mesh.loops)
  point_ord=mesh.attributes.get('atelier_source_point_ordinal') or mesh.attributes.new('atelier_source_point_ordinal','INT','POINT')
  point_index=mesh.attributes.get('atelier_source_vertex') or mesh.attributes.new('atelier_source_vertex','INT','POINT')
  for vertex in mesh.vertices:point_ord.data[vertex.index].value=ordinal;point_index.data[vertex.index].value=vertex.index
  attr=mesh.attributes.get('atelier_source_ordinal') or mesh.attributes.new('atelier_source_ordinal','INT','FACE')
  face_attr=mesh.attributes.get('atelier_source_face') or mesh.attributes.new('atelier_source_face','INT','FACE')
  for p in mesh.polygons:attr.data[p.index].value=ordinal;face_attr.data[p.index].value=p.index
  rows.append({'ordinal':ordinal,'object':obj.name,'faces':source_faces,'vertices':len(mesh.vertices),'loops':source_loops,'uvLayers':[u.name for u in mesh.uv_layers],'materials':[m.name if m else None for m in mesh.materials]})
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:o.select_set(True)
 active=objects[0];bpy.context.view_layer.objects.active=active
 bpy.ops.object.join();joined=bpy.context.view_layer.objects.active
 after_join_preservation=animation_fingerprint()
 if after_join_preservation['fingerprint']!=source_preservation['fingerprint']:raise ValueError('Mesh join itself changed armature/action preservation state: '+repr({'before':source_preservation['payload'],'afterJoin':after_join_preservation['payload']}))
 print('ATELIER_PROGRESS|75|Verifying joined object face and rig correspondence',flush=True)
 if joined is None or joined.type!='MESH':raise ValueError('Blender failed to produce the joined mesh.')
 ord_attr=joined.data.attributes.get('atelier_source_ordinal');face_attr=joined.data.attributes.get('atelier_source_face')
 if ord_attr is None or face_attr is None:raise ValueError('Joined mesh lost deterministic face lineage attributes.')
 mapping={str(i):[] for i in range(len(rows))}
 for poly in joined.data.polygons:
  ordinal=int(ord_attr.data[poly.index].value);face=int(face_attr.data[poly.index].value)
  if ordinal not in range(len(rows)) or face not in range(rows[ordinal]['faces']):raise ValueError('Joined lineage references an invalid source face.')
  mapping[str(ordinal)].append({'sourceFace':face,'outputFace':poly.index,'materialIndex':poly.material_index,'loopCount':len(poly.loop_indices)})
 for row in rows:
  actual=sorted(x['sourceFace'] for x in mapping[str(row['ordinal'])])
  if actual!=list(range(row['faces'])):raise ValueError('Joined face correspondence is incomplete or duplicated.')
 joined_name=joined.name;out=os.path.abspath(cfg['output']);bpy.ops.wm.save_as_mainfile(filepath=out)
 joined.data.calc_loop_triangles();expected_triangles=len(joined.data.loop_triangles);expected_materials=sorted({m.name for m in joined.data.materials if m});scene_meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];print('ATELIER_JOIN_EXPORT_SCENE|'+repr([(o.name,o.type,len(o.data.vertices),len(o.data.polygons)) for o in scene_meshes]),flush=True)
 if scene_meshes!=[joined]:raise ValueError('Join left an undeclared mesh in scene; refusing to export extra geometry: '+repr([(o.name,len(o.data.vertices),len(o.data.polygons)) for o in scene_meshes]))
 glb=os.path.splitext(out)[0]+'.glb';bpy.ops.object.select_all(action='DESELECT');joined.select_set(True)
 for armature in [o for o in bpy.context.scene.objects if o.type=='ARMATURE']:armature.select_set(True)
 bpy.context.view_layer.objects.active=joined;source_mesh=joined.data;export_mesh,export_triangle_count=build_loop_triangle_export_mesh(joined);joined.data=export_mesh
 try:
  with temporary_armature_mesh_parents_for_gltf([joined]+[o for o in bpy.context.scene.objects if o.type=='ARMATURE']):
   weight_export_policy=export_glb_preserving_all_weights(filepath=glb,export_yup=True,use_selection=True)
 finally:joined.data=source_mesh;bpy.data.meshes.remove(export_mesh)
 # Reopen the serialized managed candidate and verify face lineage survived actual serialization.
 bpy.ops.wm.open_mainfile(filepath=out);bpy.context.preferences.filepaths.use_scripts_auto_execute=False;joined=bpy.data.objects.get(joined_name)
 if joined is None or joined.type!='MESH':raise ValueError('Reopened joined candidate is missing.')
 ord_attr=joined.data.attributes.get('atelier_source_ordinal');face_attr=joined.data.attributes.get('atelier_source_face')
 if ord_attr is None or face_attr is None:raise ValueError('Saved/reopened candidate lost face lineage.')
 check={str(i):[] for i in range(len(rows))}
 for poly in joined.data.polygons:check[str(int(ord_attr.data[poly.index].value))].append(int(face_attr.data[poly.index].value))
 if any(sorted(check[str(r['ordinal'])])!=list(range(r['faces'])) for r in rows):raise ValueError('Reopened candidate correspondence does not match the saved source manifest.')
 reopened_preservation=animation_fingerprint()
 if reopened_preservation['fingerprint']!=source_preservation['fingerprint']:raise ValueError('Serialized join changed animation curves, bindings, NLA, armature world transforms, or rest pose: '+repr({'before':source_preservation['payload'],'after':reopened_preservation['payload']}))
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.context.preferences.filepaths.use_scripts_auto_execute=False;bpy.ops.import_scene.gltf(filepath=glb);bpy.context.preferences.filepaths.use_scripts_auto_execute=False
 imported=[o for o in bpy.context.scene.objects if o.type=='MESH'];actual_triangles=sum(max(0,len(p.vertices)-2) for o in imported for p in o.data.polygons);actual_materials=sorted({m.name for o in imported for m in o.data.materials if m})
 if not imported:raise ValueError('Actual GLB export could not be reimported as a mesh.')
 report={'schemaVersion':1,'operation':'assembly-join','inputHashes':[cfg['inputHash']],'outputHash':sha(out),'objects':rows,'joinedObject':joined_name,'sourceFaceMap':mapping,'faceLineageVerifiedAfterReopen':True,'exportReimportImported':True,'exportFormat':'glb','exportHash':sha(glb),'exportAllInfluences':True,'weightExportPolicy':weight_export_policy,'sourceTriangleCount':expected_triangles,'loopTriangleExportCount':export_triangle_count,'triangulationPolicy':'explicit source Mesh.loop_triangles; oriented corner order, UVs, split normals and material indices copied to temporary export-only mesh','importedSceneTriangleCount':actual_triangles,'sourceMaterials':expected_materials,'importedSceneMaterials':actual_materials,'animationFingerprint':source_preservation['fingerprint'],'newBaselineRequired':True,'autoexec':'disabled-by-runner','blenderVersion':bpy.app.version_string}
 with open(cfg['report'],'w',encoding='utf8') as f:json.dump(report,f,indent=2)
if __name__=='__main__':main()
