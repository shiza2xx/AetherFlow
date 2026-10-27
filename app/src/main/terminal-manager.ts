import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { TerminalEvent, TerminalState } from '../shared/studio-contracts';
import {runtimeTempDirectory} from './installed-runtime-paths';

type TerminalOwner={characterId?:string;projectId?:string;workspaceRoot?:string;name?:string};
export type TerminalOwnershipSnapshot={id:string;status:TerminalState['status'];characterId:string|null;projectId:string|null;workspaceRoot:string|null;cwd:string;sessionId:string|null;startedAtMs:number};
type SidecarCommand={type:'start';id:string;command:string;args:string[];node:string;launcher:string;config:string;batch:string;cwd:string;env:Record<string,string>;cols:number;rows:number}|{type:'write'|'resize'|'stop'|'theme';id:string;data?:string;cols?:number;rows?:number;foreground?:string;background?:string};
type ManagerOptions={root:string;sidecar:string;onEvent:(event:TerminalEvent)=>void;tempDirectory?:string;spawnProcess?:typeof spawn;now?:()=>number;maxBacklog?:number};
const safeInt=(value:number,min:number,max:number)=>Number.isInteger(value)&&value>=min&&value<=max;
const canonicalPath=(value:string)=>path.resolve(value).replace(/\\/g,'/').toLowerCase();
const ownerKind=(owner:TerminalOwner)=>owner.characterId?'character':owner.projectId?'project':owner.workspaceRoot?'workspace':'invalid';
const ownerKey=(owner:TerminalOwner)=>ownerKind(owner)==='character'?`character:${owner.characterId}`:ownerKind(owner)==='project'?`project:${owner.projectId}`:ownerKind(owner)==='workspace'?`workspace:${canonicalPath(owner.workspaceRoot!)}`:'invalid';
const terminalDiagnostic=(value:unknown)=>String(value??'').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g,'').replace(/\b(Bearer\s+)[^\s]+/gi,'$1[redacted]').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,500);
export function reuseSessionForExactTerminalOwner(bindingSessionId:string|undefined,state:TerminalState,owner:TerminalOwner,cwd:string){
 if(bindingSessionId&&ownerKind(owner)!=='workspace')return bindingSessionId;
 const sameOwner=owner.characterId?state.characterId===owner.characterId&&!state.projectId&&!state.workspaceRoot:owner.projectId?state.projectId===owner.projectId&&!state.characterId&&!state.workspaceRoot:owner.workspaceRoot?state.workspaceRoot&&canonicalPath(state.workspaceRoot)===canonicalPath(owner.workspaceRoot)&&!state.characterId&&!state.projectId:false;
 return sameOwner&&!!state.sessionId&&!!state.cwd&&canonicalPath(state.cwd)===canonicalPath(cwd)?state.sessionId:undefined;
}
export function workspaceTerminalOwner(root:string){
 if(!path.isAbsolute(root)||!fs.existsSync(root)||!fs.statSync(root).isDirectory()||fs.realpathSync.native(root)!==path.resolve(root))throw new Error('The active workspace terminal root is missing or unsafe.');
 return {owner:{workspaceRoot:path.resolve(root),name:'Workspace'},cwd:path.resolve(root)};
}
const redactError=(error:unknown)=>error instanceof Error?error.message.slice(0,500):'The terminal process could not be started.';

