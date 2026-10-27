import type {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
/** Interactive fitting only. Decode one image at a time and release its full bitmap.
 * Source GLB/Blender files and export textures are never rewritten. */
export function withHeadFitTextureBudget(loader:GLTFLoader,maxEdge=1024){
 loader.register((parser:any)=>{
  const original=parser.loadImageSource.bind(parser);let queue=Promise.resolve();
  parser.loadImageSource=(index:number,imageLoader:unknown)=>{
   const result=queue.then(()=>original(index,imageLoader)).then(async(texture:any)=>{
    const image=texture.source?.data,w=image?.width||0,h=image?.height||0;
    if(w>maxEdge||h>maxEdge){const ratio=maxEdge/Math.max(w,h),bitmap=await createImageBitmap(image,{resizeWidth:Math.max(1,Math.round(w*ratio)),resizeHeight:Math.max(1,Math.round(h*ratio)),resizeQuality:'high',colorSpaceConversion:'none',premultiplyAlpha:'none'});texture.source.data=bitmap;image.close?.();texture.needsUpdate=true;}
    texture.userData.atelierFitPreview=true;return texture;
   });queue=result.then(()=>undefined,()=>undefined);return result;
  };
  return {name:'ATELIER_interactive_fit_texture_budget'};
 });return loader;
}
