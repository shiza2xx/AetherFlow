import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {AtelierStore} from './store';
import type {Entity} from '../shared/contracts';
import type {Locale} from '../shared/i18n';
import {assetDepthStyleReference} from '../shared/asset-depth-policy';
import {assetStagePrompt,type AssetPromptContext} from '../shared/asset-prompt';
import {assetHasActivePlacementPlan} from '../shared/asset-production';
import {assetViewsForRoute} from '../shared/asset-production';
import {ownerForArtifact} from './workspace-layout';
import {materializeManualImageReference} from './manual-image-references';
import {buildManualImagePreparationRequest,validateExternalImagePrompt} from '../shared/manual-image-prompt-content';

export type ManualImageReference={artifactId?:string;hash:string;name:string;role:string;path:string;source:'managed'|'depth-style';bytes:number};
export type ManualImageSlot={itemId:string;itemName:string;route:string;role:string;view:string;mode:'color'|'depth';status:'missing'|'pending'|'accepted'|'accepted-and-pending'|'stale';inputFingerprint:string|null;pairedColorHash?:string;pairedSheetHash?:string;canonicalContext:string|null;preparationRequest:string|null;externalPrompt:string|null;promptLineageHash:string|null;references:ManualImageReference[];blockedReason?:string;candidateIds:string[];lineage:{jobId:string;workflowRevision:number;itemRevision:number;inputFingerprint:string|null;pairedColorHash?:string;pairedSheetHash?:string;promptLineageHash:string|null}};

export function selectAssetManualImagePromptBatch(cards:ManualImageSlot[],records:Record<string,any>){
 const isCurrent=(card:ManualImageSlot)=>{const saved=records[`${card.itemId}:${card.role}`];return !!saved&&typeof saved.prompt==='string'&&!!card.promptLineageHash&&saved.lineageHash===card.promptLineageHash;};
 return {targets:cards.filter(card=>!isCurrent(card)&&!card.blockedReason&&!!card.preparationRequest&&!!card.promptLineageHash),savedCount:cards.filter(isCurrent).length,blockedCount:cards.filter(card=>!!card.blockedReason).length};
}

const IMAGE_MIME=/^image\/(?:png|jpeg|webp)$/i,HEX=/^[a-f0-9]{64}$/;
const accepted=(slot:any)=>slot?.candidates?.find((candidate:any)=>candidate.id===slot.acceptedCandidateId&&candidate.status==='accepted')||null;
const pending=(slot:any)=>Array.isArray(slot?.candidates)?slot.candidates.filter((candidate:any)=>candidate.status==='pending'):[];
const roleSlot=(workflow:Entity,itemId:string,role:string)=>{const slots=workflow.data.slots as any[]||[],exact=slots.find(slot=>slot.itemId===itemId&&slot.role===role),legacy=role==='image:front'?'image':role==='depth:front'?'depth':undefined,alias=legacy&&slots.find(slot=>slot.itemId===itemId&&slot.role===legacy);return exact?.candidates?.length?exact:alias||exact;};
const roleViews=(item:Entity)=>item.data.route==='foliage'?['front','back','side','top']:assetViewsForRoute(item.data.route,item.data.views,item.data.viewType).filter((view:string)=>view==='front'||view==='side');

function managedReference(store:AtelierStore,jobId:string,artifactId:string,role:string):ManualImageReference|null{
 const artifact=store.get('artifact',artifactId);if(!artifact||!IMAGE_MIME.test(String(artifact.data.mime||''))||!HEX.test(String(artifact.data.hash||'')))return null;
 const owner=ownerForArtifact(store,artifact);if(owner?.kind!=='assetJob'||owner.id!==jobId)return null;
 try{const file=materializeManualImageReference(store,owner,{artifactId:artifact.id,hash:String(artifact.data.hash),name:artifact.name,role});return {artifactId:artifact.id,hash:String(artifact.data.hash),name:artifact.name,role,path:file.path,source:'managed',bytes:file.bytes};}catch{return null;}
}
function localReference(file:string,name:string,role:string):ManualImageReference|null{
 try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(file)!==path.resolve(file))return null;const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');return {hash,name,role,path:file,source:'depth-style',bytes:stat.size};}catch{return null;}
}

