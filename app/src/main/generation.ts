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
let tail:Promise<unknown>=Promise.resolve();
export function prepareGeneration(store:AtelierStore,domain:AtelierDomain,input:{entityId:string;referenceIds:string[];spec:Record<string,any>},create:(id:string,stage:string,parent?:string)=>Promise<any>){
  const run=async()=>{
    const context=generationSources(store,input.entityId);
    if(!input.referenceIds.length||input.referenceIds.some(id=>!context.sources.some(source=>source!.id===id)))throw new Error('Select at least one attached source image.');
    let character=context.entity;
    if(character.kind==='concept'){
      const previous=character.data.characterId&&store.get('character',String(character.data.characterId));
      if(previous)character=previous;
      else{
        if(character.data.productionStarted)throw new Error('The linked character is unavailable. Restore its record before continuing.');
        const template=input.spec.target==='Separate Parts'?'separate-parts':'head-body';
        const partInventory=template==='separate-parts'?String(input.spec.parts||'').split(/[,\n]/).map(name=>name.trim()).filter(Boolean).map(name=>({name,kind:'garment',sideViews:[]})):character.data.partInventory;
        character=store.put({id:character.id,kind:'concept',name:character.name,data:{...character.data,template,...partInventory?{partInventory}:{}},expectedRevision:character.revision});
        character=domain.createCharacterFromConcept(character.id).character;
      }
    }
    const spec:Record<string,any>={...input.spec,target:character.data.template==='separate-parts'?'Separate Parts':'Head + Body reference set'};
    if(context.entity.kind==='concept'){
      const concept=store.get('concept',context.entity.id)!;
      if(JSON.stringify(concept.data.promptSpec)!==JSON.stringify(spec)||JSON.stringify(concept.data.generationReferenceIds)!==JSON.stringify(input.referenceIds))store.put({id:concept.id,kind:'concept',name:concept.name,data:{...concept.data,promptSpec:spec,style:spec.style,generationReferenceIds:input.referenceIds},expectedRevision:concept.revision});
    }
    const state=domain.workflowFor(character.id),stage='references';
    const signature=JSON.stringify({locale:store.settings().locale,referenceIds:[...input.referenceIds].sort(),spec,workflowRevision:state.workflow.revision});
    const prior=store.list({kind:'stageRequest',q:character.id,limit:500}).find(request=>request.data.generationSignature===signature);
    if(prior){
      const {readImmutableStageRequest}=await import('./request-history');
      const saved=readImmutableStageRequest(store,prior.id);
      const path=await import('node:path');
      return {request:prior,markdown:saved.markdown,file:path.join(store.root,prior.data.requestFile),work:path.join(store.root,prior.data.workspace),character};
    }
    character=store.put({id:character.id,kind:'character',name:character.name,data:{...character.data,promptSpec:spec,style:spec.style,generationReferenceIds:input.referenceIds,generationSignature:signature},expectedRevision:character.revision});
    for(const id of input.referenceIds)store.link(character.id,id,'source artwork');
    const parent=store.list({kind:'stageRequest',q:character.id,limit:500}).find(request=>request.data.stage===stage);
    return {...await create(character.id,stage,parent?.id),character};
  };
  const result=tail.then(run,run);tail=result.catch(()=>undefined);return result;
}
