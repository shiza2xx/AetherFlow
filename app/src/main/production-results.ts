import {createHash} from 'node:crypto';
import type {ProductionResult} from '../shared/production-notices';

const imageRole=(role:string)=>/^(?:image|depth|foliage|material-reference|guide)(?::|$)|^sheet$/.test(role);
const imagePurpose=(purpose:string)=>['views','depth','texture-references'].includes(purpose);
type Submission={slotId:string;candidateId:string;reviewStatus:string};

/** Adapt successful, typed production commands after their writes have committed. */
export function productionResultForCommand(name:string,args:any,result:any):ProductionResult|undefined{
 switch(name){
  case 'guided_output_submit':
  case 'guided_correction_submit':
  case 'guided_output_batch_submit':{
   const batch=name==='guided_output_batch_submit';
   // A replay returns the original receipt, without a new committed workflow revision.
   if(batch&&!result.batch?.workflowId)return;
   const submissions:Submission[]=batch?result.batch.items:[result.submission];
   const saved=submissions.filter(item=>item?.candidateId&&['pending','submitted'].includes(item.reviewStatus));
   if(!saved.length)return;
   const slots=result.slots||result.workflow?.data?.guided?.slots||[];
   const images=saved.every(item=>imagePurpose(slots.find((slot:any)=>slot.id===item.slotId)?.purpose));
   const resultId=saved.map(item=>item.candidateId).sort().join(',');
   return {ownerKind:'character',ownerId:args.id,resultId,kind:images?'images':'results',count:saved.length};
  }
  case 'asset_job_submit_outputs':
  case 'asset_job_return_submit':{
   const ids:string[]=result.candidateIds||[];
   if(!ids.length)return;
   const images=name==='asset_job_submit_outputs'&&args.outputs.every((output:{role:string})=>imageRole(output.role));
   const resultId=createHash('sha256').update([...ids].sort().join(',')).digest('hex');
   return {ownerKind:'assetJob',ownerId:args.id,resultId,kind:images?'images':'results',count:ids.length};
  }
  case 'asset_job_shared_submit':
   if(result.source?.id&&!result.duplicate)return {ownerKind:'assetJob',ownerId:args.id,resultId:result.source.id,kind:'results',count:1};
   return;
  case 'asset_job_surface_run':
   if(args.mode==='assemble'&&result.candidateId)return {ownerKind:'assetJob',ownerId:args.id,resultId:result.candidateId,kind:'results',count:1};
   return;
  case 'asset_job_update':
   if(!args.catalogProposal)return;
   // The update wrapper can also submit a catalog proposal.
  case 'asset_job_catalog_submit':{
   const items=result.items||result.workflow?.data?.catalogProposal?.items;
   if(!items?.length||!result.workflow?.id)return;
   return {ownerKind:'assetJob',ownerId:args.id,resultId:`${result.workflow.id}:${result.workflow.revision}`,kind:'catalog',count:items.length};
  }
 }
}
