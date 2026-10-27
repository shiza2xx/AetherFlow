"""Explicit per-vertex group edits. Refuses stale topology maps."""
import bpy, sys, json, os, hashlib, struct

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def vertex_weights(obj):
    return [sorted((obj.vertex_groups[g.group].name,round(g.weight,8)) for g in v.groups) for v in obj.data.vertices]
def topology(obj):
    m=obj.data
    coords=b''.join(struct.pack('<3d',*v.co) for v in m.vertices)
    edges=b''.join(struct.pack('<2I',*e.vertices) for e in m.edges)
    faces=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.vertices)
    corners=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.loop_indices)
    return hashlib.sha256(coords+edges+faces+corners).hexdigest()
def surface_fingerprint(obj):
    m=obj.data;uv=b''.join(struct.pack('<2d',*loop.uv) for layer in m.uv_layers for loop in layer.data);normals=b''.join(struct.pack('<3d',*normal.vector) for normal in m.corner_normals)
    materials=json.dumps({'slots':[x.name if x else None for x in m.materials],'polygons':[p.material_index for p in m.polygons]},sort_keys=True,separators=(',',':')).encode()
    return hashlib.sha256(uv+normals+materials).hexdigest()

def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8')); source=os.path.abspath(cfg['input'])
    input_sha=sha(source)
    if input_sha!=cfg.get('inputHash'): raise ValueError('Managed source hash changed before repair.')
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False;bpy.ops.wm.open_mainfile(filepath=source);bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    obj=bpy.data.objects.get(cfg['object'])
    if obj is None or obj.type!='MESH': raise ValueError('Named mesh object not found.')
    if cfg.get('expectedVertexCount')!=len(obj.data.vertices): raise ValueError('Topology count mismatch; stale vertex map refused.')
    allowed=set(cfg.get('allowedGroups',[])); edits=cfg.get('vertices',{}); by_name={g.name:g for g in obj.vertex_groups}; changed=[]
    if not set(cfg.get('groups',[])).issubset(by_name): raise ValueError('Expected vertex group is missing.')
    changed_set={int(i) for i in edits}; before=vertex_weights(obj); topology_before=topology(obj);surface_before=surface_fingerprint(obj)
    if cfg.get('expectedTopologyFingerprint')!=topology_before: raise ValueError('Exact topology fingerprint mismatch; stale or reordered vertex maps are refused.')
    cap=cfg.get('maxInfluences')
    if cap is not None and (type(cap)is not int or cap<1 or cap>8): raise ValueError('An explicit influence cap must be between one and eight.')
    rest_before={o.name:tuple(round(float(v),8) for row in o.matrix_local for v in row) for o in bpy.context.scene.objects if o.type=='ARMATURE'}
    actions_before=[a.name for a in bpy.data.actions]
    for key,row in edits.items():
        idx=int(key)
        if not 0<=idx<len(obj.data.vertices): raise ValueError('Vertex index outside mesh.')
        if allowed and not set(row).issubset(allowed): raise ValueError('Edit uses an unapproved group.')
        if any(float(v)<0 for v in row.values()) or sum(map(float,row.values()))<=0: raise ValueError('Weights must be nonnegative with positive total.')
        if cap is not None and len(row)>cap: raise ValueError('Edited weights exceed the explicitly selected influence cap; no automatic truncation is performed.')
        for name in cfg['groups']:
            try: by_name[name].remove([idx])
            except RuntimeError: pass
        total=sum(map(float,row.values()))
        for name,value in row.items(): by_name[name].add([idx],float(value)/total,'REPLACE')
        changed.append(idx)
    after=vertex_weights(obj)
    for i in changed_set:
        row=after[i];total=sum(weight for _,weight in row)
        if not row or any(weight<0 for _,weight in row) or abs(total-1.0)>0.001: raise ValueError('Edited vertex weights must be normalized, finite and nonnegative.')
        if cap is not None and len(row)>cap: raise ValueError('Edited vertex exceeds the explicitly selected influence cap.')
    untouched=all(before[i]==after[i] for i in range(len(before)) if i not in changed_set)
    rest_after={o.name:tuple(round(float(v),8) for row in o.matrix_local for v in row) for o in bpy.context.scene.objects if o.type=='ARMATURE'}
    rest_ok=rest_before==rest_after;actions_after=[a.name for a in bpy.data.actions];actions_ok=actions_before==actions_after
    surface_ok=surface_fingerprint(obj)==surface_before
    if not untouched or not rest_ok or not actions_ok or topology(obj)!=topology_before or not surface_ok: raise ValueError('An unrequested weight, rest, action, topology, UV, normal or material invariant changed; candidate was not saved.')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(cfg['output']))
    report={'schemaVersion':1,'operation':'local-weight-repair','object':obj.name,'inputBlend':source,'inputSHA256':input_sha,'inputHashes':[input_sha],'output':os.path.abspath(cfg['output']),'outputSHA256':sha(cfg['output']),'outputHash':sha(cfg['output']),'topologyFingerprint':topology_before,'verticesChanged':changed,'editedVertices':{obj.name:changed},'untouchedVerticesPreserved':untouched,'surfaceFingerprintPreserved':surface_ok,'restMatricesPreserved':rest_ok,'actionsPreserved':actions_ok,'actionNames':actions_after,'maxInfluences':cfg.get('maxInfluences'),'autoexec':'disabled-by-runner','blenderVersion':bpy.app.version_string}
    with open(cfg['report'],'w',encoding='utf8') as f: json.dump(report,f,indent=2)
if __name__=='__main__': main()
