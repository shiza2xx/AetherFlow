"""Apply explicit object transforms to a disposable .blend and emit topology mappings."""
import bpy,sys,json,os,hashlib,importlib.util,math
HERE=os.path.dirname(os.path.abspath(__file__));spec=importlib.util.spec_from_file_location('atelier_validate',os.path.join(HERE,'validate_workflow.py'));validator=importlib.util.module_from_spec(spec);spec.loader.exec_module(validator)
def sha(path): return validator.sha_file(path)
def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'));source=os.path.abspath(cfg['input']);before_hash=sha(source)
    if before_hash!=cfg['inputHash']:raise ValueError('Managed assembly input changed before transformation.')
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False;bpy.ops.wm.open_mainfile(filepath=source);bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    validator.enforce_blender_memory_budget('assembly source scene load')
    # The operation changes object transforms only. Rehashing every decoded
    # texture pixel for every mesh used the active-render fingerprint path and
    # made a routine transform exceed its timeout. Retain complete topology,
    # UV, loop-normal, slot/face correspondence, indexed graph socket and raw
    # connected-image byte checks while avoiding repeated image pixel decoding.
    source_meshes={o.name:validator.mesh_fingerprint(o,full=False) for o in bpy.context.scene.objects if o.type=='MESH'}
    source_materials={m.name:validator.material_graph_snapshot(m,False) for m in sorted(bpy.data.materials,key=lambda x:x.name)}
    source_animation=validator.animation_fingerprint()['fingerprint']
    source_object_transforms={o.name:{'location':[round(float(x),8) for x in o.location],'rotationDegrees':[round(math.degrees(float(x)),8) for x in o.rotation_euler],'scale':[round(float(x),8) for x in o.scale]} for o in bpy.context.scene.objects}
    transforms=cfg['transforms']
    if not isinstance(transforms,dict) or not transforms:raise ValueError('Assembly requires explicit per-object transforms.')
    for name,row in transforms.items():
        obj=bpy.data.objects.get(name)
        if obj is None or obj.type not in ('MESH','ARMATURE'):raise ValueError('Transform object must name a managed mesh or armature.')
        for key in ('location','rotationDegrees','scale'):
            values=row.get(key)
            if values is not None and (not isinstance(values,list) or len(values)!=3 or any(not math.isfinite(float(v)) for v in values)):raise ValueError('Transforms require finite three-axis vectors.')
        if row.get('location') is not None:obj.location=[float(v) for v in row['location']]
        if row.get('rotationDegrees') is not None:obj.rotation_euler=[math.radians(float(v)) for v in row['rotationDegrees']]
        if row.get('scale') is not None:
            if any(float(v)<0.001 or float(v)>1000 for v in row['scale']):raise ValueError('Assembly scale must remain between 0.001 and 1000.')
            obj.scale=[float(v) for v in row['scale']]
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH' and validator.mesh_fingerprint(obj,full=False)!=source_meshes[obj.name]:raise ValueError('Assembly transform modified mesh topology, normals, UVs or material-face assignments.')
    if {m.name:validator.material_graph_snapshot(m,False) for m in sorted(bpy.data.materials,key=lambda x:x.name)}!=source_materials:raise ValueError('Assembly transform modified indexed material graphs, settings or connected raw-image bytes.')
    if validator.animation_fingerprint()['fingerprint']!=source_animation:raise ValueError('Assembly transform modified authored animation keys, bindings, NLA or armature rest data.')
    object_transforms={}
    for obj in bpy.context.scene.objects:
        actual={'location':[round(float(x),8) for x in obj.location],'rotationDegrees':[round(math.degrees(float(x)),8) for x in obj.rotation_euler],'scale':[round(float(x),8) for x in obj.scale]}
        expected=transforms.get(obj.name,source_object_transforms.get(obj.name))
        mismatches={key:{'actual':actual[key],'expected':[round(float(x),8) for x in expected.get(key,source_object_transforms[obj.name][key])]} for key in ('location','rotationDegrees','scale') if expected is not None and any(abs(a-b)>1e-6 for a,b in zip(actual[key],[round(float(x),8) for x in expected.get(key,source_object_transforms[obj.name][key])]))}
        if mismatches:raise ValueError('Assembly transform did not preserve the requested/untouched authored object transform: '+obj.name+' '+json.dumps(mismatches,sort_keys=True))
        object_transforms[obj.name]=actual
    validator.enforce_blender_memory_budget('assembly final source and material verification')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(cfg['output']))
    mappings=[{'sourceObject':name,'outputObject':name,'sourceFingerprint':row['geometry'],'outputFingerprint':row['geometry']} for name,row in source_meshes.items()]
    report={'schemaVersion':1,'operation':'assembly-transform','inputHashes':[before_hash],'outputHash':sha(cfg['output']),'objectMappings':mappings,'transforms':transforms,'objectTransforms':object_transforms,'materialGraphsPreserved':True,'animationFingerprintPreserved':True,'meshGeometryPreserved':True,'verification':'complete topology/UV/loop-normal/material-face plus indexed graph/raw connected-image and authored animation checks; texture pixels are not redundantly decoded for transform-only operations','autoexec':'disabled-by-runner','blenderVersion':bpy.app.version_string}
    with open(cfg['report'],'w',encoding='utf8') as f:json.dump(report,f,indent=2)
if __name__=='__main__':main()
