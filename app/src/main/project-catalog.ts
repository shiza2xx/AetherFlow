import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type WorkspaceCard={id:string;name:string;description:string;directory:string;createdAt:string;lastOpenedAt:string|null;ownership:'active'|'created'|'verified-restore';sourceProfile?:string};
type Catalog={schemaVersion:1;projects:WorkspaceCard[];selectedId:string|null;knownOwned:Array<{directory:string;ownership:'active'|'created'|'verified-restore'}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nameValue=(value:unknown)=>typeof value==='string'&&value.trim().length>0&&[...value.trim()].length<=120;
const canonicalIfPresent=(directory:string)=>{try{return fs.realpathSync.native(directory);}catch{return path.resolve(directory);}};

function parseCatalog(value:unknown):Catalog {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('The workspace catalog is not a valid object. Keep the file and contact support before changing it.');
  const raw=value as any;
  if(raw.schemaVersion!==1||!Array.isArray(raw.projects)||raw.projects.length>500||raw.selectedId!==null&&typeof raw.selectedId!=='string'||raw.knownOwned!==undefined&&!Array.isArray(raw.knownOwned))throw new Error('The workspace catalog version is unknown or malformed. Keep the file and contact support before changing it.');
  const knownOwned:Array<{directory:string;ownership:'active'|'created'|'verified-restore'}>=[],knownPaths=new Set<string>();
  for(const item of raw.knownOwned||[]){if(!item||typeof item.directory!=='string'||!path.isAbsolute(item.directory)||!['active','created','verified-restore'].includes(item.ownership))throw new Error('The workspace catalog ownership registry is malformed. Keep the file and contact support before changing it.');const key=path.resolve(item.directory).toLocaleLowerCase('en-US');if(knownPaths.has(key))throw new Error('The workspace catalog ownership registry contains duplicate paths. Keep the file and contact support before changing it.');knownPaths.add(key);knownOwned.push({directory:item.directory,ownership:item.ownership});}
  const ids=new Set<string>(),paths=new Set<string>();
  const projects:WorkspaceCard[]=raw.projects.map((item:any)=>{
    if(!item||typeof item!=='object'||!uuid.test(item.id)||ids.has(item.id)||!nameValue(item.name)||typeof item.description!=='string'||item.description.length>2000||typeof item.directory!=='string'||!path.isAbsolute(item.directory)||item.sourceProfile!==undefined&&(typeof item.sourceProfile!=='string'||!path.isAbsolute(item.sourceProfile))||typeof item.createdAt!=='string'||!Number.isFinite(Date.parse(item.createdAt))||item.lastOpenedAt!==null&&(typeof item.lastOpenedAt!=='string'||!Number.isFinite(Date.parse(item.lastOpenedAt)))||!['active','created','verified-restore'].includes(item.ownership))throw new Error('The workspace catalog contains an invalid project entry. Keep the file and contact support before changing it.');
    ids.add(item.id);const canonical=path.resolve(item.directory).toLocaleLowerCase('en-US');if(paths.has(canonical))throw new Error('The workspace catalog contains duplicate workspace paths. Keep the file and contact support before changing it.');paths.add(canonical);
    return {id:item.id,name:item.name.trim(),description:item.description,directory:item.directory,createdAt:item.createdAt,lastOpenedAt:item.lastOpenedAt,ownership:item.ownership,...typeof item.sourceProfile==='string'?{sourceProfile:item.sourceProfile}:{}};
  });
  if(raw.selectedId&&!ids.has(raw.selectedId))throw new Error('The selected workspace is missing from the catalog. Keep the catalog and contact support before changing it.');
  for(const project of projects)if(!knownPaths.has(path.resolve(project.directory).toLocaleLowerCase('en-US'))){knownOwned.push({directory:project.directory,ownership:project.ownership});knownPaths.add(path.resolve(project.directory).toLocaleLowerCase('en-US'));}
  return {schemaVersion:1,projects,selectedId:raw.selectedId,knownOwned};
}

export class WorkspaceCatalog {
  readonly file:string;
  constructor(userData:string){this.file=path.join(userData,'workspace-catalog-v1.json');}
  read():Catalog {
    if(!fs.existsSync(this.file))return {schemaVersion:1,projects:[],selectedId:null,knownOwned:[]};
    const stat=fs.lstatSync(this.file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('The workspace catalog file path is unsafe. Keep the file and contact support.');
    try{return parseCatalog(JSON.parse(fs.readFileSync(this.file,'utf8')));}catch(error){if(error instanceof SyntaxError)throw new Error('The workspace catalog cannot be read. Keep the file and contact support before changing it.');throw error;}
  }
  write(value:Catalog){const next=parseCatalog(value);fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=`${this.file}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temp,JSON.stringify(next,null,2),{flag:'wx',mode:0o600});try{fs.renameSync(temp,this.file);}catch(error){try{fs.rmSync(temp,{force:true});}catch{}throw error;}}
  seed(directory:string,name='AetherFlow Studio'){
    const catalog=this.read(),canonical=fs.realpathSync.native(directory),known=catalog.projects.find(p=>canonicalIfPresent(p.directory)===canonical);
    if(known)return catalog;
    const now=new Date().toISOString(),entry:WorkspaceCard={id:crypto.randomUUID(),name,description:'Your existing AetherFlow workspace.',directory:canonical,createdAt:now,lastOpenedAt:now,ownership:'active'};catalog.projects.unshift(entry);catalog.selectedId=entry.id;this.write({...catalog,knownOwned:[...catalog.knownOwned.filter(row=>row.directory!==canonical),{directory:canonical,ownership:'active'}]});return this.read();
  }
  knownOwnership(directory:string){const canonical=fs.realpathSync.native(directory);const catalog=this.read();for(const row of catalog.knownOwned){try{if(fs.realpathSync.native(row.directory)===canonical)return row.ownership;}catch{}}return undefined;}
  wasRemovedFromList(directory:string){const canonical=fs.realpathSync.native(directory),catalog=this.read();if(catalog.projects.some(project=>canonicalIfPresent(project.directory)===canonical))return false;return catalog.knownOwned.some(row=>{try{return fs.realpathSync.native(row.directory)===canonical;}catch{return false;}});}
  add(input:{name:string;description?:string;directory:string;ownership?:'active'|'created'|'verified-restore';sourceProfile?:string}){
    const catalog=this.read(),canonical=fs.realpathSync.native(input.directory);if(!nameValue(input.name))throw new Error('Enter a workspace name with at most 120 characters.');
    if(catalog.projects.some(p=>canonicalIfPresent(p.directory)===canonical))throw new Error('This workspace folder is already in the project list.');
    const ownership=input.ownership||this.knownOwnership(canonical)||'verified-restore',now=new Date().toISOString(),entry:WorkspaceCard={id:crypto.randomUUID(),name:input.name.trim(),description:String(input.description||'').trim().slice(0,2000),directory:canonical,createdAt:now,lastOpenedAt:null,ownership,...input.sourceProfile?{sourceProfile:path.resolve(input.sourceProfile)}:{}};catalog.projects.push(entry);this.write({...catalog,selectedId:entry.id,knownOwned:[...catalog.knownOwned.filter(row=>path.resolve(row.directory).toLowerCase()!==path.resolve(canonical).toLowerCase()),{directory:canonical,ownership}]});return entry;
  }
  create(input:{name:string;description?:string;parent:string;theme:'dark'|'light';locale:'en'|'ru';create:(directory:string)=>void}){
    if(!nameValue(input.name))throw new Error('Enter a workspace name with at most 120 characters.');
    const parent=fs.realpathSync.native(input.parent),stat=fs.lstatSync(parent);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Choose a real existing folder for the new workspace.');
    const slug=input.name.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'workspace';
    let target=path.join(parent,slug),suffix=2;while(fs.existsSync(target))target=path.join(parent,`${slug}-${suffix++}`);
    input.create(target);
    try{return this.add({name:input.name,description:input.description,directory:target,ownership:'created'});}catch(error){throw new Error(`Workspace data was created at ${target}, but its project card could not be saved: ${error instanceof Error?error.message:String(error)}`);}
  }
  update(id:string,patch:{name?:string;description?:string}){const catalog=this.read(),index=catalog.projects.findIndex(p=>p.id===id);if(index<0)throw new Error('The selected workspace card no longer exists.');if(patch.name!==undefined){if(!nameValue(patch.name))throw new Error('Enter a workspace name with at most 120 characters.');catalog.projects[index]={...catalog.projects[index],name:patch.name.trim()};}if(patch.description!==undefined)catalog.projects[index]={...catalog.projects[index],description:patch.description.slice(0,2000)};this.write(catalog);return catalog.projects[index];}
  remove(id:string){const catalog=this.read(),entry=catalog.projects.find(p=>p.id===id);if(!entry)throw new Error('The selected workspace card no longer exists.');const projects=catalog.projects.filter(p=>p.id!==id);this.write({...catalog,projects,selectedId:catalog.selectedId===id?(projects[0]?.id||null):catalog.selectedId});return entry;}
  select(id:string){const catalog=this.read();if(!catalog.projects.some(p=>p.id===id))throw new Error('The selected workspace card no longer exists.');this.write({...catalog,selectedId:id});}
  markOpened(id:string){const catalog=this.read(),index=catalog.projects.findIndex(p=>p.id===id);if(index<0)throw new Error('The selected workspace card no longer exists.');catalog.projects[index]={...catalog.projects[index],lastOpenedAt:new Date().toISOString()};this.write({...catalog,selectedId:id});}
}

export const workspaceCatalogInternals={parseCatalog};
