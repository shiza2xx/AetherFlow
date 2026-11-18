import crypto from 'node:crypto';
import fs from 'node:fs';
import type {AtelierStore} from './store';
import type {Entity} from '../shared/contracts';
import {ReferencePlanStateSchema,type ReferencePlanOwnerKind} from '../shared/reference-plan';
import {ownerForArtifact} from './workspace-layout';

export type ReferencePlanSnapshot={owner:Entity;workflow?:Entity;sourceArtifacts:Entity[];sourceHash:string;lineageHash:string;lineage:Record<string,unknown>;sourcePaths:string[]};
const sha=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
function hashFileSync(file:string){const digest=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024);try{let bytes=0,read=0;while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0){digest.update(buffer.subarray(0,read));bytes+=read;}return {hash:digest.digest('hex'),bytes};}finally{fs.closeSync(fd);}}

export function referencePlanState(owner:Entity){return ReferencePlanStateSchema.parse(owner.data.referencePlan||{});}

export function referencePlanSnapshot(store:AtelierStore,kind:ReferencePlanOwnerKind,id:string):ReferencePlanSnapshot{
 const owner=store.get(kind==='character'?'character':'assetJob',id);if(!owner||owner.data.deletedAt)throw Object.assign(new Error('Reference plan owner was not found or is in Deleted.'),{code:'NOT_FOUND'});
 let workflow:Entity|undefined,sourceIds:string[],brief:any,concept:any=null;
 if(kind==='assetJob'){
  workflow=store.get('workflow',String(owner.data.workflowId||''))||undefined;sourceIds=owner.data.sourceArtifactId?[String(owner.data.sourceArtifactId)]:[];
  const source=sourceIds[0]?store.get('artifact',sourceIds[0]):null;const conceptId=source?.data.sourceConceptId||source?.data.sourceReferenceId&&store.get('concept',String(source.data.sourceReferenceId))?.id;
  concept=conceptId?store.get('concept',String(conceptId)):null;
  brief={target:owner.data.target,inclusions:owner.data.inclusions||[],exclusions:owner.data.exclusions||[],dimensions:owner.data.dimensions||'',crop:owner.data.sourceCrop||null,mode:owner.data.mode,projectId:owner.data.projectId||null};
 }else{
  workflow=store.workflowForCharacter(id)||undefined;const guided=workflow?.data.guided as any;
  sourceIds=Array.from(new Set<string>((Array.isArray(guided?.sourceArtifactIds)?guided.sourceArtifactIds:[]).map((value:unknown)=>String(value))));
  const sourceReference=store.links(id).find((link:any)=>link.role==='source reference');const conceptId=sourceReference?(sourceReference.from_id===id?sourceReference.to_id:sourceReference.from_id):null;
  concept=conceptId?store.get('concept',String(conceptId)):null;
  brief={name:owner.name,description:String(owner.data.description||''),headHairMode:owner.data.headHairMode||'reference-faithful',conceptId:concept?.id||null,conceptRevision:concept?.revision||null,conceptName:concept?.name||null,conceptDescription:concept?.data.description||null};
 }
 const sourceArtifacts=sourceIds.map(sourceId=>store.get('artifact',sourceId)).filter((item):item is Entity=>!!item),sourceFiles=new Map<string,{path:string;verified:boolean}>();
 if(sourceArtifacts.length!==sourceIds.length)throw Object.assign(new Error('One or more registered source artworks are missing. Refresh or restore them before preparing a reference plan.'),{code:'REFERENCE_SOURCE_MISSING'});
 const sourceManifest=sourceIds.map(sourceId=>{const item=store.get('artifact',sourceId)!;const file=store.object(String(item.data.hash||''));let verified=false,bytes:number|null=null,real='';if(file&&fs.existsSync(file)){try{const stat=fs.lstatSync(file);real=fs.realpathSync.native(file);if(stat.isFile()&&!stat.isSymbolicLink()&&real===file){const result=hashFileSync(real);bytes=result.bytes;verified=result.hash===item.data.hash;}}catch{verified=false;}}sourceFiles.set(item.id,{path:real,verified});return {id:item.id,revision:item.revision,hash:String(item.data.hash||''),bytes,mime:item.data.mime||null,verified};});
 if(kind==='assetJob'&&sourceArtifacts[0]){
  const source=sourceArtifacts[0],conceptId=String(source.data.sourceConceptId||'');if(conceptId)concept=store.get('concept',conceptId);
 }
 const lineage:Record<string,unknown>={ownerKind:kind,ownerId:owner.id,ownerName:owner.name,ownerBrief:brief,sourceManifest,concept:concept?{id:concept.id,revision:concept.revision,name:concept.name,description:concept.data.description||''}:null};
 const lineageHash=sha(JSON.stringify(lineage)),sourceHash=sha(JSON.stringify(sourceManifest.map((row:any)=>({id:row.id,hash:row.hash,verified:row.verified}))));
 const conceptSourceIds=new Set([...(Array.isArray(concept?.data.referenceArtifactIds)?concept.data.referenceArtifactIds:[]),concept?.data.referenceArtifactId]);
 const artworkLinks=(ownerId:string)=>new Set((store.links(ownerId) as {role:string;from_id:string;to_id:string}[]).filter(link=>link.role==='source artwork'&&link.from_id===ownerId).map(link=>link.to_id));
 const galleryArtLinks=kind==='character'&&concept?artworkLinks(concept.id):new Set<string>();
 const characterArtLinks=kind==='character'?artworkLinks(id):new Set<string>();
 const sourcePaths=sourceArtifacts.map(source=>{if(String(source.data.mime||'').split('/')[0]!=='image')throw new Error('Reference analysis requires an image source artifact.');const ownerOfSource=ownerForArtifact(store,source);const sharedGalleryArt=conceptSourceIds.has(source.id)&&galleryArtLinks.has(source.id)&&characterArtLinks.has(source.id);if(!sharedGalleryArt&&(ownerOfSource?.kind!==kind||ownerOfSource.id!==id))throw new Error('Reference image is not registered to this exact owner.');const verified=sourceFiles.get(source.id);if(!verified?.path)throw new Error(`Managed source image is missing: ${source.name}`);if(!verified.verified)throw new Error(`Managed source image failed integrity verification: ${source.name}`);return verified.path;});
 return {owner,workflow,sourceArtifacts,sourceHash,lineageHash,lineage,sourcePaths};
}

