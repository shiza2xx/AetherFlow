"""Checked pre-read import of asset-owned staged files."""
import bpy, hashlib, json, struct, shlex, shutil, re, tempfile
from pathlib import Path
import time
from asset_mesh_helpers import load_objects

def digest(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for part in iter(lambda:f.read(1024*1024),b''): h.update(part)
 return h.hexdigest()

def referenced_images(objects):
 result=set();seen=set()
 def walk(tree):
  if not tree or tree in seen:return
  seen.add(tree)
  for node in tree.nodes:
   if getattr(node,'image',None):result.add(node.image)
   if getattr(node,'node_tree',None):walk(node.node_tree)
 for obj in objects:
  if obj.type=='MESH':
   for material in obj.data.materials:
    if material and material.use_nodes:walk(material.node_tree)
 return sorted(result,key=lambda image:image.name)

def safe_import(source,config,scratch):
 started=time.perf_counter();timings={}
 if not isinstance(config,dict) or not isinstance(config.get('dependencies'),list) or not config.get('inputRoot') or not config.get('sourceHash'):raise ValueError('A verified staged-source manifest is required.')
 source=Path(source).resolve();root=Path(config['inputRoot']).resolve();scratch=Path(config.get('scratchRoot') or scratch).resolve()
 if source.suffix.lower() not in {'.blend','.glb','.fbx','.obj'}:raise ValueError('Unsupported asset source; convert glTF to GLB.')
 phase=time.perf_counter()
 if not source.is_relative_to(root) or not scratch.is_dir() or digest(source)!=config['sourceHash']:raise ValueError('Staged source path or hash mismatch.')
 timings['sourceHashMs']=round((time.perf_counter()-phase)*1000,1)
 normalized={}
 phase=time.perf_counter()
 for entry in config['dependencies']:
  logical=entry.get('logicalPath','').replace('\\','/')
  staged=entry.get('stagedPath',logical).replace('\\','/')
  if not logical or logical.startswith('/') or ':' in logical or any(x in ('','.','..') for x in logical.split('/')):raise ValueError('Unsafe dependency manifest path.')
  if not staged or staged.startswith('/') or ':' in staged or any(x in ('','.','..') for x in staged.split('/')):raise ValueError('Unsafe staged dependency path.')
  if logical in normalized:raise ValueError('Duplicate dependency manifest path.')
  file=(root/staged).resolve()
  if not file.is_relative_to(root) or not file.is_file() or digest(file)!=entry.get('hash'):raise ValueError('Staged dependency mismatch.')
  normalized[logical]=(file,entry['hash'])
 timings['dependencyHashesMs']=round((time.perf_counter()-phase)*1000,1)
 phase=time.perf_counter();fbx_image_rehash_ms=0.0
 images_before=set(bpy.data.images)
 # Reject external glTF resources before invoking the importer.
 if source.suffix.lower()=='.glb':
  raw=source.read_bytes()
  if len(raw)<20 or raw[:4]!=b'glTF' or struct.unpack_from('<I',raw,8)[0]!=len(raw): raise ValueError('Invalid GLB container.')
  size,kind=struct.unpack_from('<I4s',raw,12)
  if kind!=b'JSON' or size>16*1024*1024 or 20+size>len(raw): raise ValueError('Invalid GLB JSON chunk.')
  doc=json.loads(raw[20:20+size].decode('utf8'))
  def check_uris(value):
   if isinstance(value,dict):
    for key,entry in value.items():
     if key.lower()=='uri' and (not isinstance(entry,str) or not entry.startswith('data:') or len(entry)>128*1024*1024):raise ValueError('GLB external file/network URIs are not allowed; embed the resource and retry.')
     check_uris(entry)
   elif isinstance(value,list):
    for entry in value:check_uris(entry)
  check_uris(doc)

 # Resolve paths exclusively against registered, hash-checked staged inputs.
 registered={logical:value[0] for logical,value in normalized.items()}
 expected_hashes={value[0]:value[1] for value in normalized.values()}
 logical_by_path={file:logical for logical,file in registered.items()}
 def resolve_ref(value,base=''):
  value=value.replace('\\','/')
  if not value or value.startswith('/') or re.match(r'^[A-Za-z]:',value) or any(x in ('','..','.') for x in value.split('/')): raise ValueError('Unsafe absolute or traversal dependency reference: '+value)
  logical=(base+'/'+value).strip('/') if base else value
  if logical in registered:return registered[logical]
  matches=[v for k,v in registered.items() if Path(k).name.lower()==Path(value).name.lower()]
  if len(matches)!=1: raise ValueError('Missing or ambiguous registered dependency: '+value)
  return matches[0]
 if source.suffix.lower()=='.obj':
  clean=Path(tempfile.mkdtemp(prefix='i',dir=str(scratch)));source_base=str(source.relative_to(root).parent).replace('\\','/');source_base='' if source_base=='.' else source_base
  lines=source.read_text(encoding='utf8').splitlines();out=[];mtl_index=0
  for line in lines:
   stripped=line.strip();parts=shlex.split(stripped.replace('\\','/'),comments=True,posix=True) if stripped else []
   if not parts:out.append(line);continue
   if parts[0].lower() not in {'v','vt','vn','vp','f','l','p','o','g','s','usemtl','mtllib'}:raise ValueError('Unsupported OBJ directive: '+parts[0])
   if parts[0].lower()!='mtllib':out.append(line);continue
   if len(parts)<2:raise ValueError('OBJ material library is missing.')
   names=[]
   for ref in parts[1:]:
    mtl=resolve_ref(ref,source_base);mtl_logical=logical_by_path.get(mtl)
    if not mtl_logical:raise ValueError('OBJ material library is not bound to a logical dependency path.')
    mtl_base=mtl_logical.rsplit('/',1)[0] if '/' in mtl_logical else '';mtl_index+=1;mtl_name=f'material-{mtl_index}.mtl';names.append(mtl_name);rewritten=[]
    for entry in mtl.read_text(encoding='utf8').splitlines():
     tokens=shlex.split(entry.strip().replace('\\','/'),comments=True,posix=True) if entry.strip() else []
     if not tokens:rewritten.append(entry);continue
     key=tokens[0].lower()
     if key in {'call','csh','include'}:raise ValueError('Unsupported MTL external directive.')
     if not (key.startswith('map_') or key in {'bump','disp','decal','refl','norm'}):
      if key not in {'newmtl','ka','kd','ks','ke','ns','ni','d','tr','tf','illum','pr','pm','ps','pc','pcr','aniso','anisor'} or any(x.lower()=='spectral' for x in tokens[1:]):raise ValueError('Unsupported MTL directive: '+tokens[0])
      rewritten.append(entry);continue
     i=1;opts=[]
     while i<len(tokens) and tokens[i].startswith('-'):
      opt=tokens[i].lower();i+=1;opts.append(opt)
      if opt in {'-s','-o','-t'}:
       n=0
       while i<len(tokens) and n<3:
        try: float(tokens[i])
        except ValueError:break
        opts.append(tokens[i]);i+=1;n+=1
       if not n:raise ValueError('Invalid MTL vector option.')
      elif opt in {'-bm','-boost','-texres','-clamp','-blendu','-blendv','-imfchan','-type','-colorspace'}:
       if i>=len(tokens):raise ValueError('Missing MTL option value.')
       opts.append(tokens[i]);i+=1
      elif opt=='-mm':
       if i+1>=len(tokens):raise ValueError('Missing MTL option values.')
       opts.extend(tokens[i:i+2]);i+=2
      else:raise ValueError('Unsupported MTL texture option: '+opt)
     if i!=len(tokens)-1:raise ValueError('Unsupported or ambiguous MTL texture reference.')
     texture=resolve_ref(tokens[i],mtl_base);name=f'texture-{mtl_index}-{len(list(clean.glob("texture-*")))}{texture.suffix.lower()}';shutil.copyfile(texture,clean/name);rewritten.append(' '.join([tokens[0],*opts,name]))
    (clean/mtl_name).write_text('\n'.join(rewritten)+'\n',encoding='utf8')
   out.append('mtllib '+' '.join(names))
  (clean/'model.obj').write_text('\n'.join(out)+'\n',encoding='utf8');import_source=clean/'model.obj'
 else:import_source=source
 if source.suffix.lower()=='.fbx':
  from bpy_extras import image_utils
  original_loader=image_utils.load_image
  def restricted_loader(filepath,dirname=None,**kwargs):
   nonlocal fbx_image_rehash_ms
   # Never allow the loader to inspect the original absolute path. Embedded content
   # is packed by the FBX importer after this placeholder is returned.
   value=str(filepath).replace('\\','/');root_str=str(root).replace('\\','/')
   if value.lower().startswith(root_str.lower()+'/'):value=value[len(root_str)+1:]
   try:resolved=resolve_ref(value)
   except ValueError:
    matches=[v for k,v in registered.items() if Path(k).name.lower()==Path(value).name.lower()]
    if len(matches)>1:raise ValueError('Ambiguous registered FBX image reference.')
    if len(matches)==1:resolved=matches[0]
    else:
     image=bpy.data.images.new('Unresolved embedded FBX texture',width=1,height=1);image.filepath=str(root/'embedded-placeholder');image.source='FILE';return image
   hash_started=time.perf_counter()
   if not resolved.is_file() or digest(resolved)!=expected_hashes[resolved]:raise ValueError('Registered FBX image changed before import.')
   fbx_image_rehash_ms+=(time.perf_counter()-hash_started)*1000
   return original_loader(str(resolved),dirname=None,place_holder=False,recursive=False,ncase_cmp=False)
  image_utils.load_image=restricted_loader
  try:objects=load_objects(bpy,str(import_source))
  finally:image_utils.load_image=original_loader
 else:objects=load_objects(bpy,str(import_source));
 meshes=[obj for obj in objects if obj.type=='MESH' and len(obj.data.polygons)]
 if not meshes: raise ValueError('Imported asset has no mesh surfaces.')
 allowed={source,*expected_hashes.keys()}
 if source.suffix.lower()=='.obj': allowed.update(p.resolve() for p in clean.glob('texture-*'))
 def referenced_images():
  result=set();seen=set()
  def walk(tree):
   if not tree or tree in seen:return
   seen.add(tree)
   for node in tree.nodes:
    if getattr(node,'image',None):result.add(node.image)
    if getattr(node,'node_tree',None):walk(node.node_tree)
  for obj in objects:
   if obj.type=='MESH':
    for material in obj.data.materials:
     if material and material.use_nodes:walk(material.node_tree)
  return sorted(result,key=lambda image:image.name)
 for image in bpy.data.images:
  if image not in images_before and image.filepath==str(root/'embedded-placeholder') and not image.packed_file:raise ValueError('FBX image is not embedded or a registered dependency.')
 images=[]
 image_pack_started=time.perf_counter()
 for image in referenced_images():
  if source.suffix.lower()=='.blend':continue
  if image.packed_file and image.filepath==str(root/'embedded-placeholder'):image.reload()
  if image.source not in {'FILE','GENERATED'}: raise ValueError('Unsupported image source.')
  if not image.packed_file:
   file=Path(bpy.path.abspath(image.filepath)).resolve()
   if file not in allowed: raise ValueError('Imported image is not a registered dependency.')
   image.pack()
  if not image.packed_file: raise ValueError('Imported image did not pack.')
  images.append({'name':image.name,'hash':hashlib.sha256(bytes(image.packed_file.data)).hexdigest()})
 timings['imagePackingAndProofMs']=round((time.perf_counter()-image_pack_started)*1000,1)
 timings['blenderImportMs']=round((time.perf_counter()-phase)*1000,1)
 timings['fbxTextureRehashMs']=round(fbx_image_rehash_ms,1)
 timings['safeImportTotalMs']=round((time.perf_counter()-started)*1000,1)
 config['_processingTimingsMs']=timings
 if source.suffix.lower()=='.obj':shutil.rmtree(clean)
 return objects,meshes,images
