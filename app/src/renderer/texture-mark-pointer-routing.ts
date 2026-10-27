export type TextureMarkPointerOwner='paint'|'orbit'|'blocked'|'none';
export type TextureMarkPointerStart={owner:TextureMarkPointerOwner;reportUnpaintable:boolean};

export function resolveTextureMarkPointerStart(input:{button:number;markMode:boolean;loading:boolean;visibleMeshHit:boolean;verifiedBindingHit:boolean}):TextureMarkPointerStart{
  if(input.button!==0)return {owner:'none',reportUnpaintable:false};
  if(input.loading)return {owner:'blocked',reportUnpaintable:false};
  if(!input.markMode)return {owner:'none',reportUnpaintable:false};
  if(!input.visibleMeshHit)return {owner:'orbit',reportUnpaintable:false};
  if(!input.verifiedBindingHit)return {owner:'blocked',reportUnpaintable:true};
  return {owner:'paint',reportUnpaintable:false};
}

export function shouldPaintTextureMarkGesture(owner:TextureMarkPointerOwner){return owner==='paint';}
