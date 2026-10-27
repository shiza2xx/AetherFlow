"""Explicit, proximity-bounded barycentric weight transfer for selected vertices only."""
import bpy, sys, os, json, hashlib, struct
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for c in iter(lambda:f.read(1024*1024),b''): h.update(c)
    return h.hexdigest()
def topo(o):
    m=o.data
    b=b''.join(struct.pack('<3d',*v.co) for v in m.vertices)
    b+=b''.join(struct.pack('<2I',*e.vertices) for e in m.edges)
    b+=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.vertices)
    b+=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.loop_indices)
    return hashlib.sha256(b).hexdigest()
def skeleton(objects=None):
    rows=[]
    for o in (objects if objects is not None else bpy.context.scene.objects):
        if o.type!='ARMATURE': continue
        for b in o.data.bones:
            rows.append((b.name,b.parent.name if b.parent else None,tuple(round(x,7) for row in b.matrix_local for x in row)))
    return sorted(rows)
def weights(obj,index):
    return {obj.vertex_groups[g.group].name:g.weight for g in obj.data.vertices[index].groups}
def barycentric(p,a,b,c):
    v0=b-a;v1=c-a;v2=p-a
    d00=v0.dot(v0);d01=v0.dot(v1);d11=v1.dot(v1);d20=v2.dot(v0);d21=v2.dot(v1)
    den=d00*d11-d01*d01
    if abs(den)<1e-15: raise ValueError('Donor contains a degenerate triangle.')
    v=(d11*d20-d01*d21)/den;w=(d00*d21-d01*d20)/den
    vals=[1-v-w,v,w];vals=[max(0.0,x) for x in vals];total=sum(vals)
    if total<=0: raise ValueError('Barycentric projection has no usable weights.')
    return [x/total for x in vals]
