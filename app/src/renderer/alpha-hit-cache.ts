import * as THREE from 'three';

type Pixels={width:number;height:number;data:ArrayLike<number>};
/** Cache pixel buffers by image identity and texture version; pointer moves never read an entire image repeatedly. */
export class AlphaHitCache{
 private cache=new WeakMap<THREE.Texture,{image:unknown;version:number;pixels:Pixels|null}>();
 private pixels(texture:THREE.Texture):Pixels|null{
  const image=texture.image as any,previous=this.cache.get(texture);
  if(previous&&previous.image===image&&previous.version===texture.version)return previous.pixels;
  let pixels:Pixels|null=null;
  try{
   if(image?.data&&image.width>0&&image.height>0&&image.data.length===image.width*image.height*4)pixels={width:image.width,height:image.height,data:image.data};
   else if(image?.width>0&&image?.height>0&&typeof document!=='undefined'){
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(ctx){ctx.drawImage(image,0,0);pixels={width:canvas.width,height:canvas.height,data:ctx.getImageData(0,0,canvas.width,canvas.height).data};}
   }
  }catch{/* Unreadable sources fail closed for painting. */}
  this.cache.set(texture,{image,version:texture.version,pixels});return pixels;
 }
 sample(texture:THREE.Texture,hit:THREE.Intersection,component:1|3):number|null{
  const source=texture.channel===1?(hit as any).uv1:hit.uv;if(!source||texture.channel>1)return null;
  const pixels=this.pixels(texture);if(!pixels)return null;
  if(texture.matrixAutoUpdate)texture.updateMatrix();const uv=texture.transformUv(source.clone());
  const x=Math.min(pixels.width-1,Math.max(0,Math.floor(uv.x*pixels.width))),y=Math.min(pixels.height-1,Math.max(0,Math.floor(uv.y*pixels.height)));
  return Number(pixels.data[(y*pixels.width+x)*4+component])/255;
 }
 visible(hit:THREE.Intersection,material:THREE.Material):boolean{
  if(!material.visible)return false;if(material.alphaTest<=0)return true;
  const source=material as THREE.MeshStandardMaterial;let alpha=material.opacity;
  for(const [texture,component] of [[source.map,3],[source.alphaMap,1]] as const){if(texture){const value=this.sample(texture,hit,component);if(value===null)return false;alpha*=value;}}
  return alpha>=material.alphaTest;
 }
}
