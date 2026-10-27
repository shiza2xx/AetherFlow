import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {isPathWithin} from './path-containment';

export type SkillClosureRecord={id:string;path:string;sha256:string;purpose?:string;scripts:string[];scriptHashes:Record<string,string>;closure:Record<string,string>};
const excluded=(name:string)=>name==='__pycache__'||name==='node_modules'||name==='.git'||name==='dist'||name==='build'||name.endsWith('.pyc')||name==='.DS_Store';
const hashFile=(file:string)=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const contained=(parent:string,child:string)=>isPathWithin(parent,child);

function packageFiles(source:string):string[]|null{
  const manifest=path.join(source,'PACKAGE.json');if(!fs.existsSync(manifest))return null;
  const stat=fs.lstatSync(manifest);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Skill PACKAGE.json must be a regular file.');
  let parsed:any;try{parsed=JSON.parse(fs.readFileSync(manifest,'utf8'));}catch{throw new Error('Skill PACKAGE.json is malformed.');}
  if(parsed?.schemaVersion!==1||!Array.isArray(parsed.include)||parsed.include.length<1||parsed.include.some((entry:any)=>typeof entry!=='string'||!entry.trim())||new Set(parsed.include).size!==parsed.include.length)throw new Error('Skill package include manifest is invalid.');
  const selected=new Set<string>(['PACKAGE.json']);
  for(const item of parsed.include){const normalized=item.replace(/\\/g,'/');if(normalized.startsWith('/')||/^[a-z]:/i.test(normalized)||normalized.split('/').some((part:string)=>!part||part==='.'||part==='..'))throw new Error('Skill package include path escaped its root.');const absolute=path.resolve(source,...normalized.split('/'));if(!contained(source,absolute)||!fs.existsSync(absolute))throw new Error(`Skill package entry is missing or unsafe: ${item}`);const root=fs.realpathSync.native(source),target=fs.realpathSync.native(absolute);if(!contained(root,target))throw new Error(`Skill package entry resolves outside its root: ${item}`);const entryStat=fs.lstatSync(absolute);if(entryStat.isSymbolicLink())throw new Error(`Skill package entry cannot be a symlink: ${item}`);if(entryStat.isDirectory()){const walk=(directory:string,relative:string)=>{for(const child of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(excluded(child.name))continue;const childRel=`${relative}/${child.name}`,childPath=path.join(directory,child.name),childStat=fs.lstatSync(childPath);if(childStat.isSymbolicLink())throw new Error('Skill package cannot include symbolic links.');if(childStat.isDirectory())walk(childPath,childRel);else if(childStat.isFile())selected.add(childRel);else throw new Error('Skill package contains a non-regular entry.');}};walk(absolute,normalized);}else if(entryStat.isFile())selected.add(normalized);else throw new Error(`Skill package entry is not a regular file or directory: ${item}`);}
  return [...selected].sort((a,b)=>a.localeCompare(b));
}

function copyWhitelistedSkill(source:string,target:string,files:string[]){
  fs.mkdirSync(target,{recursive:true});for(const logical of files){const input=path.resolve(source,...logical.split('/')),output=path.resolve(target,...logical.split('/'));if(!contained(source,input)||!contained(target,output))throw new Error('Skill package copy escaped its bounded roots.');const stat=fs.lstatSync(input);if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`Skill package file changed type before copy: ${logical}`);fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(input,output,fs.constants.COPYFILE_EXCL);}
}

/** Return the validated explicit package inventory without copying or hashing file contents. */
export function skillPackageFiles(appRoot:string,skill:{id:string;path:string}):string[]|null{
  const root=fs.realpathSync.native(appRoot),skillsRoot=fs.realpathSync.native(path.join(root,'docs','skills'));
  const source=fs.realpathSync.native(path.join(root,skill.path));
  if(!contained(skillsRoot,source))throw new Error('Active Skill escaped the app-owned skills directory.');
  return packageFiles(source);
}

