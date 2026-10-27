"""Mask-limited tangent-space normal-vector mix; input remains immutable."""
import bpy, sys, json, os, hashlib

def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'))
    image=bpy.data.images.load(os.path.abspath(cfg['input']),check_existing=False)
    mask=bpy.data.images.load(os.path.abspath(cfg['mask']),check_existing=False)
    image.colorspace_settings.name='Non-Color'; mask.colorspace_settings.name='Non-Color'
    if image.size[:] != mask.size[:]: raise ValueError('Mask dimensions do not match input image.')
    w,h=image.size; src=list(image.pixels[:]); m=list(mask.pixels[:]); dst=src[:]
    amount=float(cfg.get('candidateAmount',1.0)); candidate=[v/127.5-1 for v in cfg.get('candidate',[128,128,255])]; touched=0;outside=0;outside_preserved=True
    for p in range(w*h):
        alpha=max(0.0,min(1.0,m[p*4])); i=p*4
        if alpha<=0:
            outside+=1
            if dst[i:i+4]!=src[i:i+4]:outside_preserved=False
            continue
        n=[src[i+c]*2-1 for c in range(3)]; blend=[n[c]*(1-alpha*amount)+candidate[c]*(alpha*amount) for c in range(3)]; mag=max(1e-8,sum(v*v for v in blend)**.5)
        for c in range(3): dst[i+c]=max(0.0,min(1.0,blend[c]/mag*.5+.5))
        touched+=1
    image.pixels[:]=dst; image.file_format='PNG'; image.filepath_raw=os.path.abspath(cfg['output']); image.save()
    verified=bpy.data.images.load(os.path.abspath(cfg['output']),check_existing=False);verified.colorspace_settings.name='Non-Color'; saved=list(verified.pixels[:])
    for p in range(w*h):
        i=p*4
        if m[i]<=0 and saved[i:i+4]!=src[i:i+4]:outside_preserved=False
    bpy.data.images.remove(verified)
    out=open(cfg['output'],'rb').read(); report={'schemaVersion':1,'operation':'normal-mask-vector-mix','input':os.path.abspath(cfg['input']),'inputSHA256':hashlib.sha256(open(cfg['input'],'rb').read()).hexdigest(),'mask':os.path.abspath(cfg['mask']),'maskSHA256':hashlib.sha256(open(cfg['mask'],'rb').read()).hexdigest(),'output':os.path.abspath(cfg['output']),'width':w,'height':h,'maskedPixels':touched,'outsideMaskPixels':outside,'outsideMaskPixelsPreserved':outside_preserved,'meshGeometryChanged':False,'uvChanged':False,'candidateAmount':amount,'outputSHA256':hashlib.sha256(out).hexdigest(),'autoexec':'disabled-by-runner','blenderVersion':bpy.app.version_string}
    with open(cfg['report'],'w',encoding='utf8') as f: json.dump(report,f,indent=2)
if __name__=='__main__': main()
