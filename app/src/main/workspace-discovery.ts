import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export type DiscoveredWorkspace={directory:string;name:string;description:string;sourceProfile:string;ownership:'active'|'created'|'verified-restore'};
const MAX_CATALOG_BYTES=1024*1024,MAX_POINTER_BYTES=16*1024,MAX_IMPORTS=200;

/** Keep controlled profile overrides self-contained: legacy roots are read beside an explicit app profile, never from the workstation default. */
export function workspaceDiscoveryRoot(appData:string,explicitProfile?:string){
 if(!explicitProfile)return appData;
 if(!path.isAbsolute(explicitProfile))throw new Error('AETHERFLOW_USER_DATA must be an absolute path before legacy workspace discovery.');
 const explicit=path.resolve(explicitProfile),leaf=path.basename(explicit).toLocaleLowerCase('en-US');
 return leaf==='aetherflow'||leaf==='project-atelier'?path.dirname(explicit):explicit;
}

function safeJson(file:string,limit:number):any|null{try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>limit)return null;return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
function canonicalDirectory(value:unknown){if(typeof value!=='string'||!path.isAbsolute(value))return null;try{const stat=fs.lstatSync(value);if(!stat.isDirectory()||stat.isSymbolicLink())return null;const real=fs.realpathSync.native(value);return path.resolve(real)===path.resolve(value)?real:null;}catch{return null;}}
function validWorkspace(directory:string){
 const databases=['aetherflow.sqlite','atelier.sqlite'].map(name=>path.join(directory,name));
 for(const file of databases){try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100)return false;const db=new DatabaseSync(file,{readOnly:true});try{return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities'").get());}finally{db.close();}}catch{}}
 return false;
}

/** Read old profile catalogs and pointers only; never copy databases or credentials. */
export function discoverExistingWorkspaceReferences(appData:string):{workspaces:DiscoveredWorkspace[];warnings:string[]}{
 const workspaces:DiscoveredWorkspace[]=[],warnings:string[]=[],seen=new Set<string>();let inspected=0;
 for(const profileName of ['AetherFlow','project-atelier']){
  const profile=path.join(appData,profileName);try{const stat=fs.lstatSync(profile);if(!stat.isDirectory()||stat.isSymbolicLink())continue;}catch{continue;}
  const candidates:Array<{directory:unknown;name?:unknown;description?:unknown;ownership?:unknown}>=[];
  const catalog=safeJson(path.join(profile,'workspace-catalog-v1.json'),MAX_CATALOG_BYTES);
  if(catalog!==null){if(catalog.schemaVersion!==1||!Array.isArray(catalog.projects)||catalog.projects.length>MAX_IMPORTS)warnings.push(`Skipped malformed or oversized workspace catalog at ${profile}.`);else for(const item of catalog.projects)candidates.push({directory:item?.directory,name:item?.name,description:item?.description,ownership:item?.ownership});}
  const pointer=safeJson(path.join(profile,'active-workspace.json'),MAX_POINTER_BYTES);if(pointer&&typeof pointer.workspace==='string')candidates.push({directory:pointer.workspace,name:'Existing AetherFlow workspace',description:'Existing local workspace (referenced without moving its data).'});
  candidates.push({directory:path.join(profile,'workspace'),name:profileName==='project-atelier'?'Legacy Project Atelier workspace':'Existing AetherFlow workspace',description:'Existing local workspace (referenced without moving its data).'});
  for(const candidate of candidates){
   if(++inspected>MAX_IMPORTS){warnings.push('Workspace discovery stopped at its bounded catalog limit.');return {workspaces,warnings};}
   const directory=canonicalDirectory(candidate.directory);if(!directory)continue;const key=directory.toLocaleLowerCase('en-US');if(seen.has(key)||!validWorkspace(directory))continue;seen.add(key);
   const name=typeof candidate.name==='string'&&candidate.name.trim()?[...candidate.name.trim()].slice(0,120).join(''):path.basename(directory)||directory;
   const description=typeof candidate.description==='string'?candidate.description.slice(0,2000):'Existing workspace (referenced without moving its data).',ownership=candidate.ownership==='created'?'created':candidate.ownership==='verified-restore'?'verified-restore':'active';workspaces.push({directory,name,description,sourceProfile:profile,ownership});
  }
 }
 return {workspaces,warnings};
}