/** Hash the exact packaged source closure that a new request will snapshot. */
export function skillPackageClosureFingerprint(appRoot:string,skill:{id:string;path:string}):string{
  const root=fs.realpathSync.native(appRoot),skillsRoot=fs.realpathSync.native(path.join(root,'docs','skills'));
  const source=fs.realpathSync.native(path.join(root,skill.path));
  if(!contained(skillsRoot,source))throw new Error('Active Skill escaped the app-owned skills directory.');
  const files=packageFiles(source);
  if(!files)throw new Error(`Skill ${skill.id} must declare an explicit package closure.`);
  const closure=Object.fromEntries(files.map(logical=>[logical,hashFile(path.resolve(source,...logical.split('/')))]));
  return crypto.createHash('sha256').update(JSON.stringify({id:skill.id,closure})).digest('hex');
}

export function skillPackagesClosureFingerprint(appRoot:string,skills:readonly {id:string;path:string}[]):string{
  const records=skills.map(skill=>{
    const root=fs.realpathSync.native(appRoot),skillsRoot=fs.realpathSync.native(path.join(root,'docs','skills'));
    const source=fs.realpathSync.native(path.join(root,skill.path));
    if(!contained(skillsRoot,source))throw new Error('Active Skill escaped the app-owned skills directory.');
    const files=packageFiles(source);
    if(!files)throw new Error(`Skill ${skill.id} must declare an explicit package closure.`);
    return {id:skill.id,closure:Object.fromEntries(files.map(logical=>[logical,hashFile(path.resolve(source,...logical.split('/')))]))};
  });
  records.sort((a,b)=>a.id.localeCompare(b.id));
  return crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function skillSnapshotClosureFingerprint(skills:readonly Pick<SkillClosureRecord,'id'|'closure'>[]):string{
  const ordered=[...skills].sort((a,b)=>a.id.localeCompare(b.id)).map(skill=>({id:skill.id,closure:Object.fromEntries(Object.entries(skill.closure).sort(([a],[b])=>a.localeCompare(b)))}));
  return crypto.createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

/** Stable digest for the complete persisted closure of one selected Skill. */
export function skillClosureDigest(skill:Pick<SkillClosureRecord,'id'|'closure'>):string{
  const closure=Object.fromEntries(Object.entries(skill.closure||{}).sort(([a],[b])=>a.localeCompare(b)));
  return crypto.createHash('sha256').update(JSON.stringify({id:skill.id,closure})).digest('hex');
}

/** Check a mutable workspace Skill cache for the package's required regular files. */
export function hasInstalledSkillPackage(work:string,skill:{id:string},files:readonly string[]):boolean{
  const root=path.resolve(work),skillsRoot=path.join(root,'.agents','skills'),target=path.join(skillsRoot,skill.id);
  if(!contained(skillsRoot,target)||!fs.existsSync(target)||fs.lstatSync(target).isSymbolicLink()||!fs.statSync(target).isDirectory()||fs.realpathSync.native(target)!==target)return false;
  for(const logical of files){
    const absolute=path.resolve(target,...logical.replace(/\\/g,'/').split('/'));
    if(!contained(target,absolute)||!fs.existsSync(absolute))return false;
    let cursor=target;
    for(const part of path.relative(target,absolute).split(path.sep)){
      cursor=path.join(cursor,part);const stat=fs.lstatSync(cursor);
      if(stat.isSymbolicLink())throw new Error('Installed Skill package contains a symbolic link.');
      if(cursor===absolute&&(!stat.isFile()||fs.realpathSync.native(cursor)!==cursor))return false;
      if(cursor!==absolute&&!stat.isDirectory())return false;
    }
  }
  return true;
}

export function snapshotSkillFiles(appRoot:string,skill:{id:string;path:string;purpose?:string},work:string):SkillClosureRecord{
  const root=fs.realpathSync.native(appRoot),skillsRoot=fs.realpathSync.native(path.join(root,'docs','skills'));
  const source=fs.realpathSync.native(path.join(root,skill.path));
  if(!contained(skillsRoot,source))throw new Error('Active Skill escaped the app-owned skills directory.');
  const relativeRoot=path.posix.join('.agents','skills',skill.id),target=path.join(work,...relativeRoot.split('/'));
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(fs.existsSync(target))throw new Error(`Request-owned Skill snapshot ${skill.id} already exists and is immutable.`);
  const whitelist=packageFiles(source);if(whitelist)copyWhitelistedSkill(source,target,whitelist);else fs.cpSync(source,target,{recursive:true,dereference:false,filter:candidate=>{
    const stat=fs.lstatSync(candidate);
    if(stat.isSymbolicLink())throw new Error('Skill packages cannot contain symbolic links.');
    return candidate===source||!excluded(path.basename(candidate));
  }});
  const closure:Record<string,string>={};
  const walk=(directory:string,relative='')=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(excluded(entry.name))continue;
      const absolute=path.join(directory,entry.name),logical=relative?`${relative}/${entry.name}`:entry.name,stat=fs.lstatSync(absolute);
      if(stat.isSymbolicLink())throw new Error('Request-owned Skill closure cannot contain symbolic links.');
      if(stat.isDirectory())walk(absolute,logical);
      else if(stat.isFile())closure[logical]=hashFile(absolute);
      else throw new Error('Request-owned Skill closure contains a non-regular path.');
    }
  };
  walk(target);
  if(!closure['SKILL.md'])throw new Error(`Skill ${skill.id} does not provide SKILL.md.`);
  const scripts=Object.keys(closure).filter(file=>file.startsWith('scripts/')&&!file.slice(8).includes('/')).map(file=>path.posix.join(relativeRoot,file));
  return {id:skill.id,path:path.posix.join(relativeRoot,'SKILL.md'),sha256:closure['SKILL.md'],purpose:skill.purpose,scripts,scriptHashes:Object.fromEntries(scripts.map(file=>[file,closure[file.slice(relativeRoot.length+1)]])),closure};
}