function currentAcceptedColor(context:AssetPromptContext,item:Entity,role:string){
 const view=role==='depth'?'front':role.slice('depth:'.length),slot=roleSlot(context.workflow,item.id,`image:${view}`),candidate=accepted(slot),current=((context as any).current||[]).find((entry:any)=>entry.itemId===item.id);
 if(!candidate||!candidate.inputFingerprint||!Array.isArray(current?.imageInputFingerprints)||!current.imageInputFingerprints.includes(candidate.inputFingerprint))return null;
 return candidate;
}

function imageReferenceIds(context:AssetPromptContext,item:Entity,role:string){
 const refs:{artifactId:string;role:string;hash:string|null}[]=[];
 if(role==='depth:sheet'){
  const sheet=accepted(roleSlot(context.workflow,item.id,'sheet')),current=((context as any).current||[]).find((entry:any)=>entry.itemId===item.id),fresh=(current?.sheets||[]).some((value:any)=>value.hash===sheet?.hash&&value.fresh===true);
  return sheet&&fresh?[{artifactId:sheet.artifactId,role:'accepted shared color sheet',hash:sheet.hash}]:[];
 }
 if((role.startsWith('depth:')&&role!=='depth:sheet')||role==='depth'){
  const view=role==='depth'?'front':role.slice('depth:'.length),color=currentAcceptedColor(context,item,role);
  return color?[{artifactId:color.artifactId,role:`accepted color ${view}`,hash:color.hash}]:[];
 }
 if(context.job.data.sourceArtifactId)refs.push({artifactId:context.job.data.sourceArtifactId,role:'original-source-art',hash:null});
 for(const id of item.data.sourceArtifactIds||[])refs.push({artifactId:id,role:'item source artwork',hash:null});
 const current=((context as any).current||[]).find((entry:any)=>entry.itemId===item.id),acceptedViews=(current?.images||[]).filter((image:any)=>image.candidate&&image.role!==role&&image.role!==`image:${role.split(':')[1]}`);
 if(acceptedViews.length){const first=acceptedViews[0];refs.push({artifactId:first.candidate.artifactId,role:`accepted color ${String(first.role).replace(/^image:/,'')}`,hash:String(first.candidate.hash||'')});}
 return [...new Map(refs.map(reference=>[reference.artifactId,reference])).values()];
}

function inputFingerprint(context:AssetPromptContext,item:Entity){return (((context as any).current||[]).find((entry:any)=>entry.itemId===item.id)?.imageInputFingerprint as string|undefined)||null;}