/** Owns a single native Node sidecar and the ConPTY it controls. */
export class TerminalManager {
 private child?:ChildProcessWithoutNullStreams;
 private active?:{id:string;owner:TerminalOwner;cwd:string;state:TerminalState;backlog:string;receipt?:string;batch?:string;config?:string;startedAtMs:number;sentRequestIds:Set<string>;decoder:StringDecoder;protocolBuffer:string;discardProtocolLine:boolean};
 private readonly spawnProcess:typeof spawn;
 private readonly now:()=>number;
 private readonly maxBacklog:number;
 constructor(private readonly options:ManagerOptions){this.spawnProcess=options.spawnProcess||spawn;this.now=options.now||Date.now;this.maxBacklog=options.maxBacklog||256*1024;}
 get state():TerminalState{return this.active?{...this.active.state,backlog:this.active.backlog}: {id:null,status:'stopped',cols:100,rows:28};}
 get ownershipSnapshot():TerminalOwnershipSnapshot|null{const active=this.active;if(!active)return null;return {id:active.id,status:active.state.status,characterId:active.owner.characterId||null,projectId:active.owner.projectId||null,workspaceRoot:active.owner.workspaceRoot||null,cwd:active.cwd,sessionId:active.state.sessionId||null,startedAtMs:active.startedAtMs};}
 private emit(type:TerminalEvent['type'],data?:string,exitCode?:number){if(!this.active)return;const event:TerminalEvent={terminalId:this.active.id,type,...data!==undefined?{data}:{},...exitCode!==undefined?{exitCode}:{},...(type==='state'?{state:this.state}:{})};this.options.onEvent(event);}
 private setStatus(status:TerminalState['status'],error?:string,exitCode?:number){if(!this.active)return;this.active.state={...this.active.state,status,...error?{error}:{},...exitCode!==undefined?{exitCode}:{}};this.emit('state');}
 async start(input:{owner:TerminalOwner;cwd:string;node:string;command:string;args:string[];launcher:string;env:Record<string,string>;cols:number;rows:number}):Promise<TerminalState>{
  const id=this.active?.id||crypto.randomUUID(),key=ownerKey(input.owner),kind=ownerKind(input.owner);
  if(kind==='invalid'||[input.owner.characterId,input.owner.projectId,input.owner.workspaceRoot].filter(Boolean).length!==1)throw Object.assign(new Error('An embedded terminal requires exactly one valid character, project, or workspace owner.'),{code:'OWNER_REQUIRED'});
  if(kind==='workspace'&&(canonicalPath(input.owner.workspaceRoot!)!==canonicalPath(this.options.root)||canonicalPath(input.cwd)!==canonicalPath(input.owner.workspaceRoot!)))throw Object.assign(new Error('The workspace terminal owner must match this active terminal manager root.'),{code:'OWNER_CONFLICT'});
  if(this.active?.state.status==='running'||this.active?.state.status==='starting'){
   if(ownerKey(this.active.owner)!==key||canonicalPath(this.active.cwd)!==canonicalPath(input.cwd))throw Object.assign(new Error('Another character, project, or workspace owns the active terminal. Stop it explicitly before switching.'),{code:'OWNER_CONFLICT'});
   return this.state;
  }
  if(this.child&&this.child.exitCode===null)throw Object.assign(new Error('The previous terminal process is still closing. Wait for it to exit before starting another.'),{code:'TERMINAL_STOPPING'});
  if(!safeInt(input.cols,20,300)||!safeInt(input.rows,5,120))throw new Error('Terminal dimensions must be between 20–300 columns and 5–120 rows.');
  if(!path.isAbsolute(input.cwd)||!fs.existsSync(input.cwd)||fs.realpathSync.native(input.cwd)!==path.resolve(input.cwd))throw new Error('The owned terminal working directory is missing or unsafe.');
  if(!path.isAbsolute(input.node)||!fs.existsSync(input.node)||!path.isAbsolute(input.launcher)||!fs.existsSync(input.launcher)||!path.isAbsolute(this.options.sidecar)||!fs.existsSync(this.options.sidecar))throw new Error('Native Node, Codex launcher, or ConPTY sidecar is unavailable.');
  if(input.args.length>128||input.args.some(arg=>arg.length>32768))throw new Error('Codex startup arguments exceed the terminal bounds.');
  const work=path.resolve(input.cwd),terminalId=crypto.randomUUID(),config=path.join(work,`.atelier-codex-${terminalId}.json`),batch=path.join(work,`.atelier-codex-${terminalId}.cmd`),receipt=path.join(work,'.atelier-codex-terminal.json');
  const configData={command:input.command,args:input.args,cwd:work,env:input.env,receiptFile:path.basename(receipt)};
  fs.writeFileSync(config,JSON.stringify(configData),{flag:'wx',mode:0o600});
  this.active={id:terminalId,owner:input.owner,cwd:work,state:{id:terminalId,status:'starting',characterId:input.owner.characterId||null,projectId:input.owner.projectId||null,workspaceRoot:input.owner.workspaceRoot||null,ownerName:input.owner.name,sessionId:null,cwd:work,cols:input.cols,rows:input.rows},backlog:'',receipt,batch,config,startedAtMs:this.now(),sentRequestIds:new Set(),decoder:new StringDecoder('utf8'),protocolBuffer:'',discardProtocolLine:false};
  this.setStatus('starting');
  try{
   const tempDirectory=path.resolve(this.options.tempDirectory||runtimeTempDirectory()),env={...process.env,TEMP:tempDirectory,TMP:tempDirectory,TMPDIR:tempDirectory,NODE_OPTIONS:'--max-old-space-size=512',AETHERFLOW_USER_DATA:input.env.AETHERFLOW_USER_DATA||input.env.ATELIER_USER_DATA||'',AETHERFLOW_MCP_PORT:input.env.AETHERFLOW_MCP_PORT||input.env.ATELIER_MCP_PORT||'',ATELIER_USER_DATA:input.env.ATELIER_USER_DATA||input.env.AETHERFLOW_USER_DATA||'',ATELIER_MCP_PORT:input.env.ATELIER_MCP_PORT||input.env.AETHERFLOW_MCP_PORT||''};
   const active=this.active!,child=this.spawnProcess(input.node,[this.options.sidecar],{cwd:work,env,stdio:['pipe','pipe','pipe'],windowsHide:true});this.child=child;
   const isCurrent=()=>this.child===child&&this.active===active;
   const backendError=(error:unknown)=>{if(!isCurrent())return;this.setStatus('error',redactError(error));this.cleanup();};
   child.stdout.on('data',chunk=>{if(isCurrent())this.consumeBytes(chunk);});
   child.stdout.once('end',()=>{if(!isCurrent())return;this.consume(active.decoder.end());if(active.protocolBuffer||active.discardProtocolLine)this.protocolError('The terminal backend closed with an incomplete protocol record.');});
   child.stdout.once('error',backendError);
   child.stderr.on('data',chunk=>{if(!isCurrent())return;const detail=terminalDiagnostic(chunk);if(detail)this.append(`\r\n[Terminal service diagnostic] ${detail}\r\n`);});
   child.stderr.once('error',backendError);
   child.stdin.once('error',backendError);
   child.once('error',backendError);
   child.once('exit',(code)=>{if(!isCurrent())return;if(!['stopped','exited','error'].includes(active.state.status))this.setStatus(code===0?'exited':'error',code===0?undefined:'The native terminal process exited unexpectedly.',code??1);this.cleanup();});
   child.stdin.write(JSON.stringify({type:'start',id:terminalId,command:input.command,args:input.args,node:input.node,launcher:input.launcher,config,batch,cwd:work,env:input.env,cols:input.cols,rows:input.rows})+'\n');
   return this.state;
  }catch(error){this.setStatus('error',redactError(error));this.cleanup();throw error;}
 }
 private consume(raw:string){const active=this.active;if(!active||!raw)return;const maxRecord=2*1024*1024;let start=0;while(start<raw.length){const newline=raw.indexOf('\n',start),end=newline<0?raw.length:newline,segment=raw.slice(start,end);if(active.discardProtocolLine){if(newline>=0){active.discardProtocolLine=false;this.protocolError('The terminal backend sent an oversized protocol record.');}}else if(active.protocolBuffer.length+segment.length>maxRecord){active.protocolBuffer='';if(newline>=0)this.protocolError('The terminal backend sent an oversized protocol record.');else active.discardProtocolLine=true;}else active.protocolBuffer+=segment;if(newline<0)break;if(!active.discardProtocolLine){const row=active.protocolBuffer.replace(/\r$/,'');active.protocolBuffer='';if(row)this.consumeRecord(row);}start=newline+1;}}
 private consumeBytes(chunk:Buffer){const active=this.active;if(active)this.consume(active.decoder.write(chunk));}
 private consumeRecord(row:string){try{const message=JSON.parse(row),active=this.active;if(message.type==='started'&&active&&message.id===active.id){this.setStatus('running');if(active.receipt){const receipt={schemaVersion:1,pid:Number(message.pid),startedAtMs:Number(message.startedAtMs)||this.now(),cwd:active.cwd,requestId:null};fs.writeFileSync(active.receipt,JSON.stringify(receipt),{flag:'w',mode:0o600});}}else if(message.type==='data'&&active&&message.id===active.id&&typeof message.data==='string'){this.append(message.data);this.emit('data',message.data);}else if(message.type==='exit'&&active&&message.id===active.id){const exitCode=Number(message.exitCode)||0;this.setStatus(active.state.status==='stopped'?'stopped':exitCode===0?'exited':'error',exitCode===0||active.state.status==='stopped'?undefined:'The Codex terminal process exited unexpectedly.',exitCode);this.cleanup();}else if(message.type==='error'&&active){this.setStatus('error',typeof message.error==='string'?message.error:'The terminal backend reported an error.');this.cleanup();}}catch{this.protocolError('The terminal backend sent a malformed protocol record.');}}
 private protocolError(message:string){this.append(`\r\n[${message}]\r\n`);}
 private append(text:string){if(!this.active)return;this.active.backlog=(this.active.backlog+text).slice(-this.maxBacklog);}
 private send(command:SidecarCommand){if(!this.child?.stdin.writable||!this.active)throw new Error('The owned terminal is not running.');this.child.stdin.write(JSON.stringify(command)+'\n');}
 write(terminalId:string,data:string){this.assertOwner(terminalId);if(typeof data!=='string'||data.length>8192)throw new Error('Terminal input is empty or exceeds 8192 characters.');this.send({type:'write',id:terminalId,data});}
 setTheme(terminalId:string,foreground?:string,background?:string){this.assertOwner(terminalId);if(foreground!==undefined&&!/^#[0-9a-f]{6}$/i.test(foreground)||background!==undefined&&!/^#[0-9a-f]{6}$/i.test(background))throw new Error('Terminal theme colors are invalid.');this.send({type:'theme',id:terminalId,...foreground?{foreground}:{},...background?{background}:{}});}
 sendRequest(terminalId:string,requestId:string,markdown:string,confirmedIdle:boolean){this.assertOwner(terminalId);if(this.active!.state.status!=='running')throw new Error('Start the owned Codex session before sending a request.');if(confirmedIdle!==true)throw Object.assign(new Error('Confirm that Codex is idle before sending a prepared request.'),{code:'SESSION_IDLE_CONFIRMATION_REQUIRED'});if(!/^[0-9a-f-]{36}$/i.test(requestId)||typeof markdown!=='string'||markdown.length<1||markdown.length>512*1024)throw new Error('Prepared request is invalid or exceeds 512 KB.');if(this.active!.sentRequestIds.has(requestId))throw Object.assign(new Error('This prepared request was already sent to this session.'),{code:'REQUEST_ALREADY_SENT'});if(this.active!.sentRequestIds.size>=1024)throw Object.assign(new Error('This session reached its prepared-request safety limit. Restart Codex to continue.'),{code:'SESSION_REQUEST_LIMIT'});this.active!.sentRequestIds.add(requestId);const text=`\u001b[200~${markdown}\u001b[201~\r`;for(let at=0;at<text.length;){let end=Math.min(at+4000,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;this.send({type:'write',id:terminalId,data:text.slice(at,end)});at=end;}}
 resize(terminalId:string,cols:number,rows:number){this.assertOwner(terminalId);if(!safeInt(cols,20,300)||!safeInt(rows,5,120))throw new Error('Terminal dimensions must be between 20–300 columns and 5–120 rows.');this.send({type:'resize',id:terminalId,cols,rows});if(this.active)this.active.state={...this.active.state,cols,rows};this.emit('state');return this.state;}
 setSessionId(terminalId:string,sessionId:string){this.assertOwner(terminalId);if(this.active)this.active.state={...this.active.state,sessionId};this.emit('state');}
 async stop(terminalId:string){this.assertOwner(terminalId);const child=this.child;this.send({type:'stop',id:terminalId});this.setStatus('stopped');if(child&&child.exitCode===null)await this.waitForChild(child);return this.state;}
 private assertOwner(id:string){if(!this.active||this.active.id!==id)throw Object.assign(new Error('Terminal is not owned by this Atelier session.'),{code:'TERMINAL_NOT_OWNED'});}
 private async waitForChild(child:ChildProcessWithoutNullStreams,timeoutMs=2000){if(child.exitCode!==null)return;let timer:ReturnType<typeof setTimeout>|undefined;const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));await Promise.race([exited,new Promise<void>(resolve=>{timer=setTimeout(()=>{try{if(child.exitCode===null)child.kill();}catch{}resolve();},timeoutMs);})]);if(timer)clearTimeout(timer);}
 private cleanup(kill=true){const active=this.active,child=this.child;if(kill){this.child=undefined;if(child&&!child.killed)child.kill();}if(active){for(const file of [active.batch,active.config,active.receipt])if(file)try{fs.rmSync(file,{force:true});}catch{}}}
 async close(){const child=this.child;if(this.active?.state.status==='running'||this.active?.state.status==='starting'){try{this.send({type:'stop',id:this.active.id});}catch{}this.setStatus('stopped');}if(child&&child.exitCode===null)await this.waitForChild(child);this.cleanup();}
}
