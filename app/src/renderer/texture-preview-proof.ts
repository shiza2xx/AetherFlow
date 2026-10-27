type ArtifactLike={id:string;updatedAt?:string;data:Record<string,any>};

export function hasVerifiedTextureBindingProof(preview:ArtifactLike,sourceId:string,sourceHash:string){
 const data=preview?.data||{},proof=data.settings?.textureBindingProofs,checks=data.validationChecks||data.checks||{};
 const related=data.versionOf===sourceId||data.sourceParentId===sourceId||data.parentArtifactId===sourceId;
 return related&&data.sourceInputHash===sourceHash&&/\.glb$/i.test(String(data.sourceName||preview?.data?.logicalPath||preview?.data?.sourceName||''))&&
  checks.outputHashVerified===true&&checks.sourceUnmodified===true&&
  Array.isArray(proof?.materials)&&proof.materials.length>0&&Array.isArray(proof?.uv)&&proof.uv.length>0;
}

/** Prefer a proof-bearing exact-source derivative; preserve the order of all remaining history. */
export function preferVerifiedTexturePreviews<T extends ArtifactLike>(previews:readonly T[],sourceId:string,sourceHash:string):T[]{
 const preferred:T[]=[],remainder:T[]=[];
 for(const preview of previews)(hasVerifiedTextureBindingProof(preview,sourceId,sourceHash)?preferred:remainder).push(preview);
 preferred.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 return [...preferred,...remainder];
}

/** For an editable .blend chosen as the stage/workbench source, start from the master when every cached GLB is proofless. */
export function preferredTexturePreviewDefault<T extends ArtifactLike>(files:readonly T[],editableSourceId:string|undefined,markingEnabled:boolean):T|undefined{
 const first=files[0];if(!editableSourceId||!markingEnabled)return first;
 const source=files.find(file=>file.id===editableSourceId&&/\.blend$/i.test(String(file.data?.sourceName||file.data?.logicalPath||'')));
 if(!source)return first;
 const sourceHash=String(source.data.hash||'');if(!sourceHash)return source;
 const proven=files.find(file=>file.id!==source.id&&hasVerifiedTextureBindingProof(file,source.id,sourceHash));
 return proven||source;
}
