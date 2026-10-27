"""Capture/restore exact-corner UV baselines and rasterize bounded material/face masks."""
import bpy,sys,json,os,hashlib,struct,math

def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for part in iter(lambda:f.read(1024*1024),b''):h.update(part)
    return h.hexdigest()
def topology(obj):
    mesh=obj.data
    raw=b''.join(struct.pack('<3d',*v.co) for v in mesh.vertices)
    raw+=b''.join(struct.pack('<2I',*edge.vertices) for edge in mesh.edges)
    raw+=b''.join(struct.pack('<I',i) for poly in mesh.polygons for i in poly.vertices)
    raw+=b''.join(struct.pack('<I',i) for poly in mesh.polygons for i in poly.loop_indices)
    return hashlib.sha256(raw).hexdigest()
def uv_rows(obj):
    return {layer.name:[[round(float(point.uv.x),12),round(float(point.uv.y),12)] for point in layer.data] for layer in obj.data.uv_layers}
def material_rows(obj):
    return {'slots':[slot.material.name if slot.material else None for slot in obj.material_slots],'faceIndices':[int(poly.material_index) for poly in obj.data.polygons]}
def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'));mode=cfg['mode'];source=os.path.abspath(cfg['source'])
    print('ATELIER_PROGRESS|10|Opening managed source for UV/surface operation',flush=True)
    if sha(source)!=cfg['inputHash']:raise ValueError('Managed source bytes changed before UV/surface operation.')
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False;bpy.ops.wm.open_mainfile(filepath=source);bpy.context.preferences.filepaths.use_scripts_auto_execute=False
    if mode=='capture':
        print('ATELIER_PROGRESS|55|Capturing exact mesh, UV, material, and corner mappings',flush=True)
        meshes={o.name:{'topologyFingerprint':topology(o),'uvLayers':uv_rows(o),'materials':material_rows(o),'cornerNormals':[[round(float(n.vector.x),12),round(float(n.vector.y),12),round(float(n.vector.z),12)] for n in o.data.corner_normals]} for o in bpy.context.scene.objects if o.type=='MESH'}
        payload={'schemaVersion':1,'operation':'uv-surface-snapshot','sourceHash':cfg['inputHash'],'blenderVersion':bpy.app.version_string,'meshes':meshes}
        with open(cfg['output'],'w',encoding='utf8') as f:json.dump(payload,f,indent=2)
        summary={'schemaVersion':1,'mode':mode,'inputHash':cfg['inputHash'],'outputHash':sha(cfg['output']),'objectCount':len(meshes),'autoexec':'disabled-by-runner'}
    elif mode=='restore':
        print('ATELIER_PROGRESS|45|Verifying exact topology before correspondence restoration',flush=True)
        snapshot=json.load(open(cfg['snapshot'],encoding='utf8'))
        if snapshot.get('schemaVersion')!=1 or not isinstance(snapshot.get('meshes'),dict):raise ValueError('UV snapshot schema is invalid.')
        current_meshes={o.name for o in bpy.context.scene.objects if o.type=='MESH'}
        if current_meshes!=set(snapshot['meshes']):raise ValueError('Mesh object set changed; correspondence restore requires an explicit new baseline.')
        restored=[]
        for name,row in snapshot['meshes'].items():
            obj=bpy.data.objects.get(name)
            if obj is None or obj.type!='MESH':raise ValueError('Snapshot mesh is missing from candidate: '+name)
            if topology(obj)!=row.get('topologyFingerprint'):raise ValueError('Exact topology/corner/position mismatch; UV/material correspondence restore refused: '+name)
            saved_layers=row.get('uvLayers',{})
            for layer in list(obj.data.uv_layers):
                if layer.name not in saved_layers:obj.data.uv_layers.remove(layer)
            for layer_name,values in saved_layers.items():
                layer=obj.data.uv_layers.get(layer_name) or obj.data.uv_layers.new(name=layer_name)
                if len(layer.data)!=len(values):raise ValueError('UV loop count changed; restore refused: '+name)
                for point,value in zip(layer.data,values):point.uv=(float(value[0]),float(value[1]))
            mats=row.get('materials',{});names=mats.get('slots',[]);faces=mats.get('faceIndices',[])
            if len(faces)!=len(obj.data.polygons):raise ValueError('Material face count changed; restore refused: '+name)
            resolved=[]
            for material_name in names:
                if material_name is None:resolved.append(None);continue
                material=bpy.data.materials.get(material_name)
                if material is None:raise ValueError('Snapshot material datablock is unavailable; material assignment restoration refused: '+material_name)
                resolved.append(material)
            obj.data.materials.clear()
            for material in resolved:obj.data.materials.append(material)
            for polygon,index in zip(obj.data.polygons,faces):
                if not 0<=int(index)<max(1,len(resolved)):raise ValueError('Snapshot contains an invalid material slot index.')
                polygon.material_index=int(index)
            normals=row.get('cornerNormals',[])
            if len(normals)!=len(obj.data.loops):raise ValueError('Corner-normal snapshot count does not match exact loop topology.')
            obj.data.normals_split_custom_set([tuple(float(c) for c in normal) for normal in normals]);obj.data.update()
            current_normals=[[float(n.vector.x),float(n.vector.y),float(n.vector.z)] for n in obj.data.corner_normals]
            if any(max(abs(current_normals[i][axis]-float(normals[i][axis])) for axis in range(3))>1e-5 for i in range(len(normals))):raise ValueError('Custom corner normal restoration did not verify against the saved snapshot.')
            if uv_rows(obj)!=saved_layers or material_rows(obj)!=mats:raise ValueError('Restored UV or material channel failed exact read-back verification.')
            restored.append({'object':name,'topologyFingerprint':topology(obj),'uvLayers':len(row.get('uvLayers',{})),'materialSlots':len(resolved),'faces':len(faces)})
        out=os.path.abspath(cfg['output']);bpy.ops.wm.save_as_mainfile(filepath=out)
        summary={'schemaVersion':1,'mode':mode,'inputHashes':[cfg['inputHash'],snapshot['sourceHash']],'snapshotHash':sha(cfg['snapshot']),'outputHash':sha(out),'restored':restored,'exactTopologyMatched':True,'cornerNormalsRestored':True,'uvLayersRestored':True,'materialAssignmentsRestored':True,'autoexec':'disabled-by-runner'}
    elif mode=='mask':
        print('ATELIER_PROGRESS|45|Rasterizing explicit UV region mask',flush=True)
        obj=bpy.data.objects.get(cfg['object'])
        if obj is None or obj.type!='MESH':raise ValueError('A named mesh object is required for UV region mask creation.')
        uv=obj.data.uv_layers.get(cfg['uvLayer'])
        if uv is None:raise ValueError('Requested UV layer does not exist on the selected mesh.')
        width=int(cfg['width']);height=int(cfg['height'])
        if width<4 or height<4 or width>4096 or height>4096 or width*height>16777216:raise ValueError('Mask dimensions exceed the bounded supported range.')
        faces=set(int(x) for x in cfg.get('faceIndices',[]));material_name=cfg.get('materialName')
        if not faces and not material_name:raise ValueError('Select explicit face indices or a named material region.')
        selected=[]
        for poly in obj.data.polygons:
            by_face=not faces or poly.index in faces
            by_material=not material_name or (poly.material_index<len(obj.material_slots) and obj.material_slots[poly.material_index].material and obj.material_slots[poly.material_index].material.name==material_name)
            if by_face and by_material:selected.append(poly)
        if not selected:raise ValueError('The selected face/material region contains no polygons.')
        pixels=bytearray(width*height)
        def mark_triangle(points):
            if any(u<0 or u>1 or v<0 or v>1 for u,v in points):raise ValueError('Selected UVs leave the 0–1 tile; mask generation refuses implicit wrap or clipping.')
            px=[u*(width-1) for u,v in points];py=[v*(height-1) for u,v in points]
            x0=max(0,int(math.floor(min(px))));x1=min(width-1,int(math.ceil(max(px))));y0=max(0,int(math.floor(min(py))));y1=min(height-1,int(math.ceil(max(py))))
            a=(px[0],py[0]);b=(px[1],py[1]);c=(px[2],py[2]);den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(den)<1e-9:return
            for y in range(y0,y1+1):
                for x in range(x0,x1+1):
                    l1=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;l2=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;l3=1-l1-l2
                    if l1>=-1e-7 and l2>=-1e-7 and l3>=-1e-7:pixels[y*width+x]=255
        for poly in selected:
            loops=list(poly.loop_indices)
            for i in range(1,len(loops)-1):mark_triangle([tuple(uv.data[k].uv) for k in (loops[0],loops[i],loops[i+1])])
        image=bpy.data.images.new('Atelier UV region mask',width=width,height=height,alpha=False,float_buffer=False);image.colorspace_settings.name='Non-Color'
        # Blender images require four floats per pixel.
        rgba=[]
        for value in pixels:
            gray=value/255.0;rgba.extend((gray,gray,gray,1.0))
        image.pixels[:]=rgba
        out=os.path.abspath(cfg['output']);image.file_format='PNG';image.filepath_raw=out;image.save();bpy.data.images.remove(image)
        mask_count=sum(1 for p in pixels if p>0)
        summary={'schemaVersion':1,'mode':mode,'inputHash':cfg['inputHash'],'outputHash':sha(out),'object':obj.name,'uvLayer':uv.name,'materialName':material_name,'faceIndices':[p.index for p in selected],'selectedFaceCount':len(selected),'maskedPixels':mask_count,'width':width,'height':height,'topologyFingerprint':topology(obj),'autoexec':'disabled-by-runner'}
    else:raise ValueError('Unsupported UV surface mode.')
    with open(cfg['report'],'w',encoding='utf8') as f:json.dump(summary,f,indent=2)
if __name__=='__main__':main()
