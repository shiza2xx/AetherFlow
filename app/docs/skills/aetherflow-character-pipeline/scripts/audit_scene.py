"""Read-only allowlisted GLB scene audit. Invoke Blender with --disable-autoexec."""
import bpy, sys, json, hashlib, struct, os, math

def digest(value): return hashlib.sha256(value).hexdigest()
def main():
    arg=sys.argv[sys.argv.index('--')+1]
    if arg.lower().endswith('.json'):
        cfg=json.load(open(arg,encoding='utf-8')); source=os.path.realpath(cfg['source']); output=cfg['output']; expected=cfg['expectedHash']
        h=hashlib.sha256()
        with open(source,'rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
        if h.hexdigest()!=expected: raise ValueError('Managed GLB changed before audit.')
        if not source.lower().endswith('.glb'): raise ValueError('Independent rig audit currently accepts safe embedded-texture GLB derivatives only.')
        bpy.ops.import_scene.gltf(filepath=source)
    else:
        source=''; output=arg; expected=''
    meshes=[]; total_vertices=0; invalid_weight_vertices=0; invalid_weight_entries=0; max_influences=0; normalized_vertices=0; zero_weight_vertices=0
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH': continue
        mesh=obj.data; total_vertices+=len(mesh.vertices)
        coords=b''.join(struct.pack('<3d',*v.co) for v in mesh.vertices)
        faces=b''.join(struct.pack('<I',i) for poly in mesh.polygons for i in poly.vertices)
        uvs=b''.join(struct.pack('<2d',*uv.uv) for uv in mesh.uv_layers.active.data) if mesh.uv_layers.active else b''
        groups=[]; sums=[]; support_counts=[]; local_max=0
        for vertex in mesh.vertices:
            entries=[]; invalid_vertex=False
            for assignment in vertex.groups:
                weight=float(assignment.weight)
                if not math.isfinite(weight) or weight<0.0: invalid_weight_entries+=1; invalid_vertex=True; continue
                if weight>0.0: entries.append((obj.vertex_groups[assignment.group].name,weight))
            entries.sort(key=lambda item:(item[0],item[1]))
            groups.append(entries); weight_sum=sum(weight for _,weight in entries); sums.append(weight_sum); support_counts.append(len(entries)); local_max=max(local_max,len(entries));
            if not entries: zero_weight_vertices+=1
            if entries and abs(weight_sum-1.0)<=0.001: normalized_vertices+=1
            if invalid_vertex or (entries and abs(weight_sum-1.0)>0.001): invalid_weight_vertices+=1
        max_influences=max(max_influences,local_max)
        meshes.append({'name':obj.name,'mesh':mesh.name,'vertices':len(mesh.vertices),'edges':len(mesh.edges),'polygons':len(mesh.polygons),'materials':[m.name if m else None for m in mesh.materials],'materialIndices':[poly.material_index for poly in mesh.polygons],'activeUV':mesh.uv_layers.active.name if mesh.uv_layers.active else None,'uvCount':len(mesh.uv_layers.active.data) if mesh.uv_layers.active else 0,'geometryFingerprint':digest(coords+faces),'uvFingerprint':digest(uvs),'groups':[g.name for g in obj.vertex_groups],'weightFingerprint':digest(json.dumps(groups,separators=(',',':')).encode()),'positiveInfluenceCounts':support_counts,'weightSums':sums,'maxInfluences':local_max})
    bones=[bone for obj in bpy.context.scene.objects if obj.type=='ARMATURE' for bone in obj.data.bones]
    rest=digest(b''.join(bone.name.encode()+b''.join(struct.pack('<d',v) for row in bone.matrix_local for v in row) for bone in bones))
    report={'schemaVersion':1,'inputHash':expected,'outputHash':expected,'blenderVersion':bpy.app.version_string,'source':source,'meshCount':len(meshes),'totalVertices':total_vertices,'objects':meshes,'boneCount':len(bones),'restPoseFingerprint':rest,'actions':[a.name for a in bpy.data.actions],'maxInfluences':max_influences,'normalizedWeightVertices':normalized_vertices,'invalidWeightVertices':invalid_weight_vertices,'invalidWeightEntries':invalid_weight_entries,'zeroWeightVertices':zero_weight_vertices,'weightSumsValid':invalid_weight_vertices==0,'autoexec':'disabled'}
    with open(output,'w',encoding='utf8') as f: json.dump(report,f,indent=2)
if __name__=='__main__': main()
