"""Read-only inventory for a returned character rig. Run in trusted Blender with --disable-autoexec."""
import bpy, hashlib, json, sys

def main(output):
    objects=[]
    for obj in bpy.context.scene.objects:
        if obj.type not in {'MESH','ARMATURE'}: continue
        item={'name':obj.name,'type':obj.type,'matrixWorld':[[round(v,9) for v in row] for row in obj.matrix_world],
              'actions':[],'modifiers':[]}
        if obj.type=='MESH':
            item['vertices']=len(obj.data.vertices); item['polygons']=len(obj.data.polygons)
            item['vertexGroups']=[g.name for g in obj.vertex_groups]
            item['weightedVertexCount']=sum(1 for v in obj.data.vertices if v.groups)
            item['materials']=[m.name if m else None for m in obj.data.materials]
            item['uvLayers']=[uv.name for uv in obj.data.uv_layers]
        else:
            item['bones']=[{'name':b.name,'parent':b.parent.name if b.parent else None,
                            'restMatrix':[[round(v,9) for v in row] for row in b.matrix_local]}
                           for b in obj.data.bones]
        if obj.animation_data and obj.animation_data.action: item['actions'].append(obj.animation_data.action.name)
        item['modifiers']=[{'name':m.name,'type':m.type,'target':m.object.name if m.type=='ARMATURE' and m.object else None} for m in obj.modifiers]
        objects.append(item)
    result={'schema':1,'blenderVersion':bpy.app.version_string,'objects':objects,
            'actions':sorted(a.name for a in bpy.data.actions),'sourceFile':bpy.data.filepath}
    raw=json.dumps(result,sort_keys=True,separators=(',',':')).encode()
    result['inventorySha256']=hashlib.sha256(raw).hexdigest()
    with open(output,'w',encoding='utf-8') as f: json.dump(result,f,indent=2)

if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    if len(args)!=1: raise SystemExit('usage: blender --background --disable-autoexec --python audit_returned_rig.py -- <report.json>')
    main(args[0])
