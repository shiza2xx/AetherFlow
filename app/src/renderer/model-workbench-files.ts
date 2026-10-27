type ModelArtifact={id:string;name:string;data:Record<string,any>};

const extension=(item:ModelArtifact)=>String(item.data?.sourceName||item.name).split('.').pop()?.toLowerCase()||'';
const parentIds=(item:ModelArtifact)=>[item.data?.versionOf,item.data?.sourceParentId,item.data?.parentArtifactId].filter((value):value is string=>typeof value==='string'&&!!value);
const exactDerivative=(item:ModelArtifact,source:ModelArtifact)=>parentIds(item).includes(source.id)&&String(item.data?.sourceInputHash||'')===String(source.data?.hash||'');

/** Build the viewer's narrow source family. A selected legacy GLB also receives only a byte-identical sibling alias. */
export function modelWorkbenchViewerFiles<T extends ModelArtifact>(artifacts:readonly T[],selectedId:string):T[]{
 const selected=artifacts.find(item=>item.id===selectedId);if(!selected)return [];
 if(extension(selected)==='blend')return [...artifacts.filter(item=>item.id!==selected.id&&extension(item)==='glb'&&exactDerivative(item,selected)),selected];
 if(extension(selected)==='glb'){
  const sourceId=parentIds(selected).find(id=>artifacts.some(item=>item.id===id&&extension(item)==='blend'));
  const source=sourceId?artifacts.find(item=>item.id===sourceId):undefined;
  if(source&&String(selected.data?.sourceInputHash||'')===String(source.data?.hash||'')&&exactDerivative(selected,source)){
   const identicalSiblings=artifacts.filter(item=>item.id!==selected.id&&extension(item)==='glb'&&item.data?.hash===selected.data?.hash&&exactDerivative(item,source));
   return [...new Map([source,...identicalSiblings,selected].map(item=>[item.id,item])).values()];
  }
 }
 const derivatives=artifacts.filter(item=>item.id!==selected.id&&parentIds(item).includes(selected.id)&&String(item.data?.sourceInputHash||'')===String(selected.data?.hash||''));
 return [...derivatives,selected];
}
