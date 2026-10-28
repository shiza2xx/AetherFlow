import crypto from 'node:crypto';
import {AtelierStore} from './store';
import {WorkflowDataSchema,isPublishedV1WorkflowData} from '../shared/domain';
import type {Entity} from '../shared/contracts';

export function independentRigAuditPasses(hash:string,audit:any){return audit?.ok===true&&audit?.checkKey==='skeleton-and-actions-valid'&&audit?.outputHash===hash&&audit?.autoexec==='disabled'&&audit?.details?.boneCount>0&&audit?.details?.weightsPreserved===true&&/^[a-f0-9]{64}$/.test(audit?.details?.restPoseFingerprint||'')&&Array.isArray(audit?.details?.actions);}
export function independentWeightAuditPasses(hash:string,audit:any){return audit?.ok===true&&audit?.checkKey==='weight-invariants-valid'&&audit?.outputHash===hash&&audit?.autoexec==='disabled'&&audit?.details?.editedVertices>=0&&audit?.details?.unmodifiedWeightsPreserved===true&&audit?.details?.maxInfluences>=1;}
export type TransportActor='ui'|'mcp'|'system';

/** Shared persistence for guided-v2 workflow events and task-backed blockers.
 * Retired v1 workflow execution lives nowhere in this service. Historical
 * records are exposed through historicalArchive() as detached read-only data.
 */
export class AtelierDomain{
 constructor(readonly store:AtelierStore){}
 private record(entityId:string,event:string,actor:TransportActor,payload:unknown){this.store.db.prepare('INSERT INTO domain_events(id,entity_id,event_type,actor,payload,created_at) VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),entityId,event,actor,JSON.stringify(payload),new Date().toISOString());}
 workflowFor(characterId:string){
  const character=this.store.get('character',characterId);if(!character)throw new Error('Character not found.');
  const id=String(character.data.workflowId||''),workflow=id?this.store.get('workflow',id):this.store.workflowForCharacter(characterId);
  if(!workflow)throw new Error('Character workflow is missing.');
  if(workflow.data.definitionVersion!==2||!workflow.data.guided)throw Object.assign(new Error('The retired v1 production route is read-only. Use guided v2 actions for current production.'),{code:'LEGACY_WORKFLOW_READ_ONLY'});
  const data=WorkflowDataSchema.parse(workflow.data);return {character,workflow,data};
 }
 historicalArchive(characterId:string){
  const character=this.store.get('character',characterId);if(!character)throw new Error('Character not found.');
  const id=String(character.data.workflowId||''),workflow=id?this.store.get('workflow',id):this.store.workflowForCharacter(characterId);
  if(!workflow)return {character,workflow:null,data:{definitionVersion:1,stages:[],slots:[]}};
  const data=workflow.data&&typeof workflow.data==='object'?workflow.data as Record<string,unknown>:{};
  const stages=Array.isArray(data.stages)?data.stages.slice(0,1000).map((stage:any)=>({id:String(stage.id||''),key:String(stage.key||''),name:String(stage.name||stage.key||''),status:String(stage.status||'idle'),required:stage.required!==false,applicable:stage.applicable!==false,candidates:Array.isArray(stage.candidates)?stage.candidates.slice(0,1000).map((candidate:any)=>({artifactId:String(candidate.artifactId||''),hash:String(candidate.hash||''),reviewStatus:String(candidate.reviewStatus||'')})):[]})):[];
  const slots=Array.isArray(data.slots)?data.slots.slice(0,10000).map((slot:any)=>({id:String(slot.id||''),stageId:String(slot.stageId||''),role:String(slot.role||''),artifactIds:Array.isArray(slot.artifactIds)?slot.artifactIds.slice(0,1000).map(String):[]})):[];
  return {character,workflow,data:{definitionVersion:isPublishedV1WorkflowData(data)?1:data.definitionVersion,stages,slots}};
 }
 createBlockerIssue(characterId:string,stageKey:string,name:string,blockedReason:string,actor:TransportActor='mcp'){
  const {character}=this.workflowFor(characterId);const cleanName=name.trim(),reason=blockedReason.trim();if(!cleanName||cleanName.length>240||!reason||reason.length>4000)throw new Error('Issue title and actionable blocker details are required.');
  const issueId=crypto.randomUUID(),taskId=crypto.randomUUID(),data={status:'Blocked',priority:'High',progress:0,blocker:true,blockerIssueId:issueId,resolutionState:'unresolved',stageKey,blockedReason:reason,source:'guided-workflow',createdByTransport:actor};
  return this.store.transaction(()=>{this.store.db.prepare('INSERT INTO task_issue_authorizations(id,task_id,used) VALUES(?,?,0)').run(crypto.randomUUID(),taskId);const task=this.store.put({id:taskId,kind:'task',name:cleanName,data});this.store.link(character.id,task.id,'blocker');this.record(character.id,'blocker.issue_created',actor,{taskId:task.id,blockerIssueId:issueId,stageKey});return task;});
 }
 resolveBlocker(taskId:string,note=''){
  const task=this.store.get('task',taskId);if(!task||task.data.blocker!==true||task.data.resolutionState==='resolved'||typeof task.data.blockerIssueId!=='string')throw new Error('An unresolved workflow blocker task was not found.');
  const characterLink=this.store.links(task.id).find((link:any)=>link.role==='blocker'),characterId=String(characterLink?(characterLink.from_id===task.id?characterLink.to_id:characterLink.from_id):'');if(!characterId)throw new Error('The guided character for this blocker was not found.');this.workflowFor(characterId);
  return this.store.transaction(()=>{this.store.db.prepare('INSERT INTO task_resolution_authorizations(id,task_id,used) VALUES(?,?,0)').run(crypto.randomUUID(),task.id);const resolved=this.store.put({id:task.id,kind:'task',name:task.name,data:{...task.data,status:'Done',progress:100,resolutionState:'resolved',resolutionNote:note,resolvedBy:'human',resolvedAt:new Date().toISOString()},expectedRevision:task.revision});this.store.markRestoreAuthorityChanged();return resolved;});
 }
 saveGuidedWorkflow(workflow:Entity,data:any,actor:TransportActor,event:string,payload:unknown){
  if(workflow.kind!=='workflow'||workflow.data.definitionVersion!==2||!workflow.data.guided||data.definitionVersion!==2||!data.guided)throw Object.assign(new Error('The retired v1 workflow cannot be modified. Use guided v2.'),{code:'LEGACY_WORKFLOW_READ_ONLY'});
  return this.store.transaction(()=>{this.store.assertCharacterActive(String(data.characterId));data.updatedAt=new Date().toISOString();const previous=workflow.data as any,changed=(previous.stages||[]).filter((before:any)=>before.status==='accepted'&&data.stages?.find((next:any)=>next.id===before.id)?.status==='invalidated');this.store.db.prepare('INSERT INTO workflow_mutation_authorizations(id,workflow_id,used) VALUES(?,?,0)').run(crypto.randomUUID(),workflow.id);for(const stage of changed)this.store.db.prepare('INSERT INTO workflow_invalidation_authorizations(id,workflow_id,stage_id,used) VALUES(?,?,?,0)').run(crypto.randomUUID(),workflow.id,stage.id);if(changed.length)this.store.db.prepare('UPDATE independent_checks SET valid=0 WHERE character_id=?').run(String(data.characterId));const saved=this.store.put({id:workflow.id,kind:'workflow',name:workflow.name,data,expectedRevision:workflow.revision});this.store.markRestoreAuthorityChanged();this.record(String(data.characterId),event,actor,payload);return saved;});
 }
}