def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'))
    if sha(cfg['target'])!=cfg['targetHash'] or sha(cfg['donor'])!=cfg['donorHash']: raise ValueError('Managed target or donor bytes changed.')
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    bpy.ops.wm.open_mainfile(filepath=cfg['target']);bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    target=bpy.data.objects.get(cfg['targetObject'])
    if not target or target.type!='MESH': raise ValueError('Target mesh object was not found.')
    if topo(target)!=cfg['expectedTopologyFingerprint']: raise ValueError('Exact target topology fingerprint mismatch; stale transfer refused.')
    if len(target.data.vertices)!=cfg['expectedVertexCount']: raise ValueError('Target vertex count changed.')
    target_skeleton=skeleton()
    target_actions=sorted(a.name for a in bpy.data.actions);target_mesh_count=sum(1 for o in bpy.context.scene.objects if o.type=='MESH')
    donor_path=os.path.abspath(cfg['donor'])
    donor_ext=os.path.splitext(donor_path)[1].lower()
    if donor_ext!='.blend': raise ValueError('Barycentric transfer requires a managed Blender donor scene.')
    if cfg['donorHash']==cfg['targetHash']:
        if cfg['donorObject']!=cfg['targetObject']: raise ValueError('A same-scene donor must use the same named object.')
        donor=target;donor_objects=[]
    else:
        with bpy.data.libraries.load(donor_path,link=False) as (data_from,data_to):
            if cfg['donorObject'] not in data_from.objects: raise ValueError('Donor mesh object was not found in the source scene.')
            data_to.objects=list(data_from.objects)
        donor_objects=[o for o in data_to.objects if o is not None]
        for o in donor_objects: bpy.context.scene.collection.objects.link(o)
        donor=next((o for o in donor_objects if o.name.split('.')[0]==cfg['donorObject']),None)
    if not donor or donor.type!='MESH': raise ValueError('Donor mesh object was not found.')
    donor_skeleton=target_skeleton if cfg['donorHash']==cfg['targetHash'] else skeleton(donor_objects)
    if target_skeleton!=donor_skeleton: raise ValueError('Donor and target armature/rest hierarchy differs; transfer is refused.')
    mapping=cfg.get('groups',{})
    if not mapping or any(not isinstance(k,str) or not isinstance(v,str) for k,v in mapping.items()): raise ValueError('Explicit donor-to-target group mapping is required.')
    donor_groups={g.name:g for g in donor.vertex_groups};target_groups={g.name:g for g in target.vertex_groups}
    if not set(mapping).issubset(donor_groups) or not set(mapping.values()).issubset(target_groups): raise ValueError('Mapped groups are missing from donor or target.')
    affected=cfg.get('vertices',[]);regions=cfg.get('regions',{});max_distance=float(cfg.get('maxDistance',0))
    if not affected or len(set(affected))!=len(affected) or any(type(i)is not int or i<0 or i>=len(target.data.vertices) for i in affected): raise ValueError('Explicit affected target vertex list is invalid.')
    if max_distance<=0 or max_distance>10: raise ValueError('A positive bounded maximum transfer distance is required.')
    if any(str(i) not in regions or not regions[str(i)] for i in affected): raise ValueError('Each affected vertex needs an explicit anatomical/connected-region group allowlist.')
    original={i:weights(target,i) for i in range(len(target.data.vertices))};before_topology=topo(target)
    donor_world=[donor.matrix_world@v.co for v in donor.data.vertices];tris=[]
    for poly in donor.data.polygons:
        ids=list(poly.vertices)
        for n in range(1,len(ids)-1): tris.append((ids[0],ids[n],ids[n+1]))
    bvh=BVHTree.FromPolygons(donor_world,tris,all_triangles=True)
    transferred=[]
    for i in affected:
        point=target.matrix_world@target.data.vertices[i].co
        nearest,normal,face_index,distance=bvh.find_nearest(point,max_distance)
        if nearest is None or face_index is None: raise ValueError('Selected target vertex is outside the explicit maximum donor distance.')
        tri=tris[face_index];alpha=barycentric(nearest,*(donor_world[j] for j in tri));allowed=set(regions[str(i)])
        if not allowed.issubset(set(mapping.values())): raise ValueError('Region group allowlist is outside the explicit transfer mapping.')
        values={name:0.0 for name in allowed}
        for donor_name,target_name in mapping.items():
            if target_name not in allowed: continue
            v=sum(alpha[k]*weights(donor,tri[k]).get(donor_name,0.0) for k in range(3))
            if v>0: values[target_name]=v
        total=sum(values.values())
        if total<=1e-8: raise ValueError('Projected donor weights contain no selected region influences.')
        values={k:v/total for k,v in values.items() if v>1e-8}
        for group in target.vertex_groups:
            try: group.remove([i])
            except RuntimeError: pass
        for name,value in values.items(): target_groups[name].add([i],value,'REPLACE')
        transferred.append({'vertex':i,'donorTriangle':list(tri),'distance':float(distance),'weights':values})
    for donor_object in donor_objects: bpy.data.objects.remove(donor_object,do_unlink=True)
    if any(original[i]!=weights(target,i) for i in range(len(original)) if i not in set(affected)): raise ValueError('Unselected target weights changed.')
    if topo(target)!=before_topology or skeleton()!=target_skeleton or sorted(a.name for a in bpy.data.actions)!=target_actions or sum(1 for o in bpy.context.scene.objects if o.type=='MESH')!=target_mesh_count: raise ValueError('Weight transfer changed target topology, scene objects, skeleton/rest hierarchy or actions.')
    out=os.path.abspath(cfg['output']);bpy.ops.wm.save_as_mainfile(filepath=out)
    with open(cfg['report'],'w',encoding='utf8') as f: json.dump({'schemaVersion':1,'autoexec':'disabled-by-runner','inputHashes':[cfg['targetHash'],cfg['donorHash']],'targetTopologyFingerprint':before_topology,'outputHash':sha(out),'affectedVertices':transferred,'unselectedWeightsPreserved':True,'skeletonPreserved':True,'actionsPreserved':True,'targetMeshCount':target_mesh_count,'maxDistance':max_distance,'blenderVersion':bpy.app.version_string},f,indent=2)
if __name__=='__main__': main()
