import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {createInterface} from 'node:readline';
import type {CodexRuntime} from './codex-launch';

type Json=Record<string,any>;
type Child=ReturnType<typeof spawn>;
const ASTRA_MODEL='gpt-6.2-astra';
const OUTPUT_SCHEMA={type:'object',additionalProperties:false,properties:{markdown:{type:'string',minLength:160,maxLength:60000}},required:['markdown']};
export type CodexThreadSettings={model:string;approvalPolicy:any;approvalsReviewer?:string|null;activePermissionProfile?:{id:string}|null;sandbox?:any;environments?:any};

/** Small stdio JSON-RPC client for the supported Codex app-server protocol. */
export class CodexAppServer{
 private child:Child;
 private input:ReturnType<typeof createInterface>;
 private nextId=1;
 private pending=new Map<number|string,{resolve:(value:any)=>void;reject:(reason:Error)=>void;timer:NodeJS.Timeout}>();
 private listeners=new Set<(method:string,params:Json)=>void>();
 private stderr='';
 private closed=false;
 private constructor(child:Child){
  this.child=child;this.input=createInterface({input:child.stdout!});
  this.input.on('line',line=>this.onLine(line));
  child.stderr?.on('data',chunk=>{this.stderr=(this.stderr+String(chunk)).slice(-8000);});
  child.on('error',error=>this.failAll(error));
  child.on('exit',(code,signal)=>{if(!this.closed)this.failAll(new Error(`Codex app-server exited (${code??signal??'unknown'}). ${this.stderr.trim().slice(-1800)}`));});
 }
 static start(runtime:CodexRuntime,cwd:string,env:NodeJS.ProcessEnv=process.env){
  if(runtime.available===false||!runtime.command)throw new Error('The configured Codex CLI is unavailable. Configure a supported Codex CLI to prepare the reference plan.');
  const child=spawn(runtime.command,[...runtime.prefixArgs,'-c','mcp_servers={}','app-server','--stdio'],{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
  return new CodexAppServer(child);
 }
 onNotification(listener:(method:string,params:Json)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
 private onLine(line:string){
  let message:Json;try{message=JSON.parse(line);}catch{return;}
  if(Number.isInteger(message.id)||typeof message.id==='string'){
   const entry=this.pending.get(message.id);if(!entry)return;clearTimeout(entry.timer);this.pending.delete(message.id);
   if(message.error)entry.reject(new Error(String(message.error.message||message.error.code||'Codex app-server request failed.')));else entry.resolve(message.result);
   return;
  }
  if(typeof message.method==='string')for(const listener of this.listeners)listener(message.method,message.params||{});
 }
 private failAll(error:Error){for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(error);}this.pending.clear();}
 request(method:string,params:Json,timeoutMs=30_000,requestId?:number|string):Promise<any>{
  if(this.closed||this.child.killed)throw new Error('The Codex app-server is not running.');
  const id=requestId??this.nextId++;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Codex app-server request ${method} timed out. ${this.stderr.trim().slice(-1000)}`));},timeoutMs);timer.unref?.();
   this.pending.set(id,{resolve,reject,timer});
   this.child.stdin!.write(`${JSON.stringify({id,method,params})}\n`,error=>{if(error){const entry=this.pending.get(id);if(entry){clearTimeout(entry.timer);this.pending.delete(id);entry.reject(error);}}});
  });
 }
 notify(method:string,params:Json={}){if(this.closed||this.child.killed)throw new Error('The Codex app-server is not running.');this.child.stdin!.write(`${JSON.stringify({method,params})}\n`);}
 async initialize(){await this.request('initialize',{clientInfo:{name:'aetherflow-reference-planner',title:'AetherFlow Reference Planner',version:'1.0.0'},capabilities:{experimentalApi:true}});this.notify('initialized',{});}
 async verifyAstra(){const response=await this.request('model/list',{includeHidden:false});const models=Array.isArray(response?.data)?response.data:[];const model=models.find((entry:any)=>entry?.id===ASTRA_MODEL);if(!model)throw new Error(`Codex does not advertise ${ASTRA_MODEL}. No substitute model was selected.`);if(!Array.isArray(model.inputModalities)||!model.inputModalities.includes('image'))throw new Error(`Codex advertises ${ASTRA_MODEL}, but it does not confirm image input. No substitute model was selected.`);return model;}
 async startThread(cwd:string){const requestId=crypto.randomUUID(),result=await this.request('thread/start',{cwd,allowProviderModelFallback:false,experimentalRawEvents:false},30_000,requestId);return {...result,requestId};}
 async resumeThread(threadId:string,cwd:string){return this.request('thread/resume',{threadId,cwd,excludeTurns:true});}
 async runAnalysis(input:{threadId:string;cwd:string;imagePaths:string[];prompt:string;model:string;restoreSettings:CodexThreadSettings;timeoutMs?:number;onTurnStarted?:()=>Promise<void>|void}){
  let finalText='',turnId='',completed:Json|null=null,turnStarted=false,settingsRestored=false;const finalTexts=new Map<string,string>(),completions=new Map<string,Json>();
  const restore=async()=>{const params:any={threadId:input.threadId,model:input.restoreSettings.model,approvalPolicy:input.restoreSettings.approvalPolicy};if(input.restoreSettings.approvalsReviewer!==undefined)params.approvalsReviewer=input.restoreSettings.approvalsReviewer;if(input.restoreSettings.activePermissionProfile?.id)params.permissions=input.restoreSettings.activePermissionProfile.id;else if(input.restoreSettings.sandbox)params.sandboxPolicy=input.restoreSettings.sandbox;if(input.restoreSettings.environments!==undefined)params.environments=input.restoreSettings.environments;await this.request('thread/settings/update',params);settingsRestored=true;};
  const remove=this.onNotification((method,params)=>{
   if(params.threadId!==input.threadId)return;
   const eventTurnId=String(params.turnId||params.turn?.id||'');if(!eventTurnId)return;
   if(method==='item/completed'&&params.item?.type==='agentMessage'&&typeof params.item.text==='string'){finalTexts.set(eventTurnId,params.item.text);if(eventTurnId===turnId)finalText=params.item.text;}
   if(method==='turn/completed'&&params.turn?.id===eventTurnId){completions.set(eventTurnId,params.turn);if(eventTurnId===turnId)completed=params.turn;}
  });
  try{
   const content:any[]=[{type:'text',text:input.prompt,text_elements:[]},...input.imagePaths.map(path=>({type:'localImage',path}))];
   const response=await this.request('turn/start',{threadId:input.threadId,cwd:input.cwd,model:input.model,input:content,outputSchema:OUTPUT_SCHEMA,sandboxPolicy:{type:'readOnly',networkAccess:false},approvalPolicy:'never',environments:[]},30_000);
   turnId=String(response?.turn?.id||'');if(!turnId)throw new Error('Codex app-server accepted no verifiable turn ID.');finalText=finalTexts.get(turnId)||'';completed=completions.get(turnId)||null;turnStarted=true;if(input.onTurnStarted)await input.onTurnStarted();
   try{await restore();}catch(error){throw new Error(`Astra accepted the analysis turn, but the original Codex model or permissions could not be restored: ${error instanceof Error?error.message:String(error)}`);}
   const timeout=input.timeoutMs||6*60_000;
   if(!completed)await new Promise<void>((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(new Error('Astra reference analysis exceeded its six-minute deadline.')),timeout);deadline.unref?.();
    const off=this.onNotification((method,params)=>{
     if(method!=='turn/completed'||params.threadId!==input.threadId||params.turn?.id!==turnId)return;
     clearTimeout(deadline);off();completed=params.turn;
     if(params.turn.status!=='completed'){reject(new Error(`Astra reference analysis finished with status ${String(params.turn.status||'unknown')}.`));return;}
     resolve();
    });
   });
   const finished=completed as Json|null;
   if(finished?.status!=='completed')throw new Error(`Astra reference analysis finished with status ${String(finished?.status||'unknown')}.`);
   let parsed:any;try{parsed=JSON.parse(finalText);}catch{throw new Error('Astra did not return the required structured Markdown plan. Retry analysis or edit and save a plan manually.');}
   if(typeof parsed?.markdown!=='string')throw new Error('Astra returned no Markdown plan. Retry analysis or edit and save a plan manually.');
   return {markdown:parsed.markdown,turnId,model:input.model,restoredModel:input.restoreSettings.model};
  }finally{remove();if(turnStarted&&!settingsRestored)try{await restore();}catch{/* The request error already describes the failed restore attempt. */}}
 }
 close(){if(this.closed)return;this.closed=true;this.input.close();this.child.kill();this.failAll(new Error('Codex app-server was closed.'));}
}

export const referencePlanAstraModel=ASTRA_MODEL;
