export type TextureMarkUvSelection={selectedKey:string;renderedKey:string};

export function createTextureMarkUvSelection():TextureMarkUvSelection{return {selectedKey:'',renderedKey:''};}

export function selectTextureMarkUvTarget(selection:TextureMarkUvSelection,key:string):TextureMarkUvSelection{
  if(selection.selectedKey===key)return selection;
  return {selectedKey:key,renderedKey:''};
}

export function canRenderTextureMarkUv(selection:TextureMarkUvSelection,key:string){return !!key&&selection.selectedKey===key;}

export function markTextureMarkUvRendered(selection:TextureMarkUvSelection,key:string):TextureMarkUvSelection{
  return canRenderTextureMarkUv(selection,key)?{...selection,renderedKey:key}:selection;
}

export function canPaintTextureMarkUv(selection:TextureMarkUvSelection,key:string){return !!key&&selection.selectedKey===key&&selection.renderedKey===key;}
