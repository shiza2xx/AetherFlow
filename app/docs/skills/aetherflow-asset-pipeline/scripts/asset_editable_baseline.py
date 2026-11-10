"""Create a verified editable snapshot of an imported, staged asset model."""
import bpy, hashlib, json, sys, struct
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from asset_safe_import import safe_import,referenced_images,digest
config=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf8'))
source=Path(config['source']).resolve();baseline=Path(config['baseline']).resolve();report=Path(config['report']).resolve()
if baseline.exists() or report.exists():raise ValueError('Existing output path.')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
objects,meshes,images=safe_import(source,config,baseline.parent.parent)
def mesh_summary(objects):
 result=[]
 for obj in objects:
  mesh=obj.data;h=hashlib.sha256()
  for vertex in mesh.vertices:h.update(struct.pack('<3f',*vertex.co))
  for face in mesh.polygons:
   h.update(struct.pack('<II',len(face.vertices),face.material_index))
   for vertex in face.vertices:h.update(struct.pack('<I',vertex))
  for layer in mesh.uv_layers:
   h.update(layer.name.encode('utf8')+b'\0')
   for loop in layer.data:h.update(struct.pack('<2f',*loop.uv))
  result.append((obj.name,len(mesh.vertices),len(mesh.polygons),[m.name if m else None for m in mesh.materials],h.hexdigest()))
 return sorted(result)
summary={'meshes':mesh_summary(meshes),'images':sorted((x['name'],x['hash']) for x in images)}
bpy.ops.wm.save_as_mainfile(filepath=str(baseline),compress=False)
if digest(source)!=config['sourceHash']: raise ValueError('Original source changed during import.')
bpy.ops.wm.open_mainfile(filepath=str(baseline),load_ui=False)
reopened={'meshes':mesh_summary([o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.polygons)]),'images':sorted((image.name,hashlib.sha256(bytes(image.packed_file.data)).hexdigest()) for image in referenced_images([o for o in bpy.context.scene.objects if o.type=='MESH']) if image.packed_file)}
if summary!=reopened: raise ValueError('Reopened baseline does not preserve imported mesh and packed image data.')
report.write_text(json.dumps({'schemaVersion':1,'operation':'asset-editable-baseline','ok':True,'autoexec':'disabled','sourceHash':config['sourceHash'],'dependencies':config['dependencies'],'baselineHash':digest(baseline),'reopenedVerified':True,'summary':summary},sort_keys=True),encoding='utf8')
