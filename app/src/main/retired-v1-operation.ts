import {isPublishedV1CharacterData,isPublishedV1WorkflowData} from '../shared/domain';

export type OperationRecord={id:string;data:Record<string,any>};
export type HistoricalEntity={id:string;kind:string;data:Record<string,any>}|undefined;
type HistoricalWorkflowLink=(characterId:string,workflowId:string)=>boolean;

/** Ignore only a v1 operation tied to a bounded published character/workflow pair and saved link. */
export function isRetiredV1Operation(operation:OperationRecord,getEntity:(kind:'character'|'workflow',id:string)=>HistoricalEntity,hasWorkflowLink:HistoricalWorkflowLink=()=>false){
 const data=operation?.data;
 if(!data||data.schemaVersion!==1||!['running','queued','cancelling'].includes(String(data.status||''))||data.definitionVersion!==undefined&&data.definitionVersion!==1)return false;
 const characterId=typeof data.characterId==='string'?data.characterId:'',savedWorkflowId=typeof data.workflowId==='string'?data.workflowId:'';
 if(!characterId)return false;
 const character=getEntity('character',characterId),workflowId=savedWorkflowId||String(character?.data.workflowId||'');
 if(!workflowId||character?.kind!=='character'||character.data.workflowId!==workflowId||!isPublishedV1CharacterData(character.data))return false;
 const workflow=getEntity('workflow',workflowId);
 return workflow?.kind==='workflow'&&workflow.id===workflowId&&isPublishedV1WorkflowData(workflow.data)&&workflow.data.characterId===characterId&&hasWorkflowLink(characterId,workflowId);
}

export function hasActiveWorkspaceOperations(operations:OperationRecord[],getEntity:(kind:'character'|'workflow',id:string)=>HistoricalEntity,hasWorkflowLink:HistoricalWorkflowLink=()=>false){
 return operations.some(operation=>['running','queued'].includes(String(operation?.data?.status||''))&&!isRetiredV1Operation(operation,getEntity,hasWorkflowLink));
}
