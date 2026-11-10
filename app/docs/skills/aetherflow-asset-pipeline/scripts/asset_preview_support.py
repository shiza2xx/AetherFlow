"""Shared source audit and independent reopen proof for guarded asset previews."""
import array
import hashlib
from pathlib import Path
import time
import bpy
from asset_safe_import import safe_import, referenced_images, digest


def base_color_images(meshes):
    result=set()
    for obj in meshes:
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:continue
            shader=next((node for node in mat.node_tree.nodes if node.type=='BSDF_PRINCIPLED'),None)
            link=next((link for link in mat.node_tree.links if shader and link.to_socket==shader.inputs.get('Base Color')),None)
            image=link.from_node.image if link and link.from_node.type=='TEX_IMAGE' else None
            if image:result.add(image)
    return result


def build_preview(objects, meshes, cfg, source, output, scratch):
    started=time.perf_counter();timings={}
    source=Path(source).resolve();output=Path(output).resolve();scratch=Path(scratch).resolve()
    if output.exists():raise ValueError('Preview output already exists.')
    root=Path(cfg['inputRoot']).resolve();allowed={(root/entry.get('stagedPath',entry['logicalPath'])).resolve():entry['hash'] for entry in cfg['dependencies']}
    textures=[];source_images={};proof_images=base_color_images(meshes);phase=time.perf_counter()
    for image in referenced_images(objects):
        if image.source not in {'FILE','GENERATED'}:raise ValueError('Unsupported texture source in asset preview.')
        if not image.packed_file and image.source=='FILE':
            candidate=Path(bpy.path.abspath(image.filepath)).resolve()
            if candidate not in allowed or not candidate.is_file() or digest(candidate)!=allowed[candidate]:raise ValueError('Texture must be packed or registered with this asset before preview.')
            image.pack()
        if image.source=='FILE' and not image.packed_file:raise ValueError('Unable to pack registered texture.')
        width,height=map(int,image.size)
        if width<1 or height<1 or width>8192 or height>8192 or width*height>16*1024*1024:raise ValueError('Texture dimensions exceed preview limits.')
        if image in proof_images:
            proof_started=time.perf_counter();pixels=array.array('f',[0.0])*(width*height*4);image.pixels.foreach_get(pixels);source_images[image.name]={'image':image.name,'width':width,'height':height,'decodedPixelHash':hashlib.sha256(memoryview(pixels).cast('B')).hexdigest(),'decoded':True};del pixels;timings['sourcePixelProofMs']=round(timings.get('sourcePixelProofMs',0)+(time.perf_counter()-proof_started)*1000,1)
        if max(width,height)>1024:
            resize_started=time.perf_counter();scale=1024/max(width,height);image.scale(max(1,round(width*scale)),max(1,round(height*scale)));image.pack();timings['textureResizeMs']=round(timings.get('textureResizeMs',0)+(time.perf_counter()-resize_started)*1000,1)
        textures.append({'name':image.name,'originalSize':[width,height],'previewSize':list(image.size)})
    timings['texturePreparationMs']=round((time.perf_counter()-phase)*1000,1)
    materials=[]
    for mat in sorted({m for obj in meshes for m in obj.data.materials if m},key=lambda x:x.name):
        facts={'material':mat.name,'maps':{'baseColor':None}}
        if mat.use_nodes:
            shader=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
            link=next((l for l in mat.node_tree.links if shader and l.to_socket==shader.inputs.get('Base Color')),None)
            image=link.from_node.image if link and link.from_node.type=='TEX_IMAGE' else None
            if image and image.name in source_images:facts['maps']['baseColor']=source_images[image.name]
        materials.append(facts)
    uv=[{'object':obj.name,'layers':[layer.name for layer in obj.data.uv_layers]} for obj in meshes]
    mesh_count=len(meshes);uv_layers={obj.name:[layer.name for layer in obj.data.uv_layers] for obj in meshes}
    phase=time.perf_counter();bpy.ops.export_scene.gltf(filepath=str(output),export_format='GLB',use_selection=False,export_extras=True);timings['glbExportMs']=round((time.perf_counter()-phase)*1000,1)
    if cfg.get('foliageMask'):
        from asset_surface import ensure_mask
        ensure_mask(output)
    phase=time.perf_counter()
    if not output.is_file() or digest(source)!=cfg['sourceHash']:raise ValueError('Source changed or preview export is missing.')
    timings['sourceRecheckMs']=round((time.perf_counter()-phase)*1000,1)
    phase=time.perf_counter();output_hash=digest(output);timings['outputDigestMs']=round((time.perf_counter()-phase)*1000,1)
    # Reopen the generated GLB independently. Proxy facts stay distinct from the source audit.
    phase=time.perf_counter();bpy.ops.wm.read_factory_settings(use_empty=True)
    _,proxy_meshes,_=safe_import(output,{'inputRoot':str(output.parent),'scratchRoot':str(scratch),'sourceHash':output_hash,'dependencies':[]},output.parent)
    timings['proxyReopenMs']=round((time.perf_counter()-phase)*1000,1)
    proxy_materials=[]
    phase=time.perf_counter()
    for mat in sorted({m for obj in proxy_meshes for m in obj.data.materials if m},key=lambda x:x.name):
        facts={'material':mat.name,'maps':{'baseColor':None}}
        if mat.use_nodes:
            shader=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
            link=next((l for l in mat.node_tree.links if shader and l.to_socket==shader.inputs.get('Base Color')),None)
            image=link.from_node.image if link and link.from_node.type=='TEX_IMAGE' else None
            if image:
                width,height=map(int,image.size)
                if width<1 or height<1 or max(width,height)>1024:raise ValueError('Reopened proxy texture dimensions are invalid.')
                pixels=array.array('f',[0.0])*(width*height*4);image.pixels.foreach_get(pixels)
                facts['maps']['baseColor']={'image':image.name,'width':width,'height':height,'decodedPixelHash':hashlib.sha256(memoryview(pixels).cast('B')).hexdigest(),'decoded':True};del pixels
        proxy_materials.append(facts)
    timings['proxyPixelProofMs']=round((time.perf_counter()-phase)*1000,1);timings['previewTotalMs']=round((time.perf_counter()-started)*1000,1)
    return {'schemaVersion':1,'ok':True,'autoexec':'disabled','derivedPreviewOnly':True,'assetGuardedImport':True,'foliageMask':bool(cfg.get('foliageMask')),'inputSHA256':cfg['sourceHash'],'outputPath':str(output),'outputSHA256':output_hash,'textures':textures,'sourceAudit':{'assetSourceMaterials':materials,'uv':uv,'assetProxyMaterials':proxy_materials,'proxyOutputHash':output_hash},'meshCount':mesh_count,'uvLayers':uv_layers,'processingTimingsMs':timings}
