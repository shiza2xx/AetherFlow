import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {CodexRuntime} from './codex-launch';

const exec=promisify(execFile),skillName='aetherflow-unity-reporting';
const files=['SKILL.md','references/report-manifest.md','references/windows-video.md','references/windows-gif.md','scripts/run-helper.ps1','scripts/report.mjs','scripts/video.mjs','scripts/gif.mjs'];
const digest=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
export type CodexIntegrationOptions={resourceRoot:string;userData:string;port:number;executable:string;version:string;runtime:CodexRuntime;codexHome?:string;run?:(args:string[],home:string)=>Promise<string>};
function homeFor(options:CodexIntegrationOptions){
  const home=path.resolve(options.codexHome||process.env.CODEX_HOME?.trim()||path.join(os.homedir(),'.codex'));
  return fs.existsSync(home)?fs.realpathSync.native(home):home;
}
function regular(file:string,directory=false){if(!fs.existsSync(file)&&!fs.lstatSync(path.dirname(file),{throwIfNoEntry:false}))return;const stat=fs.lstatSync(file,{throwIfNoEntry:false});if(stat&&(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())))throw new Error('Codex setup found a linked or non-regular destination. No existing files were replaced.');}
function treeRegular(root:string){regular(root,true);if(!fs.existsSync(root))return;for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isSymbolicLink())throw new Error('The existing Unity Skill contains a link. Move it aside before installing.');if(entry.isDirectory())treeRegular(file);else regular(file);}}
function bundle(options:CodexIntegrationOptions){const direct=path.join(options.resourceRoot,'codex-integration');const root=fs.existsSync(direct)?direct:path.join(options.resourceRoot,'build','codex-integration');for(const name of files){const file=path.join(root,name);regular(file);if(!fs.existsSync(file))throw new Error('The Unity Skill package is missing. Rebuild or reinstall AetherFlow.');}return root;}
function expected(options:CodexIntegrationOptions){return {command:options.executable,args:[path.join(options.resourceRoot,'scripts','mcp-stdio.mjs')],env:{ELECTRON_RUN_AS_NODE:'1',AETHERFLOW_USER_DATA:options.userData,AETHERFLOW_MCP_PORT:String(options.port),AETHERFLOW_SETUP_MANAGED:'1'}};}
async function cli(options:CodexIntegrationOptions,args:string[],home:string){
  if(options.runtime.available!==true)throw new Error('Codex CLI was not found. Install Codex CLI or select its executable in Settings, then retry.');
  if(options.run)return options.run(args,home);
  try{return (await exec(options.runtime.command,[...options.runtime.prefixArgs,...args],{env:{...process.env,CODEX_HOME:home},windowsHide:true,timeout:20000,maxBuffer:1024*1024})).stdout;}
  catch{throw new Error('Codex could not update or read its MCP configuration. Check that Codex CLI is installed and config.toml is valid and writable. Existing backups are retained.');}
}
function sameServer(value:any,wanted:ReturnType<typeof expected>){const transport=value?.transport;return value?.enabled===true&&transport?.type==='stdio'&&transport.command===wanted.command&&JSON.stringify(transport.args)===JSON.stringify(wanted.args)&&Object.entries(wanted.env).every(([key,value])=>transport.env?.[key]===value)&&!value.disabled_tools?.length&&value.enabled_tools==null;}
function rendered(options:CodexIntegrationOptions,home:string){const root=bundle(options),result:Record<string,Buffer>={};for(const name of files){let bytes=fs.readFileSync(path.join(root,name));if(name.endsWith('.md'))bytes=Buffer.from(bytes.toString('utf8').replaceAll('{{HELPER}}',path.join(home,'skills',skillName,'scripts','run-helper.ps1').replaceAll("'","''")));result[name]=bytes;}result['installation.json']=Buffer.from(JSON.stringify({schemaVersion:1,version:options.version,executable:options.executable,userData:options.userData,port:options.port,ffmpeg:path.join(options.resourceRoot,'tools','ffmpeg','ffmpeg.exe'),ffprobe:path.join(options.resourceRoot,'tools','ffmpeg','ffprobe.exe')},null,2)+'\n');return result;}
function skillMatches(target:string,content:Record<string,Buffer>){try{treeRegular(target);return Object.entries(content).every(([name,value])=>fs.readFileSync(path.join(target,name)).equals(value));}catch{return false;}}
export async function codexIntegrationStatus(options:CodexIntegrationOptions){
  const home=homeFor(options),config=path.join(home,'config.toml'),skill=path.join(home,'skills',skillName);
  const mediaAvailable=['ffmpeg.exe','ffprobe.exe'].every(name=>fs.existsSync(path.join(options.resourceRoot,'tools','ffmpeg',name)));
  const base={mediaAvailable,codexHome:home,configPath:config,skillPath:skill,cliAvailable:options.runtime.available===true,ready:false,installed:fs.existsSync(path.join(skill,'installation.json'))};
  if(!mediaAvailable)return {...base,reason:'media-missing'};
  if(!base.cliAvailable)return {...base,reason:'cli-missing'};
  if(!fs.existsSync(config))return {...base,reason:'not-configured'};
  try{regular(config);regular(path.join(home,'skills'),true);const server=JSON.parse(await cli(options,['mcp','get','aetherflow','--json'],home));return {...base,ready:sameServer(server,expected(options))&&skillMatches(skill,rendered(options,home)),reason:'check-complete'};}
  catch{return {...base,reason:'needs-setup'};}
}
function currentHash(file:string){return fs.existsSync(file)?digest(fs.readFileSync(file)):null;}
function acquire(lock:string){
  const previous=fs.lstatSync(lock,{throwIfNoEntry:false});
  if(previous){regular(lock);let dead=false;try{const pid=JSON.parse(fs.readFileSync(lock,'utf8')).pid;if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(error){dead=(error as NodeJS.ErrnoException).code==='ESRCH';}}}catch{}if(!dead)throw new Error('Codex setup is already running. Wait for it to finish and retry.');fs.unlinkSync(lock);}
  const handle=fs.openSync(lock,'wx',0o600);fs.writeFileSync(handle,JSON.stringify({pid:process.pid}));fs.closeSync(handle);
}
export async function installCodexIntegration(options:CodexIntegrationOptions){
  if(options.runtime.available!==true)throw new Error('Install Codex CLI or select its executable in Settings, then retry.');
  if(!['ffmpeg.exe','ffprobe.exe'].every(name=>fs.existsSync(path.join(options.resourceRoot,'tools','ffmpeg',name))))throw new Error('Bundled FFmpeg/ffprobe are missing. Reinstall AetherFlow or prepare the source media tools before retrying.');
  const home=homeFor(options),content=rendered(options,home),wanted=expected(options),config=path.join(home,'config.toml'),skills=path.join(home,'skills'),target=path.join(skills,skillName);
  fs.mkdirSync(home,{recursive:true});regular(config);regular(skills,true);fs.mkdirSync(skills,{recursive:true});treeRegular(target);
  const lock=path.join(home,'.aetherflow-setup.lock');acquire(lock);
  let stage:string|undefined,backup:string|undefined,newSkill=false,movedSkill=false,writtenHash:string|null|undefined;
  const original=fs.existsSync(config)?fs.readFileSync(config):null,originalHash=original?digest(original):null;
  try{
    const state=await codexIntegrationStatus(options);if(state.ready)return {...state,changed:false,backupPath:null};
    regular(path.join(home,'backups'),true);fs.mkdirSync(path.join(home,'backups'),{recursive:true});regular(path.join(home,'backups','aetherflow-integration'),true);fs.mkdirSync(path.join(home,'backups','aetherflow-integration'),{recursive:true});
    backup=fs.mkdtempSync(path.join(home,'backups','aetherflow-integration','setup-'));
    if(original)fs.writeFileSync(path.join(backup,'config.toml'),original,{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(backup,'recovery.json'),JSON.stringify({hadConfig:original!==null,skillPath:target,createdAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
    stage=fs.mkdtempSync(path.join(skills,'.aetherflow-setup-'));
    for(const [name,bytes]of Object.entries(content)){const file=path.join(stage,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
    if(currentHash(config)!==originalHash)throw new Error('Codex configuration changed during setup. Retry after the other change finishes.');
    await cli(options,['mcp','add','aetherflow',...Object.entries(wanted.env).flatMap(([key,value])=>['--env',`${key}=${value}`]),'--',wanted.command,...wanted.args],home);
    writtenHash=currentHash(config);
    if(!sameServer(JSON.parse(await cli(options,['mcp','get','aetherflow','--json'],home)),wanted))throw new Error('Codex did not save the requested AetherFlow MCP configuration.');
    if(fs.existsSync(target)){treeRegular(target);fs.renameSync(target,path.join(backup,skillName));movedSkill=true;}
    fs.renameSync(stage,target);stage=undefined;newSkill=true;
    const verified=await codexIntegrationStatus(options);if(!verified.ready)throw new Error('Codex integration verification failed.');
    return {...verified,changed:true,backupPath:backup};
  }catch(error){
    if(newSkill){treeRegular(target);fs.renameSync(target,path.join(backup!,'unaccepted-skill'));}
    if(movedSkill)fs.renameSync(path.join(backup!,skillName),target);
    if(writtenHash!==undefined){regular(config);if(currentHash(config)===writtenHash){if(original){const restore=path.join(home,`.aetherflow-config-${crypto.randomUUID()}.tmp`);fs.writeFileSync(restore,original,{flag:'wx',mode:0o600});fs.renameSync(restore,config);}else if(fs.existsSync(config))fs.unlinkSync(config);}else throw new Error(`Codex configuration changed outside setup; it was preserved. Original configuration backup: ${backup}`);}
    throw error;
  }finally{
    // Remove only this operation's newly created staging folder, after checking its tree.
    if(stage){treeRegular(stage);const resolved=path.resolve(stage);if(path.dirname(resolved)!==skills||!path.basename(resolved).startsWith('.aetherflow-setup-'))throw new Error('Invalid setup staging path.');fs.rmSync(resolved,{recursive:true});}
    regular(lock);fs.unlinkSync(lock);
  }
}
