import crypto from 'node:crypto';
import fs from 'node:fs';
import type {Entity} from '../shared/contracts';
import {AtelierStore} from './store';
import {viewerCharacterForAsset} from './viewer-lineage';

export type AcceptedWorkbenchCorrection={artifact:Entity;hash:string;sourceArtifactId:string;purpose:string;operation:Entity;supersededHashes:string[]};
const MAX_WORKBENCH_LINEAGE_DEPTH=256;
const HASH=/^[a-f0-9]{64}$/;
const model=(item:any)=>/\.(blend|glb|gltf|fbx|obj)$/i.test(String(item?.data?.sourceName||item?.name||''));
const protectedSlot=(slot:any)=>slot?.purpose==='report'||/^(source|reference|depth|texture-reference|.*baseline|.*report|.*audit|.*handoff|groups-manifest|component-inventory|texture-guide-)/.test(String(slot?.key||''));

function artifactHashIsPresent(store:AtelierStore,item:any){const hash=String(item?.data?.hash||'');if(!HASH.test(hash))return false;const file=store.object(hash);return !!file&&fs.existsSync(file);}

/** Returns only the character's explicitly reviewed, byte-pinned current workbench version. */
export function currentAcceptedWorkbenchCorrection(store:AtelierStore,characterId:string):AcceptedWorkbenchCorrection|null{
 const character=store.get('character',characterId),review=character?.data?.workbenchReview as any,id=String(character?.data?.workbenchCurrentArtifactId||''),artifact=id?store.get('artifact',id):null;
 if(!character||!review||!artifact||review.artifactId!==id||review.hash!==artifact.data.hash||!HASH.test(String(review.hash||''))||viewerCharacterForAsset(store,artifact)!==characterId||!artifactHashIsPresent(store,artifact))return null;
 const operation=store.get('operation',String(review.operationId||'')),purpose=String(operation?.data?.purpose||''),sourceArtifactId=String(operation?.data?.sourceArtifactId||''),source=sourceArtifactId?store.get('artifact',sourceArtifactId):null;
 const audit=operation?.data?.audit as any,checks=audit?.checks;
 if(!operation||operation.data.workbench!==true||operation.data.characterId!==characterId||operation.data.status!=='accepted'||!['accept','adopt'].includes(String(operation.data.reviewDecision||''))||operation.data.candidateArtifactId!==artifact.id||operation.data.candidateHash!==artifact.data.hash||artifact.data.operationId!==operation.id||artifact.data.sourceInputHash!==operation.data.sourceHash||artifact.data.versionOf!==sourceArtifactId||artifact.data.sourceParentId!==sourceArtifactId||!source||source.data.hash!==operation.data.sourceHash||pathIsNotBlend(source)||!artifactHashIsPresent(store,source)||!artifact.data.immutableVersion||!HASH.test(String(artifact.data.immutableManifestHash||''))||pathIsNotBlend(artifact)||viewerCharacterForAsset(store,source)!==characterId||!['geometry','materials','textures','weights','placement'].includes(purpose)||audit?.operation!=='workbench-audit'||audit.ok!==true||audit.candidateHash!==artifact.data.hash||!Array.isArray(checks?.changedObjects)||!Array.isArray(checks?.geometryChangedObjects)||checks.sourceBytesPreserved!==true||checks.candidateBytesVerified!==true||checks.reopenedVerified!==true||checks.protectedObjectsPreserved!==true||checks.declaredTargetPropertiesPreserved!==true||checks.rigAndActionsPreserved!==true||!Array.isArray(artifact.data.validationChecks?.geometryChangedObjects)||JSON.stringify(artifact.data.validationChecks.geometryChangedObjects)!==JSON.stringify(checks.geometryChangedObjects)||checks.sourceBytesPreserved!==artifact.data.validationChecks.sourceBytesPreserved||checks.candidateBytesVerified!==artifact.data.validationChecks.candidateBytesVerified||checks.reopenedVerified!==artifact.data.validationChecks.reopenedVerified||['materials','textures','weights'].includes(purpose)&&checks.geometryChangedObjects.length>0)return null;
 // Check every workbench edge between this accepted version and its root. A stale pointer,
 // broken hash edge, foreign owner, or unaccepted correction in the chain is not current.
 let cursor:Entity=artifact;const seen=new Set<string>(),supersededHashes:string[]=[];let depth=0,rootReached=false;
 while(depth<MAX_WORKBENCH_LINEAGE_DEPTH){if(seen.has(cursor.id))return null;seen.add(cursor.id);depth++;const parentId=String(cursor.data.versionOf||cursor.data.sourceParentId||'');if(!parentId){rootReached=true;break;}if(cursor.data.versionOf&&cursor.data.sourceParentId&&cursor.data.versionOf!==cursor.data.sourceParentId)return null;const parent=store.get('artifact',parentId);if(!parent||viewerCharacterForAsset(store,parent)!==characterId||cursor.data.sourceInputHash!==parent.data.hash)return null;if(cursor.data.operationId){const edge=store.get('operation',String(cursor.data.operationId));if(edge?.data.workbench===true&&(edge.data.status!=='accepted'||edge.data.characterId!==characterId||edge.data.sourceArtifactId!==parent.id||edge.data.sourceHash!==parent.data.hash||edge.data.candidateArtifactId!==cursor.id||edge.data.candidateHash!==cursor.data.hash))return null;}supersededHashes.push(String(parent.data.hash));cursor=parent;}
 if(!rootReached)throw new Error(`Workbench artifact lineage exceeds the ${MAX_WORKBENCH_LINEAGE_DEPTH}-version verification limit.`);
 return {artifact,hash:String(artifact.data.hash),sourceArtifactId,purpose,operation,supersededHashes:[...new Set(supersededHashes)]};
}