export function verifyRequestSkillClosure(work:string,skill:SkillClosureRecord){
  const skillRoot=path.resolve(work,'.agents','skills',String(skill.id)),skillsRoot=path.resolve(work,'.agents','skills');
  if(!contained(skillsRoot,skillRoot)||!fs.existsSync(skillRoot)||!fs.lstatSync(skillRoot).isDirectory()||fs.realpathSync.native(skillRoot)!==skillRoot)throw new Error(`Selected skill ${skill.id} has an unsafe or missing root.`);
  const actual:Record<string,string>={};
  const walk=(directory:string,relative='')=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(excluded(entry.name))continue;
      const file=path.join(directory,entry.name),logical=relative?`${relative}/${entry.name}`:entry.name,stat=fs.lstatSync(file);
      if(stat.isSymbolicLink())throw new Error(`Selected skill ${skill.id} contains a symlink in its closure.`);
      if(stat.isDirectory())walk(file,logical);
      else if(stat.isFile()){
        if(fs.realpathSync.native(file)!==file)throw new Error(`Selected skill ${skill.id} resolves outside its request snapshot.`);
        actual[logical]=hashFile(file);
      }else throw new Error(`Selected skill ${skill.id} contains a non-regular closure item.`);
    }
  };
  walk(skillRoot);
  const expected=skill.closure;
  if(JSON.stringify(Object.keys(actual).sort())!==JSON.stringify(Object.keys(expected).sort()))throw new Error(`Selected skill ${skill.id} closure file set changed; regenerate the request before launch.`);
  for(const [logical,digest] of Object.entries(expected))if(actual[logical]!==digest)throw new Error(`Selected skill closure ${skill.id}/${logical} is missing or changed; regenerate the request before launch.`);
  const entry=path.resolve(work,skill.path);
  if(skill.path!==path.posix.join('.agents','skills',skill.id,'SKILL.md')||!contained(skillRoot,entry)||actual['SKILL.md']!==skill.sha256)throw new Error(`Selected skill ${skill.id} entry point is missing or changed.`);
}
