import type {AtelierStore} from './store';
import type {AtelierDomain} from './domain-service';

export function generationSources(store:AtelierStore,id:string){
  const entity=store.getAny(id);if(!entity||!['concept','character'].includes(entity.kind))throw new Error('Choose a concept or character with source artwork.');
  const links=store.links(id),linked=links.map((link:any)=>store.getAny(link.from_id===id?link.to_id:link.from_id));
  const outputs=new Set<string>();
  if(entity.kind==='character'){
    const workflow=entity.data.workflowId?store.get('workflow',String(entity.data.workflowId)):store.workflowForCharacter(id);
    for(const stage of workflow?.data.stages||[])for(const candidate of stage.candidates||[])outputs.add(candidate.artifactId);
    for(const slot of workflow?.data.slots||[])for(const artifactId of slot.artifactIds||[])outputs.add(artifactId);
  }
  const explicit=[...(Array.isArray(entity.data.referenceArtifactIds)?entity.data.referenceArtifactIds:[]),entity.data.referenceArtifactId];
  for(const concept of linked.filter((item:any)=>item?.kind==='concept'))explicit.push(...(concept!.data.referenceArtifactIds||[]),concept!.data.referenceArtifactId);
  const ids=[...explicit,...linked.filter((item:any)=>item?.kind==='artifact'&&(!outputs.has(item.id)||links.some((link:any)=>link.role==='source artwork'&&(link.from_id===item.id||link.to_id===item.id)))).map((item:any)=>item!.id)].filter(Boolean);
  const sources=[...new Set(ids)].map(id=>store.get('artifact',String(id))).filter(item=>item&&/^image\//.test(String(item.data.mime)));
  return {entity,sources};
}
export function prepareGeneration(_store:AtelierStore,_domain:AtelierDomain,_input:{entityId:string;referenceIds:string[];spec:Record<string,any>},_create:(id:string,stage:string,parent?:string)=>Promise<any>):never{
  throw new Error('Legacy reference generation is retired. Start guided v2 from a Gallery concept and use its typed stage actions.');
}