function pathIsNotBlend(item:any){return !/\.blend$/i.test(String(item?.data?.sourceName||item?.name||''));}
function compatiblePurpose(purpose:string,slot:any,original:any){
 if(!model(original))return false;
 if(['geometry','placement'].includes(purpose))return true;
 if(['materials','textures'].includes(purpose))return true;
 if(purpose==='weights')return /^(rigged-model|texture-repair-candidate|weight-cleanup-candidate|verified-export|final-validation-report)$/.test(String(slot?.key||''));
 return false;
}

/** Resolve the live source for a stage slot without changing its immutable history record. */
export function operativeWorkbenchSourceForSlot(store:AtelierStore,characterId:string,slot:any,acceptedCorrection?:AcceptedWorkbenchCorrection|null):{artifact:Entity;hash:string;sourceHash:string;workbenchCorrection:boolean;purpose:string|null;stale?:boolean}|null{
 const originalId=String(slot?.artifactId||'');if(!originalId)return null;const original=store.get('artifact',originalId);if(!original||viewerCharacterForAsset(store,original)!==characterId||!artifactHashIsPresent(store,original))return null;
 // Slot hashes are immutable workflow pins. If the slot record itself is stale or
 // inconsistent, do not silently bless the artifact bytes as its current input.
 if(slot.hash&&slot.hash!==original.data.hash)return null;
 if(protectedSlot(slot))return {artifact:original,hash:String(original.data.hash),sourceHash:String(original.data.hash),workbenchCorrection:false,purpose:null};
 const correction=acceptedCorrection===undefined?currentAcceptedWorkbenchCorrection(store,characterId):acceptedCorrection;if(!correction||!compatiblePurpose(correction.purpose,slot,original))return {artifact:original,hash:String(original.data.hash),sourceHash:String(original.data.hash),workbenchCorrection:false,purpose:null};
 // A later accepted native guided result is already the operative descendant when its
 // trusted/accepted candidate explicitly records the correction's exact input hash.
 const currentCandidate=(slot.candidates||[]).find((row:any)=>row.id===slot.candidateId);
 if(slot.reviewStatus==='accepted'&&currentCandidate?.reviewStatus==='accepted'&&currentCandidate.artifactId===original.id&&currentCandidate.hash===original.data.hash&&Array.isArray(currentCandidate.parentInputHashes)&&currentCandidate.parentInputHashes.includes(correction.hash))return {artifact:original,hash:String(original.data.hash),sourceHash:String(original.data.hash),workbenchCorrection:false,purpose:correction.purpose};
 const baselineCompatibleMaterialCorrection=slot.key==='mesh-only-fbx'&&['materials','textures'].includes(correction.purpose)&&correction.artifact.data.validationChecks?.geometryChangedObjects?.length===0;
 if(!baselineCompatibleMaterialCorrection&&currentCandidate&&['accepted','pending','submitted'].includes(String(slot.reviewStatus||''))&&Array.isArray(currentCandidate.parentInputHashes)&&currentCandidate.parentInputHashes.some((hash:string)=>correction.supersededHashes.includes(hash))&&!currentCandidate.parentInputHashes.includes(correction.hash))return {artifact:original,hash:String(original.data.hash),sourceHash:String(original.data.hash),workbenchCorrection:false,purpose:correction.purpose,stale:true};
 let cursor:Entity=correction.artifact;const seen=new Set<string>();let rootReached=false;for(let depth=0;depth<MAX_WORKBENCH_LINEAGE_DEPTH;depth++){if(cursor.id===original.id)return {artifact:correction.artifact,hash:correction.hash,sourceHash:String(original.data.hash),workbenchCorrection:true,purpose:correction.purpose};if(seen.has(cursor.id))break;seen.add(cursor.id);const parentId=String(cursor.data.versionOf||cursor.data.sourceParentId||'');if(!parentId){rootReached=true;break;}if(cursor.data.versionOf&&cursor.data.sourceParentId&&cursor.data.versionOf!==cursor.data.sourceParentId)break;const parent=store.get('artifact',parentId);if(!parent||cursor.data.sourceInputHash!==parent.data.hash||viewerCharacterForAsset(store,parent)!==characterId)break;cursor=parent;}
 if(!rootReached&&seen.size>=MAX_WORKBENCH_LINEAGE_DEPTH)throw new Error(`Workbench source lineage exceeds the ${MAX_WORKBENCH_LINEAGE_DEPTH}-version verification limit.`);
 return {artifact:original,hash:String(original.data.hash),sourceHash:String(original.data.hash),workbenchCorrection:false,purpose:null};
}
