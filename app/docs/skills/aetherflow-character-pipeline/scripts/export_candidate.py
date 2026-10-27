"""Export a disposable managed scene copy and inspect the exact reopened output."""
import bpy,sys,json,os,hashlib,pathlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from gltf_weight_export import export_glb_preserving_all_weights,temporary_armature_mesh_parents_for_gltf
from export_selection import exportable_objects
from export_validation import verify_glb_triangle_counts
from validate_workflow import enforce_blender_memory_budget

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def import_model(filepath,fmt):
    if fmt in ('glb','gltf'): bpy.ops.import_scene.gltf(filepath=filepath)
    elif fmt=='fbx': bpy.ops.import_scene.fbx(filepath=filepath,automatic_bone_orientation=False)
    elif fmt=='obj': bpy.ops.wm.obj_import(filepath=filepath)
    elif fmt=='blend': bpy.ops.wm.open_mainfile(filepath=filepath)
    else: raise ValueError('Unsupported managed model format: '+fmt)

def choose_objects(objects,exclude_startup=True):
    export_objects=exportable_objects(objects,exclude_startup)
    if not any(obj.type=='MESH' for obj in export_objects):
        raise ValueError('Managed export requires at least one imported mesh object.')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in export_objects: obj.select_set(True)
    bpy.context.view_layer.objects.active=next((obj for obj in export_objects if obj.type=='MESH'),export_objects[0])
    return export_objects

def inspect_scene(objects):
    # Blender's glTF importer creates viewport-only custom bone shapes in
    # this collection and links them into the active scene. They are not GLB
    # mesh primitives and must not inflate reopened geometry counts/bounds.
    special=bpy.data.collections.get('glTF_not_exported')
    custom_shapes={bone.custom_shape for armature in bpy.context.scene.objects if armature.type=='ARMATURE' for bone in armature.pose.bones if bone.custom_shape}
    importer_shapes=set(special.objects)&custom_shapes if special else set()
    objects=[obj for obj in objects if obj not in importer_shapes]
    meshes=[obj for obj in objects if obj.type=='MESH']
    armatures=[obj for obj in objects if obj.type=='ARMATURE']
    points=[]
    for obj in meshes:
        points.extend(obj.matrix_world @ __import__('mathutils').Vector(corner) for corner in obj.bound_box)
    bounds=None
    if points:
        bounds={'min':[min(point[i] for point in points) for i in range(3)],'max':[max(point[i] for point in points) for i in range(3)]}
    return {'meshCount':len(meshes),'armatureCount':len(armatures),'vertexCount':sum(len(obj.data.vertices) for obj in meshes),'polygonCount':sum(len(obj.data.polygons) for obj in meshes),'triangleCount':sum(max(1,len(poly.vertices)-2) for obj in meshes for poly in obj.data.polygons),'objectNames':sorted(obj.name for obj in objects),'meshNames':sorted(obj.name for obj in meshes),'armatureNames':sorted(obj.name for obj in armatures),'materialNames':sorted({material.name for obj in meshes for material in obj.data.materials if material}),'bounds':bounds}

def verify_reopened(source, reopened, fmt):
    # glTF exporters may split a source mesh into multiple reopened mesh
    # objects at material boundaries. Exact total triangulation, bounds,
    # material inventory and armature counts below remain the preservation
    # proof; object count alone is not stable across this format boundary.
    if fmt!='glb' and reopened['meshCount']!=source['meshCount']:
        raise ValueError('Reopened export mesh count differs from its explicit source selection: '+str(source['meshCount'])+' -> '+str(reopened['meshCount'])+'.')
    if reopened['armatureCount']!=source['armatureCount']:
        raise ValueError('Reopened export armature count differs from its explicit source selection.')
    if fmt=='blend' and reopened['vertexCount']!=source['vertexCount']:
        raise ValueError('Editable BLEND output changed source vertex counts.')
    if fmt!='blend' and (reopened['vertexCount']<source['vertexCount'] or reopened['vertexCount']>source['triangleCount']*3):
        raise ValueError('Reopened export vertex count falls outside format-appropriate source geometry bounds.')
    if not source['bounds'] or not reopened['bounds']:
        raise ValueError('Source and reopened export must both have measurable geometry bounds.')
    for side in ('min','max'):
        for axis,(expected,actual) in enumerate(zip(source['bounds'][side],reopened['bounds'][side])):
            tolerance=max(1e-5,abs(expected)*1e-5)
            if abs(expected-actual)>tolerance:
                raise ValueError('Reopened export bounds differ from the selected source geometry.')
    if len(reopened['materialNames'])!=len(source['materialNames']):
        raise ValueError('Reopened export material count differs from the selected source geometry.')
    if fmt=='blend' and reopened['polygonCount']!=source['polygonCount']:
        raise ValueError('Editable BLEND output changed source polygon counts.')
    if fmt in ('glb','gltf'):
        # glTF triangulates every polygon; the reopened triangle count must
        # account for exactly the source surface, with neither missing nor
        # additional faces.
        verify_glb_triangle_counts(source,reopened)
    elif reopened['polygonCount'] not in (source['polygonCount'],source['triangleCount']):
        raise ValueError('Reopened export polygon counts do not match source or format triangulation.')

