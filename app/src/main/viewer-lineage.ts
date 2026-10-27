import type {Entity} from '../shared/contracts';

type ViewerLineageLink={from_id:string;to_id:string;role?:string};
type ViewerLineageStore={getAny:(id:string)=>Entity|null;links:(id:string)=>ViewerLineageLink[]};

function guidedWorkflowCharacter(store:ViewerLineageStore,workflow:Entity):string|null{
 if(workflow.kind!=='workflow'||workflow.data.definitionVersion!==2||!workflow.data.guided)return null;
 const characterId=typeof workflow.data.characterId==='string'?workflow.data.characterId:'';
 const character=characterId?store.getAny(characterId):null;
 if(character?.kind!=='character'||character.data.workflowId!==workflow.id)return null;
 // A v2 workflow is canonical only when both persisted sides and the explicit
 // character -> workflow relation agree. Operation metadata is not ownership.
 const canonical=store.links(workflow.id).some(link=>link.from_id===character.id&&link.to_id===workflow.id&&link.role==='workflow');
 return canonical?character.id:null;
}

function guidedWorkflowOwnsArtifact(store:ViewerLineageStore,workflow:Entity,artifact:Entity):string|null{
 const characterId=guidedWorkflowCharacter(store,workflow);
 if(!characterId||typeof artifact.data.hash!=='string')return null;
 const slots=workflow.data.guided&&typeof workflow.data.guided==='object'?(workflow.data.guided as Record<string,unknown>).slots:undefined;
 if(!Array.isArray(slots)||!slots.some((slot:any)=>slot&&slot.artifactId===artifact.id&&slot.hash===artifact.data.hash))return null;
 // Require the workflow's own typed guided-output relation as corroboration;
 // arbitrary links to an artifact do not grant viewer access.
 const membership=store.links(artifact.id).some(link=>link.from_id===workflow.id&&link.to_id===artifact.id&&(link.role?.startsWith('guided:')||link.role?.startsWith('guided-correction:')));
 return membership?characterId:null;
}

/** Resolve only bounded recorded artifact ancestry and verified typed workflow membership. */
export function viewerCharacterForAsset(store:ViewerLineageStore,asset:Entity):string|null{
 const pending:Entity[]=[asset],seen=new Set<string>();
 while(pending.length&&seen.size<16){
  const current=pending.shift()!;if(seen.has(current.id))continue;seen.add(current.id);
  if(current.kind==='character')return current.id;
  if(current.kind!=='artifact')continue;
  const parentId=typeof current.data.parentId==='string'?current.data.parentId:'';
  if(parentId){const parent=store.getAny(parentId);if(parent?.kind==='character')return parent.id;if(parent?.kind==='artifact')pending.push(parent);}
  for(const key of ['sourceParentId','versionOf','versionRootId']){const id=current.data[key];if(typeof id!=='string'||seen.has(id))continue;const parent=store.getAny(id);if(parent?.kind==='character')return parent.id;if(parent?.kind==='artifact')pending.push(parent);}
  for(const link of store.links(current.id)){
   const otherId=link.from_id===current.id?link.to_id:link.from_id,other=store.getAny(otherId);
   if(other?.kind==='character')return other.id;
   if(other?.kind==='workflow'&&link.from_id===other.id&&link.to_id===current.id){const characterId=guidedWorkflowOwnsArtifact(store,other,current);if(characterId)return characterId;}
  }
 }
 return null;
}
