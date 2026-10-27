import type {Entity} from '../shared/contracts';
import {viewerCharacterForAsset} from './viewer-lineage';

type Store={getAny:(id:string)=>Entity|null;links:(id:string)=>Array<{from_id:string;to_id:string;role?:string}>};

/** A gallery image is reusable only through its canonical concept membership and without output lineage. */
export function isExplicitReusableGalleryImage(store:Store,artifact:Entity):boolean{
 if(artifact.kind!=='artifact'||!String(artifact.data.mime||'').startsWith('image/')||artifact.data.deletedAt||
  ['parentId','versionOf','versionRootId','sourceParentId','operationId'].some(key=>artifact.data[key]))return false;
 return store.links(artifact.id).some(link=>{
  const other=store.getAny(link.from_id===artifact.id?link.to_id:link.from_id);
  return other?.kind==='concept'&&!other.data.deletedAt&&link.role==='source artwork'&&
   Array.isArray(other.data.referenceArtifactIds)&&other.data.referenceArtifactIds.includes(artifact.id);
 });
}

/** Never use an unowned/null ownership result as authorization. Gallery reuse is explicit and role-limited. */
export function canUseTextureRepairReference(store:Store,artifact:Entity,characterId:string,role:string):boolean{
 const owner=viewerCharacterForAsset(store,artifact);
 return owner===characterId||role==='original character-generation color reference'&&isExplicitReusableGalleryImage(store,artifact);
}
