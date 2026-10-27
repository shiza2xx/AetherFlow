"""Hash topology, corner order, UVs, normals, materials, rest rig, weights and actions."""
import bpy,sys,json,hashlib,struct,os,pathlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from preservation_fingerprint import animation_fingerprint, material_graph_snapshot, clear_image_fingerprint_cache, read_only_image_capture, IMAGE_FINGERPRINT_VERSION
def digest(data): return hashlib.sha256(data).hexdigest()
@read_only_image_capture
def material_signature(material,include_image_pixels=True):
    if not material:return None
    graph=material_graph_snapshot(material,include_image_pixels)
    result={'name':material.name,'schemaVersion':2,'settings':graph.get('settings',{}),'nodes':graph['nodes'],'links':graph['links'],
        'fingerprintVersion':IMAGE_FINGERPRINT_VERSION}
    return result
def mesh_row(obj,include_image_pixels=True):
    m=obj.data; coords=b''.join(struct.pack('<3d',*v.co) for v in m.vertices);edges=b''.join(struct.pack('<2I',*e.vertices) for e in m.edges);faces=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.vertices);corners=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.loop_indices);uv=b''.join(struct.pack('<2d',*loop.uv) for layer in m.uv_layers for loop in layer.data);normals=b''.join(struct.pack('<3d',*n.vector) for n in m.corner_normals)
    materials=json.dumps({'slots':[material_signature(x,include_image_pixels) for x in m.materials],'faces':[p.material_index for p in m.polygons]},sort_keys=True,separators=(',',':')).encode()
    groups=[g.name for g in obj.vertex_groups];weights=[]
    for vertex in m.vertices: weights.append(sorted((groups[g.group],round(float(g.weight),8)) for g in vertex.groups if g.weight>1e-8))
    return {'object':obj.name,'vertexCount':len(m.vertices),'edgeCount':len(m.edges),'faceCount':len(m.polygons),'loopCount':len(m.loops),'topology':digest(coords+edges+faces+corners),'uv':digest(uv),'cornerNormals':digest(normals),'materials':digest(materials),'groupNames':groups,'weights':digest(json.dumps(weights,separators=(',',':')).encode()),'objectMatrix':[round(float(x),9) for row in obj.matrix_world for x in row]}
@read_only_image_capture
def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8')); source=os.path.abspath(cfg['source']); before=digest(open(source,'rb').read())
    if before!=cfg['inputHash']: raise ValueError('Input changed before fingerprint capture.')
    ext=pathlib.Path(source).suffix.lower()
    clear_image_fingerprint_cache()
    if ext=='.blend': bpy.ops.wm.open_mainfile(filepath=source)
    elif ext in ('.glb','.gltf'): bpy.ops.import_scene.gltf(filepath=source)
    elif ext=='.fbx': bpy.ops.import_scene.fbx(filepath=source,automatic_bone_orientation=False)
    else: raise ValueError('Fingerprint accepts BLEND, GLB/glTF or FBX.')
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    compact=cfg.get('scope')=='weight-map';rows={o.name:mesh_row(o,not compact) for o in bpy.context.scene.objects if o.type=='MESH'}
    if compact:
        armatures=[{'object':o.name,'world':[round(float(v),8) for row in o.matrix_world for v in row],'bones':[b.name for b in o.data.bones]} for o in bpy.context.scene.objects if o.type=='ARMATURE'];actions=sorted(a.name for a in bpy.data.actions);animation=None;animation_state=None
    else:
        preservation=animation_fingerprint();armatures=preservation['payload']['armatures'];actions=preservation['payload']['actions'];animation=preservation['fingerprint'];animation_state=preservation['payload']
    payload={'schemaVersion':2,'fingerprintVersion':IMAGE_FINGERPRINT_VERSION,'sourceHash':before,'blenderVersion':bpy.app.version_string,'scope':'weight-map' if compact else 'full','meshes':rows,'armatures':armatures,'actions':actions,'animationFingerprint':animation,'animationState':animation_state,'totalVertices':sum(x['vertexCount'] for x in rows.values()),'autoexec':'disabled-by-runner'}
    payload['sceneFingerprint']=digest(json.dumps(payload,sort_keys=True,separators=(',',':')).encode());json.dump(payload,open(cfg['output'],'w',encoding='utf8'),indent=2)
if __name__=='__main__': main()
