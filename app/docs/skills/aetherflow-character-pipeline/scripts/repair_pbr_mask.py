"""Localized albedo/roughness/metallic repair with exact outside-mask pixel verification."""
import bpy,sys,json,os,hashlib
def sha(path): return hashlib.sha256(open(path,'rb').read()).hexdigest()
def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8')); channel=cfg['channel']
    if channel not in ('albedo','roughness','metallic'): raise ValueError('Channel must be albedo, roughness, or metallic.')
    image=bpy.data.images.load(os.path.abspath(cfg['input']),check_existing=False);mask=bpy.data.images.load(os.path.abspath(cfg['mask']),check_existing=False)
    image.colorspace_settings.name='sRGB' if channel=='albedo' else 'Non-Color';mask.colorspace_settings.name='Non-Color'
    if image.size[:]!=mask.size[:]: raise ValueError('Mask dimensions do not match source texture.')
    w,h=image.size;src=list(image.pixels[:]);m=list(mask.pixels[:]);dst=src[:];amount=float(cfg['amount']);candidate=cfg['candidate']
    if not 0<=amount<=1 or any(not 0<=float(x)<=255 for x in candidate): raise ValueError('Repair amount or candidate pixel values are out of bounds.')
    touched=0;outside=0;preserved=True
    for p in range(w*h):
        i=p*4;alpha=max(0.0,min(1.0,m[i]))
        if alpha<=0: outside+=1;continue
        touched+=1;strength=alpha*amount
        indices=(0,1,2) if channel=='albedo' else (0,)
        for c in indices: dst[i+c]=src[i+c]*(1-strength)+(float(candidate[c if channel=='albedo' else 0])/255.0)*strength
    image.pixels[:]=dst;image.file_format='PNG';image.filepath_raw=os.path.abspath(cfg['output']);image.save()
    check=bpy.data.images.load(os.path.abspath(cfg['output']),check_existing=False);check.colorspace_settings.name='sRGB' if channel=='albedo' else 'Non-Color';saved=list(check.pixels[:])
    for p in range(w*h):
        i=p*4
        if m[i]<=0 and saved[i:i+4]!=src[i:i+4]:preserved=False
    bpy.data.images.remove(check);out_hash=sha(cfg['output'])
    report={'schemaVersion':1,'operation':'pbr-local-mask-repair','channel':channel,'inputSHA256':sha(cfg['input']),'maskSHA256':sha(cfg['mask']),'outputSHA256':out_hash,'outputHash':out_hash,'maskedPixels':touched,'outsideMaskPixels':outside,'outsideMaskPixelsPreserved':preserved,'meshGeometryChanged':False,'uvChanged':False,'amount':amount,'autoexec':'disabled-by-runner','blenderVersion':bpy.app.version_string}
    with open(cfg['report'],'w',encoding='utf8') as f:json.dump(report,f,indent=2)
if __name__=='__main__':main()
