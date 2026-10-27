export type CharacterSummaryPreview={identity:string;sourceId?:string;url?:string;previewState?:'loading'|'ready'|'missing'|'error';sourceRefIds?:string[];[key:string]:unknown};

export function characterSummaryIdentity(workspace:string,characterId:string){return `${workspace}|${characterId}`;}

export function normalizeCharacterSummaryBlockers(value:unknown):unknown[]{return Array.isArray(value)?value:[];}

export function retainCharacterSummaryPreview(current:CharacterSummaryPreview,identity:string):CharacterSummaryPreview{
  return current.identity===identity?current:{identity};
}

export function resolveCharacterSummarySource<T extends CharacterSummaryPreview>(current:T,identity:string,sourceId:string|null):T|CharacterSummaryPreview{
  const scoped=retainCharacterSummaryPreview(current,identity);
  if(!sourceId)return {...scoped,identity,sourceId:undefined,url:undefined,previewState:'missing'};
  return scoped.sourceId===sourceId?{...scoped,previewState:scoped.url?'ready':'loading'}:{...scoped,identity,sourceId,url:undefined,previewState:'loading'};
}

export function resolveCharacterSummaryThumbnail<T extends CharacterSummaryPreview>(current:T,identity:string,sourceId:string,url:string):T|CharacterSummaryPreview{
  if(current.identity!==identity||current.sourceId!==sourceId)return current;
  return {...current,identity,sourceId,url,previewState:'ready'};
}

export function characterSummarySourceResult<T extends CharacterSummaryPreview>(current:T,identity:string,sourceId:string|null,sourceRefIds:string[]):T|CharacterSummaryPreview{
  const scoped=retainCharacterSummaryPreview(current,identity) as T|CharacterSummaryPreview;
  if(!sourceId)return {...scoped,identity,sourceId:undefined,url:undefined,previewState:'missing',sourceRefIds};
  if(scoped.sourceId===sourceId)return {...scoped,identity,sourceId,previewState:scoped.url?'ready':'loading',sourceRefIds};
  return {...scoped,identity,sourceId,url:undefined,previewState:'loading',sourceRefIds};
}

export function characterSummarySourceError<T extends CharacterSummaryPreview>(current:T,identity:string):T|CharacterSummaryPreview{
  if(current.identity!==identity)return current;
  return {...current,previewState:current.url?'ready':'error'};
}

export function characterSummarySourcePending<T extends CharacterSummaryPreview>(current:T,identity:string):T|CharacterSummaryPreview{
  if(current.identity!==identity)return current;
  return {...current,previewState:current.url?'ready':'loading'};
}

export function domainEventAffectsCharacterSource(event:any,workspace:string,characterId:string,sourceRefIds:string[],sourceResolutionPending=false):boolean{
  if(typeof event?.workspace!=='string'||event.workspace.toLowerCase().replace(/[\\/]+$/,'')!==workspace.toLowerCase().replace(/[\\/]+$/,''))return false;
  if(sourceResolutionPending)return true;
  const ids=new Set((event.entities||[]).map((entity:any)=>entity?.id).filter(Boolean));
  return ids.has(characterId)||sourceRefIds.some(id=>ids.has(id));
}
