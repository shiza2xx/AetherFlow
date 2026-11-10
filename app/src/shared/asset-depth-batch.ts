import type {Entity} from './contracts';
import {assetViewsForRoute,unsupportedAssetViews} from './asset-production';

export type AssetDepthBatchContext={job:Entity;items:Entity[];workflow:Entity;current?:unknown[]};
export type AssetDepthBatchCandidate={candidateId:string;artifactId:string;hash:string;status:'pending'|'accepted';inputFingerprint:string|null;dependsOnColorHash?:string|null};
export type AssetDepthBatchRole={itemId:string;itemName:string;route:string;role:string;view:string;colorRole:string;color:{candidateId:string;artifactId:string;hash:string;inputFingerprint:string};reason:'missing'|'stale-existing'|'legacy-source-unknown';priorDepthCandidates:AssetDepthBatchCandidate[]};
export type AssetDepthBatchWaiting={itemId:string;itemName:string;role:string;colorRole:string;reason:'catalog-not-accepted'|'catalog-unsupported'|'color-not-accepted'|'color-pending'|'color-stale';pendingColorCandidateIds?:string[]};
export type AssetDepthBatchExcluded={itemId:string;itemName:string;role:string;reason:'depth-not-enabled'};
export type AssetDepthBatchSkipped={itemId:string;itemName:string;role:string;reason:'accepted-current'|'pending-current';candidateId:string};
export type AssetDepthBatchPlan={enabled:boolean;catalogActive:boolean;actionable:AssetDepthBatchRole[];waiting:AssetDepthBatchWaiting[];skipped:AssetDepthBatchSkipped[];excluded:AssetDepthBatchExcluded[]};

const slotsOf=(context:AssetDepthBatchContext):any[]=>Array.isArray(context.workflow.data.slots)?context.workflow.data.slots as any[]:[];
const currentOf=(context:AssetDepthBatchContext,itemId:string):any=>(context.current as any[]||[]).find(value=>value?.itemId===itemId)||{};
const roleSlot=(slots:any[],itemId:string,role:string)=>slots.find(slot=>slot?.itemId===itemId&&slot?.role===role);
const acceptedCandidate=(slot:any)=>slot?.candidates?.find((value:any)=>value?.id===slot.acceptedCandidateId&&value?.status==='accepted')||null;
const pendingCandidates=(slot:any)=>Array.isArray(slot?.candidates)?slot.candidates.filter((value:any)=>value?.status==='pending'):[];
const candidateSummary=(candidate:any):AssetDepthBatchCandidate=>({candidateId:candidate.id,artifactId:candidate.artifactId,hash:candidate.hash,status:candidate.status,inputFingerprint:typeof candidate.inputFingerprint==='string'?candidate.inputFingerprint:null,...typeof candidate.dependsOnColorHash==='string'?{dependsOnColorHash:candidate.dependsOnColorHash}:{}});

function catalogActive(context:AssetDepthBatchContext){const job=context.job.data;return job.catalogRequiresRevalidation!==true&&(job.catalogStatus==='accepted'||job.catalogStatus==='pending'&&job.catalogPreviouslyAccepted===true);}
function jobDepthEnabled(_context:AssetDepthBatchContext,solidItems:Entity[]){return solidItems.some(item=>item.data.depthEnabled===true);}
function viewSlots(slots:any[],itemId:string,kind:'image'|'depth',view:string){return [roleSlot(slots,itemId,`${kind}:${view}`),view==='front'?roleSlot(slots,itemId,kind):undefined].filter((slot,index,array)=>slot&&array.indexOf(slot)===index);}
function candidateMatchesSource(candidate:any,fingerprints:string[],sourceHash:string){
 if(!candidate||!candidate.inputFingerprint||!fingerprints.includes(candidate.inputFingerprint))return false;
 return candidate.dependsOnColorHash===sourceHash;
}

