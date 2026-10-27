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
    faces=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.vertices)
    return hashlib.sha256(coords+faces).hexdigest()

def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8')); obj=bpy.data.objects.get(cfg['object'])
    if obj is None or obj.type!='MESH': raise ValueError('Named mesh object not found.')
    if cfg.get('expectedVertexCount')!=len(obj.data.vertices): raise ValueError('Topology count mismatch; stale vertex map refused.')
    allowed=set(cfg.get('allowedGroups',[])); edits=cfg.get('vertices',{}); by_name={g.name:g for g in obj.vertex_groups}; changed=[]
    if not set(cfg.get('groups',[])).issubset(by_name): raise ValueError('Expected vertex group is missing.')
    changed_set={int(i) for i in edits}; before=vertex_weights(obj); topology_before=topology(obj)
    rest_before={o.name:tuple(round(float(v),8) for row in o.matrix_local for v in row) for o in bpy.context.scene.objects if o.type=='ARMATURE'}
    actions_before=[a.name for a in bpy.data.actions]
    for key,row in edits.items():
        idx=int(key)
        if not 0<=idx<len(obj.data.vertices): raise ValueError('Vertex index outside mesh.')
        if allowed and not set(row).issubset(allowed): raise ValueError('Edit uses an unapproved group.')
        if any(float(v)<0 for v in row.values()) or sum(map(float,row.values()))<=0: raise ValueError('Weights must be nonnegative with positive total.')
        for name in cfg['groups']:
            try: by_name[name].remove([idx])
            except RuntimeError: pass
        total=sum(map(float,row.values()))
        for name,value in row.items(): by_name[name].add([idx],float(value)/total,'REPLACE')
        changed.append(idx)
    after=vertex_weights(obj)
    untouched=all(before[i]==after[i] for i in range(len(before)) if i not in changed_set)
    rest_after={o.name:tuple(round(float(v),8) for row in o.matrix_local for v in row) for o in bpy.context.scene.objects if o.type=='ARMATURE'}
    rest_ok=rest_before==rest_after;actions_after=[a.name for a in bpy.data.actions];actions_ok=actions_before==actions_after
    if not untouched or not rest_ok or not actions_ok or topology(obj)!=topology_before: raise ValueError('An unrequested weight, rest, action, or topology invariant changed; candidate was not saved.')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(cfg['output']))
    report={'schema':1,'operation':'local-weight-repair','object':obj.name,'inputBlend':bpy.data.filepath,'inputSHA256':sha(bpy.data.filepath),'output':os.path.abspath(cfg['output']),'outputSHA256':sha(cfg['output']),'topologyFingerprint':topology_before,'verticesChanged':changed,'untouchedVerticesPreserved':untouched,'restMatricesPreserved':rest_ok,'actionsPreserved':actions_ok,'actionNames':actions_after,'autoexec':'disabled-by-runner','blenderVersion':bpy.app.version_string}
    with open(cfg['report'],'w',encoding='utf8') as f: json.dump(report,f,indent=2)
if __name__=='__main__': main()
