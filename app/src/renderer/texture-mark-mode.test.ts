import {describe,expect,it} from 'vitest';
import {resolveTextureMarkPreparation,textureMarkBindingIdentity,type TextureMarkPreparation} from './texture-mark-mode';

const preview={id:'viewer-a',data:{hash:'viewer-hash-a',sourceInputHash:'source-hash-a'}};
const target=(strokes:unknown[]=[])=>([{key:'image-a',imageName:'body.png',width:4096,height:4096,originalImageHash:'image-hash-a',decodedPixelHash:'pixels-a',strokes,bindings:[{meshName:'Body',materialName:'Skin',materialSlot:0,imageNodeName:'BaseColor',uvIndex:0,uvDigest:'uv-a',displayUvSignature:'sig-a'}]}]);
const identity=(targets=target())=>textureMarkBindingIdentity(preview,targets);
const preparation=(changes:Partial<TextureMarkPreparation>={}):TextureMarkPreparation=>({active:false,requested:false,identity:null,signature:null,...changes});

describe('texture paint preparation lifecycle',()=>{
  it('carries the first click request through verified preparation and a recovery-only target refresh',()=>{
    const binding=identity(),ready=resolveTextureMarkPreparation(preparation({requested:true}),binding,1);
    expect(ready).toMatchObject({active:true,requested:false,identity:binding.identity,signature:binding.signature});
    const recovered=resolveTextureMarkPreparation(ready,identity(target([{mode:'paint',radiusPx:8,points:[{u:.2,v:.3}]}])),1);
    expect(recovered.active).toBe(true);
  });

  it('keeps an explicit paint session through compatible fresh target updates, but a close exits it',()=>{
    const binding=identity(),active=resolveTextureMarkPreparation(preparation({requested:true}),binding,1);
    expect(resolveTextureMarkPreparation(active,identity(target()),1).active).toBe(true);
    const closed=preparation({identity:binding.identity,signature:binding.signature});
    expect(resolveTextureMarkPreparation(closed,binding,1).active).toBe(false);
  });

  it('does not carry paint intent across viewer/source changes or failed binding preparation',()=>{
    const binding=identity(),active=resolveTextureMarkPreparation(preparation({requested:true}),binding,1);
    const changed=textureMarkBindingIdentity({id:'viewer-b',data:{hash:'viewer-hash-b',sourceInputHash:'source-hash-b'}},target());
    expect(resolveTextureMarkPreparation(active,changed,1)).toMatchObject({active:false,identity:changed.identity});
    expect(resolveTextureMarkPreparation(active,binding,0)).toMatchObject({active:false,identity:null,signature:null});
  });

  it('cancels a pending first-click request if the displayed viewer changes before proof preparation',()=>{
    const oldIdentity=identity(),newIdentity=textureMarkBindingIdentity({id:'viewer-new',data:{hash:'viewer-new-hash',sourceInputHash:'source-hash-a'}},target());
    const pending=preparation({requested:true,identity:oldIdentity.identity});
    expect(resolveTextureMarkPreparation(pending,newIdentity,1).active).toBe(false);
  });
});
