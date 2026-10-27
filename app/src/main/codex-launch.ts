import fs from 'node:fs';
import path from 'node:path';
import {execFile,execFileSync,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import {verifyRequestSkillClosure} from './skill-closure';
import {isLocale} from '../shared/i18n';
import {isPathWithin} from './path-containment';
import {verifyWorkspaceFooter} from './request-footer';
export {verifyWorkspaceFooter} from './request-footer';

const execFileAsync=promisify(execFile);
export type SpawnLike=(command:string,args:string[],options:{cwd:string;windowsHide:boolean;stdio:'ignore'|'pipe';shell:false;detached:boolean})=>{on?:(event:string,callback:(error?:Error)=>void)=>void;once?:(event:string,callback:(...args:any[])=>void)=>void;stdout?:any;stderr?:any;unref:()=>void};
export type CodexRuntime={command:string;prefixArgs:string[];node:string;terminal:string;terminalKind:'cmd'|'wt'|'powershell';imagegen:'available'|'unavailable'|'unknown';authenticated:boolean|null;diagnostics:string[];available?:boolean;cliPath?:string};
function exists(p:string){return path.isAbsolute(p)&&fs.existsSync(p);}
function codexJsFromShim(shim:string,existsFn:(p:string)=>boolean,pathApi:typeof path=path){const base=pathApi.dirname(shim),candidates=[pathApi.join(base,'node_modules','@openai','codex','bin','codex.js'),pathApi.resolve(base,'..','node_modules','@openai','codex','bin','codex.js')];return candidates.find(existsFn)||'';}
let registeredPath:string|undefined;
export function runtimeSearchPath(){
 if(process.platform!=='win32')return process.env.PATH||'';
 if(registeredPath===undefined){registeredPath='';for(const key of ['HKCU\\Environment','HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']){try{const result=execFileSync('reg.exe',['query',key,'/v','Path'],{encoding:'utf8',windowsHide:true,timeout:1500});const value=result.match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)?.[1]||'';registeredPath+=';'+value.replace(/%([^%]+)%/g,(_all,name)=>process.env[name]||'');}catch{}}}
 return [process.env.PATH,registeredPath,process.env.APPDATA&&path.join(process.env.APPDATA,'npm'),process.env.ProgramFiles&&path.join(process.env.ProgramFiles,'nodejs'),process.env.SystemRoot&&path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0')].filter(Boolean).join(';');
}
export function resolveCodexRuntime(config:{codexPath:string;nodePath:string;terminalPath?:string},deps:{platform?:string;pathEnv?:string;exists?:(p:string)=>boolean}={}):CodexRuntime{
 const platform=deps.platform||process.platform,pathApi=platform==='win32'?path.win32:path,pathEnv=deps.pathEnv??runtimeSearchPath(),delimiter=platform==='win32'?';':path.delimiter,existsFn=deps.exists||fs.existsSync,diagnostics:string[]=[];
 const find=(name:string)=>{const suffixes=platform==='win32'&&!pathApi.extname(name)?['.exe','.cmd','.bat']:[''];for(const folder of pathEnv.split(delimiter).filter(Boolean)){for(const suffix of suffixes){const candidate=pathApi.join(folder.replace(/^"|"$/g,''),name+suffix);if(existsFn(candidate))return candidate;}}return '';};
 let cli=(config.codexPath||'codex').trim();if(!pathApi.isAbsolute(cli))cli=find(cli)||cli;
 let node=(config.nodePath||'').trim();if(!node||!pathApi.isAbsolute(node)||!existsFn(node)||/^electron(?:\.exe)?$/i.test(pathApi.basename(node)))node=find('node');
 if(!node)diagnostics.push('A native Node executable was not found; Electron is not a Codex runtime.');
 let command=cli,prefixArgs:string[]=[],available=pathApi.isAbsolute(cli)&&existsFn(cli);
 if(/\.(?:cmd|bat|ps1)$/i.test(cli)){const js=codexJsFromShim(cli,existsFn,pathApi);available=Boolean(js&&node);if(available){command=node;prefixArgs=[js];}else diagnostics.push('Codex shim was found, but its package JavaScript entry or native Node executable is missing.');}
 else if(!available)diagnostics.push('Codex CLI was not found as a native executable or resolvable npm shim.');
 const systemCmd=platform==='win32'?pathApi.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe'):'';const terminal=(config.terminalPath||'').trim()||find('cmd')||(systemCmd&&existsFn(systemCmd)?systemCmd:''),terminalKind=/cmd(?:\.exe)?$/i.test(terminal)?'cmd':/wt(?:\.exe)?$/i.test(terminal)?'wt':'powershell';
 if(!terminal||!existsFn(terminal))diagnostics.push('Windows Command Prompt (cmd.exe) was not resolved to a native executable.');
 return {command,prefixArgs,node,terminal,terminalKind,imagegen:'unknown',authenticated:null,diagnostics,available,cliPath:cli};
}
function successful(result:any){return result.code===0&&!result.error;}
export async function preflightCodexRuntime(runtime:CodexRuntime,exec=(file:string,args:string[],options:any)=>execFileAsync(file,args,options).then((result:any)=>({...result,code:0})) as Promise<any>):Promise<CodexRuntime>{
 const next={...runtime,diagnostics:[...runtime.diagnostics]};if(!runtime.command||runtime.available===false)return next;
 const invoke=(args:string[])=>exec(runtime.command,[...runtime.prefixArgs,...args],{encoding:'utf8',timeout:3000,windowsHide:true,maxBuffer:1024*1024}).catch((error:any)=>({code:error.code??1,error,stdout:error.stdout||'',stderr:error.stderr||error.message||''}));
 const version=await invoke(['--version']);next.available=successful(version);if(!next.available){next.diagnostics.push('CLI version preflight failed.');return next;}const login=await invoke(['login','status']),features=await invoke(['features','list']),help=await invoke(['--help']);
 if(successful(version)&&`${version.stdout||''}`.trim())next.diagnostics.push(`CLI: ${String(version.stdout).trim().slice(0,160)}`);else next.diagnostics.push('CLI version preflight failed.');
 const loginText=`${login.stdout||''}\n${login.stderr||''}`;const loginDenied=/not\s+logged\s+in|unauthenticated|not\s+authenticated|expired/i.test(loginText),subscriptionLogin=/chatgpt/i.test(loginText)&&/logged\s+in|authenticated/i.test(loginText)&&!/api\s*key|api_key|openai\s+key/i.test(loginText);next.authenticated=successful(login)&&!loginDenied&&subscriptionLogin;if(!next.authenticated)next.diagnostics.push('Login preflight did not confirm an authenticated ChatGPT subscription.');
 const featureText=`${features.stdout||''}\n${features.stderr||''}`;const falseFlag=/image[_ -]?generation[^\r\n]*(?:false|disabled|off|0|not\s+enabled)/i.test(featureText);const trueFlag=/image[_ -]?generation[^\r\n]*(?:true|enabled|on|1)/i.test(featureText);if(!successful(features)||!successful(help)||!featureText.trim())next.imagegen='unknown';else if(falseFlag)next.imagegen='unavailable';else if(next.authenticated===true&&trueFlag)next.imagegen='available';else next.imagegen='unknown';if(next.imagegen==='unknown')next.diagnostics.push('Native image generation capability could not be confirmed as authenticated and enabled; manual Copy Prompt remains available.');return next;
}
export type LaunchInput={root:string;work:string;requestFile:string;bridge:string;runtime:CodexRuntime;launcherScript?:string;keepPowerShellOpen?:boolean;interactiveLauncher?:string;openPath?:(file:string)=>Promise<string>;mcpEnv?:{AETHERFLOW_USER_DATA:string;AETHERFLOW_MCP_PORT:string}|{ATELIER_USER_DATA:string;ATELIER_MCP_PORT:string};sessionId?:string;ownerCharacterId?:string;requestId?:string};
function canonicalMcpEnv(input:LaunchInput['mcpEnv']){if(!input)return undefined;return 'AETHERFLOW_USER_DATA'in input?input:{AETHERFLOW_USER_DATA:input.ATELIER_USER_DATA,AETHERFLOW_MCP_PORT:input.ATELIER_MCP_PORT};}
export function codexArguments(input:LaunchInput){const env=canonicalMcpEnv(input.mcpEnv),scopedEnv=env?`,env={AETHERFLOW_USER_DATA=${JSON.stringify(env.AETHERFLOW_USER_DATA)},AETHERFLOW_MCP_PORT=${JSON.stringify(env.AETHERFLOW_MCP_PORT)}}`:'';const command=[...input.runtime.prefixArgs,'-c',`mcp_servers.aetherflow={command=${JSON.stringify(input.runtime.node)},args=[${JSON.stringify(input.bridge)}]${scopedEnv}}`];if(input.sessionId){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.sessionId))throw new Error('Codex resume session ID is invalid.');command.push('resume',input.sessionId,'--cd',input.work);}else command.push('--cd',input.work);return command;}
export function requestPaths(root:string,work:string,requestFile:string){const base=path.resolve(root),cwd=path.resolve(base,work),file=path.resolve(base,'requests',path.basename(requestFile));if(!isPathWithin(base,cwd)||!isPathWithin(path.join(base,'requests'),file))throw new Error('Codex launch path escaped the workspace.');return {work:cwd,requestFile:file};}
export async function launchCodexRequest(input:LaunchInput,spawnProcess:SpawnLike=(file,args,options)=>spawn(file,args,options) as any):Promise<{launched:boolean;cwd:string;requestFile:string;terminal:string;terminalKind:'cmd'|'wt'|'powershell';command:string;args:string[]}>{
 const paths=requestPaths(input.root,input.work,input.requestFile),mcpEnv=canonicalMcpEnv(input.mcpEnv);fs.mkdirSync(paths.work,{recursive:true});if(!fs.existsSync(paths.requestFile))throw new Error('Saved Codex request does not exist.');if(input.runtime.terminalKind==='cmd'){
   if(!input.openPath||!input.interactiveLauncher||!fs.existsSync(input.interactiveLauncher))throw new Error('The interactive CMD launcher is unavailable.');
     const stem=path.join(paths.work,`.aetherflow-codex-${crypto.randomUUID()}`),configFile=stem+'.json',batch=stem+'.cmd';
   const quote=(value:string)=>{if(/["\r\n]/.test(value))throw new Error('CMD launcher path is invalid.');return '"'+value.replace(/%/g,'%%')+'"';};
   const args=codexArguments({...input,work:paths.work,requestFile:paths.requestFile});
   fs.writeFileSync(configFile,JSON.stringify({command:input.runtime.command,args,cwd:paths.work,env:mcpEnv,...input.ownerCharacterId?{receiptFile:path.join(paths.work,'.atelier-codex-terminal.json'),requestId:input.requestId}:{}}),{flag:'wx'});
   try{
      fs.writeFileSync(batch,`@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\nset "TERM="\r\ntitle AetherFlow ${path.basename(paths.work).replace(/[^a-zA-Z0-9-]/g,'_')}\r\ncd /d "%~dp0"\r\n${quote(input.runtime.node)} ${quote(input.interactiveLauncher)} ${quote(configFile)}\r\nif errorlevel 1 pause\r\ndel "%~f0"\r\n`,{flag:'wx'});
     const error=await input.openPath(batch);if(error)throw new Error(error);
     return {launched:true,cwd:paths.work,requestFile:paths.requestFile,terminal:input.runtime.terminal,terminalKind:'cmd',command:input.runtime.command,args:[]};
   }catch(error){fs.rmSync(batch,{force:true});fs.rmSync(configFile,{force:true});throw error;}
 }
 let command=input.runtime.terminal,args:string[];if(input.runtime.terminalKind==='wt'){if(!input.interactiveLauncher||!fs.existsSync(input.interactiveLauncher))throw new Error('The interactive session helper is unavailable.');const configFile=path.join(paths.work,`.atelier-codex-${Date.now()}.json`);fs.writeFileSync(configFile,JSON.stringify({command:input.runtime.command,args:codexArguments({...input,work:paths.work,requestFile:paths.requestFile}),cwd:paths.work,env:mcpEnv,...input.ownerCharacterId?{receiptFile:path.join(paths.work,'.atelier-codex-terminal.json'),requestId:input.requestId}:{}}),{flag:'wx'});command=input.runtime.terminal;args=['-w','new','nt','--title',`AetherFlow ${path.basename(paths.work)}`,'--suppressApplicationTitle','-d',paths.work,input.runtime.node,input.interactiveLauncher,configFile];}else{if(!input.launcherScript||!fs.existsSync(input.launcherScript))throw new Error('PowerShell fallback launcher script is unavailable.');const configFile=path.join(paths.work,`.atelier-codex-${Date.now()}.json`);fs.writeFileSync(configFile,JSON.stringify({command:input.runtime.command,args:codexArguments({...input,work:paths.work,requestFile:paths.requestFile}),cwd:paths.work,env:mcpEnv,keepOpen:input.keepPowerShellOpen!==false,...input.ownerCharacterId?{receiptFile:path.join(paths.work,'.atelier-codex-terminal.json'),requestId:input.requestId}:{}}),{flag:'wx'});args=['-NoProfile','-NoLogo','-NonInteractive','-ExecutionPolicy','Bypass','-File',input.launcherScript,configFile,'-Launch'];}
 return await new Promise((resolve,reject)=>{
  let child:any,settled=false,output='',errors='';
  const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else{child.unref();resolve({launched:true,cwd:paths.work,requestFile:paths.requestFile,terminal:command,terminalKind:input.runtime.terminalKind,command:input.runtime.command,args});}};
  const timer=setTimeout(()=>finish(new Error('The terminal did not confirm opening.')),10000);
  try{child=spawnProcess(command,args,{cwd:paths.work,windowsHide:input.runtime.terminalKind==='powershell',stdio:input.runtime.terminalKind==='powershell'?'pipe':'ignore',shell:false,detached:input.runtime.terminalKind==='wt'});}catch(error){finish(error as Error);return;}
  if(child.once){child.once('error',(error:Error)=>finish(error));child.once('spawn',()=>{if(input.runtime.terminalKind==='wt'||!child.stdout)finish();});
   if(input.runtime.terminalKind==='powershell'&&child.stdout){child.stdout.on('data',(chunk:any)=>{if(output.length<8192)output+=String(chunk)});child.stderr?.on('data',(chunk:any)=>{if(errors.length<8192)errors+=String(chunk)});child.once('close',(code:number)=>{if(code===0&&/"pid"\s*:\s*\d+/i.test(output))finish();else finish(new Error(errors.trim()||'PowerShell could not open an interactive Codex window.'));});}
  }else finish();
 });
}
export async function launchPersistedCodexRequest(input:{store:{root:string;stageRequestForPath:(file:string)=>any;settings:()=>{codexPath:string;nodePath:string}};cwd:string;promptFile:string;bridge:string;launcherScript?:string;keepPowerShellOpen?:boolean;resolveRuntime:(settings:{codexPath:string;nodePath:string})=>Promise<CodexRuntime>;spawnProcess?:SpawnLike;interactiveLauncher?:string;openPath?:(file:string)=>Promise<string>;mcpEnv?:LaunchInput['mcpEnv'];sessionId?:string}){
 const root=path.resolve(input.store.root),work=path.resolve(root,input.cwd),file=path.resolve(root,'requests',path.basename(input.promptFile));
 if(!isPathWithin(root,work)||!isPathWithin(path.join(root,'requests'),file))throw new Error('Codex launch path escaped the workspace.');
 if(!fs.existsSync(file)||!fs.existsSync(work))throw new Error('The saved request file or its owned workspace is missing.');
 if(fs.realpathSync.native(work)!==work||fs.realpathSync.native(file)!==file||!fs.lstatSync(work).isDirectory()||!fs.lstatSync(file).isFile())throw new Error('Codex launch path contains a symlink or non-regular item.');
 const relativeRequest=path.relative(root,file).replace(/\\/g,'/'),request=input.store.stageRequestForPath(relativeRequest);
 if(!request)throw new Error('The saved Codex request has no matching persisted request record.');
 if(path.resolve(root,String(request.data.workspace||''))!==work)throw new Error('Codex launch workspace does not match the immutable request record.');
 if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==request.data.requestHash)throw new Error('Saved request bytes changed; regenerate the request before launch.');
 const prompt=fs.readFileSync(file,'utf8');
 if(!verifyWorkspaceFooter(prompt,work,isLocale(request.data.locale)?request.data.locale:undefined))throw new Error('Saved request workspace footer is stale or malformed; regenerate the request for this workspace before launch.');
 for(const skill of request.data.selectedSkills||[])verifyRequestSkillClosure(work,skill);
 const runtime=await input.resolveRuntime(input.store.settings());
 if(!runtime.terminal||!runtime.node||runtime.available===false||runtime.available===undefined&&runtime.diagnostics.some(d=>d.includes('not found')||d.includes('missing')))throw new Error(runtime.diagnostics.join(' '));
 let sessionWork=work;
 if(request.data.entityKind==='character'){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(request.data.entityId)))throw new Error('Character session owner is invalid.');
   sessionWork=path.join(root,'work','characters',request.data.entityId);
   // Check existing parents before creating the session. A junction must never
   // redirect the interactive working directory outside this workspace.
   let parent=sessionWork;while(!fs.existsSync(parent))parent=path.dirname(parent);
   if(fs.realpathSync.native(parent)!==parent)throw new Error('Character session path contains a symlink.');
   fs.mkdirSync(sessionWork,{recursive:true});
   if(fs.realpathSync.native(sessionWork)!==sessionWork)throw new Error('Character session path contains a symlink.');
 }
 const launched=await launchCodexRequest({root,work:sessionWork,requestFile:file,bridge:input.bridge,runtime,launcherScript:input.launcherScript,keepPowerShellOpen:input.keepPowerShellOpen,interactiveLauncher:input.interactiveLauncher,openPath:input.openPath,mcpEnv:input.mcpEnv,sessionId:input.sessionId,...request.data.entityKind==='character'?{ownerCharacterId:String(request.data.entityId),requestId:request.id}:{}},input.spawnProcess);
 return {...launched,runtime};
}