/** Build per-role manual prompts from the same canonical asset rules used by Codex requests. */
export function prepareAssetManualImageSlots(context:AssetPromptContext,store:AtelierStore,locale:Locale,depthStyleExamplePath:string):ManualImageSlot[]{
 const {job,items,workflow}=context,slots:ManualImageSlot[]=[];
 const active=!job.data.catalogRequiresRevalidation&&(job.data.catalogStatus==='accepted'||job.data.catalogStatus==='pending'&&job.data.catalogPreviouslyAccepted===true);
 for(const item of items){
  const current=((context as any).current||[]).find((entry:any)=>entry.itemId===item.id),views=roleViews(item),roles=item.data.route==='foliage'?views.map((view:string)=>`foliage:${view}`):views.map((view:string)=>`image:${view}`);
  if(item.data.route!=='foliage'&&item.data.depthEnabled===true)roles.push(...(item.data.route==='shared-prop'?['depth:front']:views.map((view:string)=>`depth:${view}`)));
  for(const role of roles){
   const isDepth=role==='depth:sheet'||role==='depth'||role.startsWith('depth:'),slot=roleSlot(workflow,item.id,role),acceptedCandidate=accepted(slot),pendingCandidates=pending(slot),input=inputFingerprint(context,item),references:ManualImageReference[]=[],candidateIds=(slot?.candidates||[]).map((candidate:any)=>String(candidate.id)),currentEntries=isDepth?current?.depths||[]:current?.images||[],currentEntry=currentEntries.find((entry:any)=>entry.role===role||(role==='depth:front'&&entry.role==='depth')||(role==='image:front'&&entry.role==='image')),acceptedIsCurrent=!!acceptedCandidate&&currentEntry?.candidate?.id===acceptedCandidate.id&&!(isDepth?current?.depthsNeedReview:current?.imagesNeedReview);
   let blockedReason:string|undefined,pairedColorHash:string|undefined,pairedSheetHash:string|undefined;
   if(!active)blockedReason='Accept and validate the catalog before preparing manual image prompts.';
   else if(!assetHasActivePlacementPlan(job,workflow))blockedReason='Composite placements are missing. Prepare and accept a non-empty placement proposal before preparing image prompts; existing outputs remain available for review and Stage 5 repair.';
   else if(isDepth&&item.data.depthEnabled!==true)blockedReason='Enable AI depth for this item before preparing a depth prompt.';
   else if(isDepth&&role==='depth:sheet'){
    const sheet=accepted(roleSlot(workflow,item.id,'sheet')),fresh=(current?.sheets||[]).some((value:any)=>value.hash===sheet?.hash&&value.fresh===true);
    if(!sheet||!fresh)blockedReason='Depth for this grouped asset needs its exact current accepted color sheet.';
    else{pairedSheetHash=sheet.hash;const ref=managedReference(store,job.id,sheet.artifactId,'accepted shared color sheet');if(ref&&ref.hash===sheet.hash)references.push(ref);else blockedReason='The accepted color sheet is not available as a verified workspace image.';}
   }else if(isDepth){
    const view=role==='depth'?'front':role.slice('depth:'.length),color=currentAcceptedColor(context,item,role);
    if(!color)blockedReason=`Depth ${view} needs its exact current accepted image:${view} color view.`;
    else{pairedColorHash=color.hash;const ref=managedReference(store,job.id,color.artifactId,`accepted color ${view}`);if(ref&&ref.hash===color.hash)references.push(ref);else blockedReason=`The accepted image:${view} color view is not available as a verified workspace image.`;}
   }else{
    for(const source of imageReferenceIds(context,item,role)){const ref=managedReference(store,job.id,source.artifactId,source.role);if(ref&&(!source.hash||ref.hash===source.hash))references.push(ref);}
    if(!references.length)blockedReason='No registered source image is available for this item.';
   }
   if(isDepth&&!blockedReason){const style=localReference(depthStyleExamplePath,'AI depth style example',assetDepthStyleReference);if(style)references.push(style);else blockedReason='The shared AI depth style example is missing from this asset workspace.';}
   let canonicalContext:string|null=null,preparationRequest:string|null=null,externalPrompt:string|null=null,promptLineageHash:string|null=null;
   if(!blockedReason){try{
    const canonical=assetStagePrompt(locale,context,{stage:'images',itemId:item.id,role}),view=role.replace(/^(foliage:|image:|depth:)/,'').replace(':',' '),lineage={jobId:job.id,itemId:item.id,role,itemRevision:item.revision,inputFingerprint:input,pairedColorHash:pairedColorHash||null,pairedSheetHash:pairedSheetHash||null,referenceHashes:references.map(reference=>reference.hash)};
    canonicalContext=canonical;
    promptLineageHash=crypto.createHash('sha256').update(JSON.stringify(lineage)).digest('hex');
    const saved=(workflow.data.manualImagePrompts||{})[`${item.id}:${role}`];
    if(saved?.lineageHash===promptLineageHash&&typeof saved.prompt==='string')externalPrompt=validateExternalImagePrompt(saved.prompt);
    preparationRequest=buildManualImagePreparationRequest({locale,target:`${item.name} · ${view} · ${isDepth?'depth map':'color view'} · asset ${item.id} · role ${role} · workflow ${workflow.id} revision ${workflow.revision}`,purpose:isDepth?'depth':'color',canonicalRequest:canonical,references:references.map(({name,role,path,hash})=>({name,role,path,hash}))});
   }catch(error){blockedReason=error instanceof Error?error.message:String(error);}}
   slots.push({itemId:item.id,itemName:item.name,route:item.data.route,role,view:role.replace(/^(foliage:|image:|depth:)/,'').replace(':',' '),mode:isDepth?'depth':'color',status:acceptedCandidate&&!acceptedIsCurrent?'stale':acceptedCandidate&&pendingCandidates.length?'accepted-and-pending':acceptedCandidate?'accepted':pendingCandidates.length?'pending':'missing',inputFingerprint:input,...(pairedColorHash?{pairedColorHash}:{}),...(pairedSheetHash?{pairedSheetHash}:{}),canonicalContext,preparationRequest,externalPrompt,promptLineageHash,references,...(blockedReason?{blockedReason}:{}),candidateIds,lineage:{jobId:job.id,workflowRevision:workflow.revision,itemRevision:item.revision,inputFingerprint:input,...pairedColorHash?{pairedColorHash}:{},...pairedSheetHash?{pairedSheetHash}:{},promptLineageHash}});
  }
 }
 return slots;
}