export function activeReferencePlan(store:AtelierStore,kind:ReferencePlanOwnerKind,id:string,knownSnapshot?:ReferencePlanSnapshot){
 const owner=store.get(kind==='character'?'character':'assetJob',id);if(!owner||owner.data.deletedAt)return null;const state=referencePlanState(owner);if(!state.enabled||!state.currentArtifactId||!state.currentLineageHash)return null;
 let snapshot:ReferencePlanSnapshot;try{snapshot=knownSnapshot||referencePlanSnapshot(store,kind,id);}catch{return null;}
 if(state.currentLineageHash!==snapshot.lineageHash)return null;
 const artifact=store.get('artifact',state.currentArtifactId);if(!artifact||artifact.data.parentId!==snapshot.owner.id||artifact.data.mime!=='text/markdown'||artifact.data.sourceInputHash!==snapshot.lineageHash)return null;
 const file=store.object(String(artifact.data.hash||''));if(!file||!fs.existsSync(file))return null;const bytes=fs.readFileSync(file);if(sha(bytes)!==artifact.data.hash)return null;
 return {artifactId:artifact.id,hash:String(artifact.data.hash),lineageHash:snapshot.lineageHash,markdown:bytes.toString('utf8')};
}

export function storedReferencePlan(store:AtelierStore,kind:ReferencePlanOwnerKind,id:string,knownSnapshot?:ReferencePlanSnapshot){
 const snapshot=knownSnapshot||referencePlanSnapshot(store,kind,id),state=referencePlanState(snapshot.owner),artifact=state.currentArtifactId?store.get('artifact',state.currentArtifactId):null;
 let markdown='';if(artifact?.data.parentId===snapshot.owner.id&&artifact.data.mime==='text/markdown'){
  const file=store.object(String(artifact.data.hash||''));if(file&&fs.existsSync(file)){const bytes=fs.readFileSync(file);if(sha(bytes)===artifact.data.hash)markdown=bytes.toString('utf8');}
 }
 const isCurrent=!!artifact&&artifact.data.sourceInputHash===snapshot.lineageHash&&state.currentLineageHash===snapshot.lineageHash;
 const planActive=!!state.enabled&&isCurrent;
 return {ownerId:id,ownerKind:kind,enabled:state.enabled,currentArtifactId:artifact?.id||null,currentHash:artifact?.data.hash||null,lineageHash:snapshot.lineageHash,sourceHash:snapshot.sourceHash,isCurrent,active:planActive,markdown,run:state.run||null,history:state.history||[]};
}