export function assetDepthBatchPlan(context:AssetDepthBatchContext):AssetDepthBatchPlan{
 const jobId=context.job.id,ownedItems=context.items.filter(item=>!item.data.jobId||item.data.jobId===jobId),solidItems=ownedItems.filter(item=>item.data.route!=='foliage'),enabled=jobDepthEnabled(context,solidItems),active=catalogActive(context),slots=slotsOf(context),currentByItem=new Map((context.current as any[]||[]).filter(value=>value?.itemId).map(value=>[value.itemId,value]));
 if(context.workflow.data.assetJobId&&context.workflow.data.assetJobId!==jobId)return {enabled,catalogActive:active,actionable:[],waiting:[],skipped:[],excluded:[]};
 const actionable:AssetDepthBatchRole[]=[],waiting:AssetDepthBatchWaiting[]=[],skipped:AssetDepthBatchSkipped[]=[],excluded:AssetDepthBatchExcluded[]=[];
 if(!active)return {enabled,catalogActive:active,actionable,waiting,skipped,excluded};

 const depthFor=(item:Entity,role:string,view:string,colorRole:string,color:{candidateId:string;artifactId:string;hash:string;inputFingerprint:string})=>{
  const candidateSlots=viewSlots(slots,item.id,'depth',view),history=candidateSlots.flatMap((slot:any)=>Array.isArray(slot?.candidates)?slot.candidates:[]),fingerprints=(currentByItem.get(item.id) as any)?.imageInputFingerprints||[],usable=history.find((candidate:any)=>['accepted','pending'].includes(candidate.status)&&candidateMatchesSource(candidate,fingerprints,color.hash));
  if(usable){skipped.push({itemId:item.id,itemName:item.name,role,reason:usable.status==='accepted'?'accepted-current':'pending-current',candidateId:usable.id});return;}
  const relevant=history.filter((candidate:any)=>candidate.status==='accepted'||candidate.status==='pending'),priorDepthCandidates=relevant.map(candidateSummary),unbound=relevant.some((candidate:any)=>!candidate.inputFingerprint||!candidate.dependsOnColorHash);
  actionable.push({itemId:item.id,itemName:item.name,route:item.data.route,role,view,colorRole,color,reason:!relevant.length?'missing':unbound?'legacy-source-unknown':'stale-existing',priorDepthCandidates});
 };

 for(const item of solidItems){
  const catalogViews=assetViewsForRoute(item.data.route,item.data.views,item.data.viewType).filter(view=>view==='front'||view==='side'),views=item.data.route==='shared-prop'?['front']:catalogViews,unsupported=unsupportedAssetViews(item.data.route,item.data.views),current:any=currentByItem.get(item.id)||{};
  if(item.data.depthEnabled!==true){for(const view of views)excluded.push({itemId:item.id,itemName:item.name,role:`depth:${view}`,reason:'depth-not-enabled'});continue;}
  if(unsupported.length){for(const view of views)waiting.push({itemId:item.id,itemName:item.name,role:`depth:${view}`,colorRole:`image:${view}`,reason:'catalog-unsupported'});continue;}
  for(const view of views){
   const colorRole=`image:${view}`,colorSlots=viewSlots(slots,item.id,'image',view),acceptedRows=colorSlots.map((slot:any)=>acceptedCandidate(slot)).filter(Boolean),pending=colorSlots.flatMap((slot:any)=>pendingCandidates(slot)),fingerprints=Array.isArray(current.imageInputFingerprints)?current.imageInputFingerprints:[],accepted=acceptedRows.find((candidate:any)=>candidate.inputFingerprint&&fingerprints.includes(candidate.inputFingerprint))||acceptedRows[0];
   if(!accepted){waiting.push({itemId:item.id,itemName:item.name,role:`depth:${view}`,colorRole,reason:pending.length?'color-pending':'color-not-accepted',...pending.length?{pendingColorCandidateIds:pending.map((value:any)=>value.id)}:{}});continue;}
   if(!accepted.artifactId||!accepted.hash||!accepted.inputFingerprint||!fingerprints.includes(accepted.inputFingerprint)){waiting.push({itemId:item.id,itemName:item.name,role:`depth:${view}`,colorRole,reason:'color-stale'});continue;}
   const color={candidateId:accepted.id,artifactId:accepted.artifactId,hash:accepted.hash,inputFingerprint:accepted.inputFingerprint},role=`depth:${view}`;
    depthFor(item,role,view,colorRole,color);
  }
 }

 return {enabled,catalogActive:active,actionable,waiting,skipped,excluded};
}