/** Save a partial Codex batch against exact current asset slots, preserving replaced prompts in history. */
export function saveAssetManualImagePromptsBatch(store:AtelierStore,context:AssetPromptContext,locale:Locale,depthStyleExamplePath:string,input:{expectedJobRevision:number;expectedWorkflowRevision:number;outputs:Array<{itemId:string;role:string;lineageHash:string;prompt:string}>}){
 const {job,workflow}=context;
 if(job.revision!==input.expectedJobRevision||workflow.revision!==input.expectedWorkflowRevision)throw Object.assign(new Error('The asset job or workflow changed while Codex prepared the manual prompts.'),{code:'REVISION_CONFLICT'});
 if(!Array.isArray(input.outputs)||!input.outputs.length||input.outputs.length>100)throw new Error('Submit 1–100 manual image prompts per batch call.');
 const cards=prepareAssetManualImageSlots(context,store,locale,depthStyleExamplePath),records={...(workflow.data.manualImagePrompts||{})},seen=new Set<string>(),results:any[]=[];let savedAny=false;
 for(const output of input.outputs){
  const key=`${output.itemId}:${output.role}`;if(seen.has(key)){results.push({itemId:output.itemId,role:output.role,status:'duplicate'});continue;}seen.add(key);
  const card=cards.find(value=>value.itemId===output.itemId&&value.role===output.role);
  if(!card||card.blockedReason||!card.preparationRequest||card.promptLineageHash!==output.lineageHash){results.push({itemId:output.itemId,role:output.role,status:'stale-or-owner-mismatch'});continue;}
  const saved=(workflow.data.manualImagePrompts||{})[key];if(saved&&typeof saved.prompt==='string'&&saved.lineageHash===card.promptLineageHash){results.push({itemId:output.itemId,role:output.role,status:'already-saved'});continue;}
  try{const prompt=validateExternalImagePrompt(output.prompt),history=Array.isArray(saved?.history)?saved.history.slice():[];if(saved&&typeof saved.prompt==='string')history.push({prompt:saved.prompt,lineageHash:saved.lineageHash,savedAt:saved.savedAt});records[key]={prompt,lineageHash:card.promptLineageHash!,savedAt:new Date().toISOString(),locale,...history.length?{history}:{}};results.push({itemId:output.itemId,role:output.role,status:'saved'});savedAny=true;}
  catch(error){results.push({itemId:output.itemId,role:output.role,status:'invalid',message:error instanceof Error?error.message:String(error)});}
 }
 if(savedAny){const latest=store.get('workflow',workflow.id);if(!latest||latest.revision!==input.expectedWorkflowRevision)throw Object.assign(new Error('The asset workflow changed before the manual prompt batch could be saved.'),{code:'REVISION_CONFLICT'});store.transaction(()=>store.assetProductionPut({kind:'workflow',id:workflow.id,name:workflow.name,data:{...workflow.data,manualImagePrompts:records,updatedAt:new Date().toISOString()},expectedRevision:workflow.revision}));}
 return {jobId:job.id,workflowId:workflow.id,jobRevision:job.revision,workflowRevision:store.get('workflow',workflow.id)?.revision||workflow.revision,results,saved:results.filter(item=>item.status==='saved').length,remaining:results.filter(item=>!['saved','already-saved'].includes(item.status)).length};
}