def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'))
    source=os.path.abspath(cfg['source']); output=os.path.abspath(cfg['output']); fmt=cfg['format'].lower()
    before=sha(source)
    if before!=cfg['inputHash']: raise ValueError('Managed source hash changed before export.')
    ext=pathlib.Path(source).suffix.lower()
    source_fmt={'.blend':'blend','.glb':'glb','.gltf':'gltf','.fbx':'fbx','.obj':'obj'}.get(ext)
    if not source_fmt: raise ValueError('Unsupported managed source model format.')
    if source_fmt=='blend':
        bpy.ops.wm.open_mainfile(filepath=source);enforce_blender_memory_budget('source scene load before managed export')
        # Once the registered BLEND is opened, even default-named objects are
        # part of its explicit source scene. Camera/light objects are ignored
        # by exportable_objects because they are not mesh/armature objects;
        # filtering the mesh named "Cube" would silently drop valid geometry.
        imported=[obj for obj in bpy.context.scene.objects if obj.type in ('MESH','ARMATURE')]
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.preferences.filepaths.use_scripts_auto_execute=False
        import_model(source,source_fmt)
        imported=list(bpy.context.scene.objects)
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    # Non-BLEND imports started from an empty scene, so every imported mesh and
    # armature is source-authored even when the importer names it Cube/Camera/Light.
    # Keep the established startup-name filter only for existing BLEND scenes.
    # A loaded BLEND is an explicit user scene, so every mesh/armature in it is
    # source-authored even when Blender gave an object its default name (for
    # example, the user-added mesh named "Cube"). The default-scene name filter
    # is only meaningful for import paths that begin from a factory scene.
    export_objects=choose_objects(imported,False)
    os.makedirs(os.path.dirname(output),exist_ok=True)
    packed_dependencies=[]
    if fmt=='blend':
        for image in bpy.data.images:
            if image.source!='FILE' or image.packed_file:continue
            referenced=os.path.realpath(bpy.path.abspath(image.filepath))
            if not os.path.isfile(referenced):raise ValueError('Editable BLEND package has an unavailable external image dependency: '+image.name)
            source_digest=sha(referenced);source_bytes=os.path.getsize(referenced)
            image.pack()
            enforce_blender_memory_budget('managed editable texture dependency packing')
            packed=bytes(image.packed_file.data) if image.packed_file else None
            if packed is None or len(packed)!=source_bytes or hashlib.sha256(packed).hexdigest()!=source_digest:
                raise ValueError('Blender did not preserve an external texture dependency byte-for-byte while packing: '+image.name)
            packed_dependencies.append({'image':image.name,'bytes':source_bytes,'sha256':source_digest})
        bpy.ops.wm.save_as_mainfile(filepath=output)
    elif fmt=='glb':
        with temporary_armature_mesh_parents_for_gltf(export_objects):
            weight_export_policy=export_glb_preserving_all_weights(filepath=output,export_yup=True,use_selection=True)
    elif fmt=='fbx':
        bpy.ops.export_scene.fbx(filepath=output,apply_unit_scale=False,add_leaf_bones=False,bake_anim=True,use_selection=True)
    elif fmt=='obj':
        bpy.ops.wm.obj_export(filepath=output,export_materials=True,export_normals=True,export_uv=True,export_selected_objects=True)
    else: raise ValueError('Export format must be blend, glb, fbx, or obj.')
    if not os.path.isfile(output) or os.path.getsize(output)<16: raise ValueError('Exporter produced no usable model output.')
    if sha(source)!=before: raise ValueError('Source bytes changed during export.')
    source_manifest=inspect_scene(export_objects)
    if not source_manifest['meshCount']: raise ValueError('Managed export scene contains no mesh objects.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    import_model(output,fmt)
    output_objects=list(bpy.context.scene.objects)
    output_manifest=inspect_scene(output_objects)
    if output_manifest['meshCount']<1 or not output_manifest['bounds']:
        raise ValueError('Reopened export contains no verifiable mesh geometry or bounds.')
    verify_reopened(source_manifest,output_manifest,fmt)
    has_rig=output_manifest['armatureCount']>0
    profile='rigged-unity' if has_rig and fmt in ('glb','fbx') else 'editable-source' if has_rig and fmt=='blend' else 'static-ancillary'
    unpacked_images=[image.name for image in bpy.data.images if image.source=='FILE' and not image.packed_file]
    report={'schemaVersion':2,'operation':'source-preserving-export','inputHashes':[before],'sourceHash':before,'output':output,'outputHash':sha(output),'format':fmt,'profile':profile,'sourceObjects':source_manifest,'reopenedOutput':output_manifest,'outputReopened':True,'sourceUnmodified':True,'exportAllInfluences':fmt=='glb','weightExportPolicy':weight_export_policy if fmt=='glb' else None,'exportYup':True if fmt=='glb' else None,'blenderVersion':bpy.app.version_string,'autoexec':'disabled-by-runner','animatedProfile':fmt in ('glb','fbx','blend') and has_rig,'portablePackedDependencies':packed_dependencies if fmt=='blend' else [],'unpackedImageDependencies':unpacked_images if fmt=='blend' else []}
    with open(cfg['report'],'w',encoding='utf8') as f: json.dump(report,f,indent=2)
if __name__=='__main__': main()
