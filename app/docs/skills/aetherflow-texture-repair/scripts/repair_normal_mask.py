"""Mask-limited tangent-space normal-vector mix; input remains immutable."""
import bpy, sys, json, os, hashlib

def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'))
    image=bpy.data.images.load(os.path.abspath(cfg['input']),check_existing=False)
    mask=bpy.data.images.load(os.path.abspath(cfg['mask']),check_existing=False)
    image.colorspace_settings.name='Non-Color'; mask.colorspace_settings.name='Non-Color'
    source_binding=cfg.get('sourceUvBinding');mask_binding=cfg.get('maskUvBinding')
    if image.size[:] != mask.size[:] and (not source_binding or source_binding != mask_binding): raise ValueError('A differently sized mask requires an exact matching verified UV binding.')
    candidate_map=None;candidate_pixels=None;candidate_map_hash=None;resampled=False
    if cfg.get('candidateTexture'):
        candidate_map=bpy.data.images.load(os.path.abspath(cfg['candidateTexture']),check_existing=False);candidate_map.colorspace_settings.name='Non-Color'
        candidate_map_hash=hashlib.sha256(open(cfg['candidateTexture'],'rb').read()).hexdigest()
        if candidate_map.size[:]!=image.size[:]:candidate_map.scale(image.size[0],image.size[1]);resampled=True
        candidate_pixels=list(candidate_map.pixels[:])
    w,h=image.size;mw,mh=mask.size;src=list(image.pixels[:]);m=list(mask.pixels[:]);dst=src[:]
    mask_values=bytearray(w*h)
    for y in range(h):
        my=min(mh-1,int((y+.5)*mh/h))
        for x in range(w):
            mx=min(mw-1,int((x+.5)*mw/w));mask_values[y*w+x]=max(0,min(255,int(round(m[(my*mw+mx)*4]*255))))
    feather=int(cfg.get('featherRadius',8))
    if feather<0 or feather>64:raise ValueError('Inner feather radius must be between 0 and 64 pixels.')
    distance=bytearray(w*h);limit=max(1,feather)
    for p in range(w*h):distance[p]=limit if mask_values[p]>0 else 0
    if feather:
        for y in range(h):
            row=y*w
            for x in range(w):
                p=row+x
                if not mask_values[p]:continue
                best=distance[p]
                if x:best=min(best,distance[p-1]+1)
                if y:best=min(best,distance[p-w]+1)
                distance[p]=min(limit,best)
        for y in range(h-1,-1,-1):
            row=y*w
            for x in range(w-1,-1,-1):
                p=row+x
                if not mask_values[p]:continue
                best=distance[p]
                if x+1<w:best=min(best,distance[p+1]+1)
                if y+1<h:best=min(best,distance[p+w]+1)
                distance[p]=min(limit,best)
    amount=float(cfg.get('candidateAmount',1.0)); candidate=[v/127.5-1 for v in cfg.get('candidate',[128,128,255])]; touched=0;outside=0;outside_preserved=True
    for p in range(w*h):
        alpha=mask_values[p]/255.0; i=p*4
        if alpha<=0:
            outside+=1
            if dst[i:i+4]!=src[i:i+4]:outside_preserved=False
            continue
        alpha*=1.0 if not feather else min(1.0,distance[p]/float(limit))
        if alpha<=0:continue
        n=[src[i+c]*2-1 for c in range(3)]
        target=[candidate_pixels[i+c]*2-1 for c in range(3)] if candidate_pixels is not None else candidate
        target_mag=max(1e-8,sum(v*v for v in target)**.5);target=[v/target_mag for v in target]
        blend=[n[c]*(1-alpha*amount)+target[c]*(alpha*amount) for c in range(3)]; mag=max(1e-8,sum(v*v for v in blend)**.5)
        for c in range(3): dst[i+c]=max(0.0,min(1.0,blend[c]/mag*.5+.5))
        touched+=1
    image.pixels[:]=dst; image.file_format='PNG'; image.filepath_raw=os.path.abspath(cfg['output']); image.save()
    verified=bpy.data.images.load(os.path.abspath(cfg['output']),check_existing=False);verified.colorspace_settings.name='Non-Color'; saved=list(verified.pixels[:])
    for p in range(w*h):
        i=p*4
        if mask_values[p]<=0 and saved[i:i+4]!=src[i:i+4]:outside_preserved=False
    bpy.data.images.remove(verified)
    out=open(cfg['output'],'rb').read(); report={'schemaVersion':1,'operation':'normal-mask-vector-mix','input':os.path.abspath(cfg['input']),'inputSHA256':hashlib.sha256(open(cfg['input'],'rb').read()).hexdigest(),'mask':os.path.abspath(cfg['mask']),'maskSHA256':hashlib.sha256(open(cfg['mask'],'rb').read()).hexdigest(),'maskDimensions':[mw,mh],'maskResampledNearest':[mw,mh]!=[w,h],'candidateTextureSHA256':candidate_map_hash,'candidateResampled':resampled,'output':os.path.abspath(cfg['output']),'width':w,'height':h,'maskedPixels':touched,'outsideMaskPixels':outside,'outsideMaskPixelsPreserved':outside_preserved,'meshGeometryChanged':False,'uvChanged':False,'candidateAmount':amount,'featherMethod':'bounded-inner-Manhattan-distance','featherRadiusPixels':feather,'outputSHA256':hashlib.sha256(out).hexdigest(),'autoexec':'disabled-by-runner','blenderVersion':bpy.app.version_string}
    with open(cfg['report'],'w',encoding='utf8') as f: json.dump(report,f,indent=2)
if __name__=='__main__': main()
