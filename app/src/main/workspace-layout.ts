import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {AtelierStore} from './store';
import type {Entity} from '../shared/contracts';
import {isPathWithin} from './path-containment';

export const STORAGE_LAYOUT_VERSION=1;
export type StorageOwner={kind:'character'|'project';id:string;name:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeStorageName(value:string,fallback='file'){
 let normalized=String(value||'').normalize('NFKC').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').replace(/[. ]+$/g,'').replace(/\s+/g,'-').replace(/-+/g,'-').slice(0,96).replace(/[. ]+$/g,'');
 if(!normalized||normalized==='.'||normalized==='..'||/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?$/i.test(normalized))normalized=`_${normalized||fallback}`;
 return normalized;
}
function assertWindowsComponent(value:string){const deviceBase=value.split('.')[0].replace(/[. ]+$/g,'');if(!value||value==='.'||value==='..'||/[<>:"|?*\u0000-\u001f]/.test(value)||/[. ]$/.test(value)||/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(deviceBase))throw new Error('Storage path contains an unsafe Windows component.');}
export function workspaceLayout(root:string){
 const workspace=fs.realpathSync.native(path.resolve(root));
 const assertSafe=(target:string)=>{
  if(!isPathWithin(workspace,target))throw new Error('Storage path escapes this workspace.');
  const relative=path.relative(workspace,target);let probe=workspace;
  for(const component of relative?relative.split(path.sep):[]){assertWindowsComponent(component);probe=path.join(probe,component);if(!fs.existsSync(probe))break;const stat=fs.lstatSync(probe);if(stat.isSymbolicLink()||fs.realpathSync.native(probe)!==probe)throw new Error('Storage path escapes through a symlink or junction.');}
  return target;
 };
 const ownerRoot=(owner:StorageOwner)=>{
  if(!uuid.test(owner.id))throw new Error('Storage owner id is invalid.');
  return assertSafe(path.join(workspace,'work',owner.kind==='character'?'characters':'projects',owner.id));
 };
 const character=(id:string,name='Character')=>ownerRoot({kind:'character',id,name});
 const project=(id:string,name='Project')=>ownerRoot({kind:'project',id,name});
 const internal=(owner:StorageOwner)=>assertSafe(path.join(ownerRoot(owner),'.aetherflow'));
 const run=(owner:StorageOwner,operationId:string)=>{
  if(!uuid.test(operationId))throw new Error('Storage operation id is invalid.');
  return assertSafe(path.join(internal(owner),'runs',operationId));
 };
 const triageRun=(operationId:string)=>{if(!uuid.test(operationId))throw new Error('Storage operation id is invalid.');return assertSafe(path.join(workspace,'.aetherflow','triage','runs',operationId));};
 const category=(owner:StorageOwner,area:'references'|'depth'|'models'|'textures'|'stages'|'exports'|'history')=>assertSafe(path.join(ownerRoot(owner),area));
 const stage=(owner:StorageOwner,name:string)=>assertSafe(path.join(category(owner,'stages'),safeStorageName(name,'stage')));
 const resolve=(relative:string)=>{
  const clean=String(relative);
  if(clean.includes('\\'))throw new Error('Storage path must be a normalized workspace-relative path.');
  if(!clean||path.posix.isAbsolute(clean)||/^[A-Za-z]:/.test(clean)||clean.split('/').some(part=>part===''||part==='.'||part==='..'))throw new Error('Storage path must be a normalized workspace-relative path.');
  for(const component of clean.split('/'))assertWindowsComponent(component);
  const result=path.resolve(workspace,...clean.split('/'));
  if(!isPathWithin(workspace,result))throw new Error('Storage path escapes this workspace.');
  return assertSafe(result);
 };
 return {version:STORAGE_LAYOUT_VERSION,workspace,ownerRoot,character,project,internal,run,triageRun,category,stage,resolve};
}

export function productionOutputDirectory(root:string,characterId:string,stageName:string){
 const layout=workspaceLayout(root),owner:StorageOwner={kind:'character',id:characterId,name:'Character'},key=stageName.toLowerCase(),checked=(target:string)=>layout.resolve(path.relative(layout.workspace,target).replace(/\\/g,'/'));
 if(/texture|material|pbr/.test(key))return checked(path.join(layout.category(owner,'textures'),safeStorageName(stageName,'textures')));
 if(/depth/.test(key))return checked(path.join(layout.category(owner,'depth'),safeStorageName(stageName,'depth')));
 if(/reference|concept|view/.test(key))return checked(path.join(layout.category(owner,'references'),safeStorageName(stageName,'references')));
 if(/mesh|model|segment|assembly|rig|weight|export/.test(key))return checked(path.join(layout.category(owner,'models'),safeStorageName(stageName,'models')));
 return layout.stage(owner,stageName);
}
export function ownerForArtifact(store:AtelierStore,artifact:Entity):StorageOwner|null{
 const owners=new Map<string,StorageOwner>(),visited=new Set<string>(),pending=[artifact.id];let ambiguous=false;
 const addOwner=(kind:'character'|'project',id:unknown)=>{if(typeof id!=='string')return;const entity=store.get(kind,id);if(!entity){ambiguous=true;return;}owners.set(`${kind}:${id}`,{kind,id,name:entity.name});};
 const lineageKeys=['parentId','parentArtifactId','sourceParentId','sourceVersionId','versionOf','derivedFrom','derivedFromArtifactId','sourceArtifactId','originalArtifactId','previousVersionId'];
 while(pending.length){const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);const item=store.get('artifact',id);if(!item){ambiguous=true;continue;}
  if(item.data.characterId!==undefined)addOwner('character',item.data.characterId);if(item.data.projectId!==undefined)addOwner('project',item.data.projectId);
  for(const key of lineageKeys){const value=item.data[key];if(typeof value==='string'&&store.get('artifact',value))pending.push(value);}
  const provenance=item.data.provenance;if(provenance&&typeof provenance==='object'&&!Array.isArray(provenance)){for(const key of ['artifactId','sourceArtifactId','sourceVersionId','parentArtifactId']){const value=(provenance as any)[key];if(typeof value==='string'&&store.get('artifact',value))pending.push(value);}}
  for(const link of store.links(id)){const other=store.getAny(link.from_id===id?link.to_id:link.from_id);if(other?.kind==='character')addOwner('character',other.id);else if(other?.kind==='project')addOwner('project',other.id);else if(other?.kind==='artifact')pending.push(other.id);}
 }
 if(ambiguous||owners.size!==1)return null;return [...owners.values()][0];
}

export function operationWorkspace(store:AtelierStore,operationId:string,artifactIds:string[]=[]){
 const layout=workspaceLayout(store.root),owners=new Map<string,StorageOwner>();
 for(const link of store.links(operationId)){const related=store.getAny(link.from_id===operationId?link.to_id:link.from_id);if(related?.kind==='artifact'){const owner=ownerForArtifact(store,related);if(owner)owners.set(`${owner.kind}:${owner.id}`,owner);}}
 for(const id of artifactIds){const artifact=store.get('artifact',id);if(!artifact)continue;const owner=ownerForArtifact(store,artifact);if(owner)owners.set(`${owner.kind}:${owner.id}`,owner);}
 const operation=store.get('operation',operationId),ownerId=String(operation?.data.characterId||operation?.data.projectId||'');
 const operationAssetId=String(operation?.data.assetId||'');if(operationAssetId){const artifact=store.get('artifact',operationAssetId),owner=artifact&&ownerForArtifact(store,artifact);if(owner)owners.set(`${owner.kind}:${owner.id}`,owner);}
 if(ownerId){const character=store.get('character',ownerId),project=store.get('project',ownerId),entity=character||project;if(entity)owners.set(`${entity.kind}:${entity.id}`,{kind:entity.kind as 'character'|'project',id:entity.id,name:entity.name});}
 if(owners.size===1)return layout.run([...owners.values()][0],operationId);
 return layout.triageRun(operationId);
}

export function readableAssetName(name:string,id:string,version?:number){
 const rawExt=path.extname(String(name||'')),ext=/^\.[A-Za-z0-9]{1,12}$/.test(rawExt)?rawExt.toLowerCase():'',suffix=id.replace(/[^a-f0-9]/gi,'').slice(0,8)||crypto.randomUUID().slice(0,8),tail=`${version?`-v${version}`:''}-${suffix}${ext}`,stem=safeStorageName(path.basename(String(name||'asset'),rawExt),'asset'),maxStem=Math.max(1,96-tail.length),boundedStem=stem.slice(0,maxStem).replace(/[. ]+$/g,'')||'asset';
 return `${boundedStem}${tail}`;
}

async function streamHash(file:string,signal?:AbortSignal){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file)){if(signal?.aborted)throw new Error('Storage audit was cancelled.');hash.update(chunk as Buffer);}return hash.digest('hex');}
export async function auditWorkspaceLayout(root:string,owner?:StorageOwner,options:{maxEntries?:number;signal?:AbortSignal}={}){
 const canonical=fs.realpathSync.native(root),layout=workspaceLayout(canonical),work=owner?layout.ownerRoot(owner):path.join(canonical,'work'),maxEntries=options.maxEntries??10000;if(!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>100000)throw new Error('Storage audit entry limit must be between 1 and 100000.');
 const rows:Array<{path:string;kind:'directory'|'file'|'symlink';bytes:number;sha256?:string}>=[],counts={directories:0,files:0,symlinks:0,bytes:0};let truncated=false;
 if(!fs.existsSync(work))return {workspace:canonical,owner:owner?{kind:owner.kind,id:owner.id}:null,layoutVersion:STORAGE_LAYOUT_VERSION,entries:rows,counts,truncated:false,entryLimit:maxEntries};
 if(!owner)layout.resolve('work');else layout.resolve(path.relative(canonical,work).replace(/\\/g,'/'));
 const visit=async(directory:string)=>{if(options.signal?.aborted)throw new Error('Storage audit was cancelled.');for(const entry of await fs.promises.readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name),relative=path.relative(canonical,file).replace(/\\/g,'/'),stat=await fs.promises.lstat(file);let row:{path:string;kind:'directory'|'file'|'symlink';bytes:number;sha256?:string}|undefined;
  if(stat.isSymbolicLink()){counts.symlinks++;row={path:relative,kind:'symlink',bytes:0};}
  else if(stat.isDirectory()){counts.directories++;row={path:relative,kind:'directory',bytes:0};if(rows.length<maxEntries)rows.push(row);else truncated=true;await visit(file);continue;}
  else if(stat.isFile()){counts.files++;counts.bytes+=stat.size;row={path:relative,kind:'file',bytes:stat.size,sha256:await streamHash(file,options.signal)};}
  else continue;
  if(rows.length<maxEntries)rows.push(row);else truncated=true;
 }};
 await visit(work);return {workspace:canonical,owner:owner?{kind:owner.kind,id:owner.id}:null,layoutVersion:STORAGE_LAYOUT_VERSION,entries:rows.sort((a,b)=>a.path.localeCompare(b.path)),counts,truncated,entryLimit:maxEntries};
}
