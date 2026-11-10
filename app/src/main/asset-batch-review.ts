import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {z} from 'zod';
import type {AtelierStore} from './store';
import type {Entity} from '../shared/contracts';
import {AssetWorkflowDataSchema,assetViewRoleError,reviewAssetCandidate} from '../shared/asset-production';
import {AssetProductionService} from './asset-production';
import {ownerForArtifact} from './workspace-layout';
import {probeAssetImage} from './asset-image-probe';

const Id=z.string().uuid(),Revision=z.number().int().nonnegative();
const ReviewInput=z.object({id:Id,expectedJobRevision:Revision,expectedWorkflowRevision:Revision,candidateKeys:z.array(z.string().min(1).max(400)).max(1000),candidateVersions:z.array(z.object({key:z.string().min(1).max(400),version:z.string().min(1).max(400)}).strict()).max(1000)}).strict();
const outputRoles=/^(?:image(?::[a-z0-9][a-z0-9-]{0,63})?|foliage:(?:front|back|side|top)|depth(?::[a-z0-9][a-z0-9-]{0,63})?|sheet)$/;
type ReviewRow={itemId:string;itemName:string;role:string;candidateId:string;artifactId:string;hash:string;warnings:string[];key:string;version:string};
type BlockedRow={itemId:string;itemName:string;role:string;candidateIds:string[];reason:string};
type CorePlan={eligible:ReviewRow[];blocked:BlockedRow[];files:Map<string,{path:string;extension:string}>};

const require=createRequire(import.meta.url),pngModule=require.resolve('pngjs');
const workerProbeFunctionSource=probeAssetImage.toString().replace(/__vite_ssr_import_\d+__\.default/g,'fs').replace(/__vite_ssr_import_\d+__/g,'fs');
const workerProbeSource=`const MAX_BYTES=128*1024*1024,MAX_SCAN=4*1024*1024,MAX_PIXELS=16000000;function dimensions(width,height){if(!width||!height||width>8192||height>8192||width*height>MAX_PIXELS)throw new Error('Image dimensions exceed the decode limit.');return {width,height};}${workerProbeFunctionSource}`;
const workerSource=`
const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{PNG}=require(workerData.pngModule);
${workerProbeSource}
const sameStat=(a,b)=>a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.ino===b.ino&&a.dev===b.dev;
let decoderProcessCount=0,activeDecoders=0,maxConcurrentDecoders=0;
async function hashFile(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
function bundledFfmpeg(){const file=workerData.ffmpegPath;if(!file||!path.isAbsolute(file))throw Error('Bundled FFmpeg image decoder is unavailable. Restore the app bundled tools/ffmpeg/ffmpeg.exe or upload this image as PNG, then retry batch review.');try{const stat=fs.lstatSync(file),real=fs.realpathSync.native(file);if(!stat.isFile()||stat.isSymbolicLink()||real!==path.resolve(file)||path.basename(file).toLowerCase()!=='ffmpeg.exe')throw Error('unsafe');return file;}catch{throw Error('Bundled FFmpeg image decoder is unavailable. Restore the app bundled tools/ffmpeg/ffmpeg.exe or upload this image as PNG, then retry batch review.');}}
function decodeWithFfmpeg(file,expected,ffmpeg){return new Promise((resolve,reject)=>{const args=['-hide_banner','-loglevel','error','-nostdin','-threads','1','-protocol_whitelist','pipe','-i','pipe:0','-an','-sn','-dn','-frames:v','1','-threads','1','-f','image2pipe','-vcodec','png','pipe:1'];let outputBytes=0,stderr='',settled=false,registered=false;const chunks=[],maxOutput=Math.min(128*1024*1024,expected.width*expected.height*4+4*1024*1024),child=spawn(ffmpeg,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});registered=true;decoderProcessCount++;activeDecoders++;maxConcurrentDecoders=Math.max(maxConcurrentDecoders,activeDecoders);const input=fs.createReadStream(file);const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(deadline);input.destroy();if(registered){registered=false;activeDecoders--;}if(error){child.kill();reject(error);}else resolve(value);};const deadline=setTimeout(()=>finish(Error('Image decode exceeded the 30 second per-file limit.')),30000);deadline.unref?.();child.stdout.on('data',chunk=>{outputBytes+=chunk.length;if(outputBytes>maxOutput){finish(Error('Decoded image exceeds the bounded output limit.'));return;}chunks.push(chunk);});child.stderr.on('data',chunk=>{if(stderr.length<65536)stderr+=chunk.toString('utf8').slice(0,65536-stderr.length);});child.on('error',error=>finish(Error(error.code==='ENOENT'?'Bundled FFmpeg image decoder is unavailable. Restore the app bundled tools/ffmpeg/ffmpeg.exe or upload this image as PNG, then retry batch review.':error.message)));child.on('close',code=>{if(settled)return;if(code!==0){finish(Error('FFmpeg could not fully decode this image. Check that the file is a complete, non-animated JPEG or WebP image.'+(stderr.trim()?' Decoder detail: '+stderr.trim().slice(0,1200):'')));return;}finish(undefined,Buffer.concat(chunks,outputBytes));});input.on('error',error=>finish(error));child.stdin.on('error',error=>finish(error));input.pipe(child.stdin);});}
async function validate(input){const file=input.path,stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(file)!==path.resolve(file))throw Error('Managed output file is missing or unsafe.');if(stat.size>MAX_BYTES)throw Error('Image is truncated or exceeds the compressed size limit.');const extension=input.extension,hash=await hashFile(file);if(hash!==input.hash)throw Error('Managed output hash does not match its bytes.');if(input.hashOnly){const after=fs.lstatSync(file);if(!sameStat(after,stat))throw Error('Managed output changed while it was being checked.');return {key:input.key,version:input.version,stat:{size:after.size,mtimeMs:after.mtimeMs,ctimeMs:after.ctimeMs,ino:after.ino,dev:after.dev}};}let expected,bytes;if(extension==='.png'){bytes=fs.readFileSync(file);if(bytes.length<29||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PNG header is truncated or invalid.');expected={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};if(!expected.width||!expected.height||expected.width>8192||expected.height>8192||expected.width*expected.height>MAX_PIXELS)throw Error('Image dimensions exceed the decode limit.');}else if(extension==='.jpg'||extension==='.jpeg'||extension==='.webp'){expected=probeAssetImage(file,extension);bytes=await decodeWithFfmpeg(file,expected,bundledFfmpeg());}else throw Error('Batch review supports PNG, JPEG and WebP images.');const decoded=PNG.sync.read(bytes,{checkCRC:true});if(!decoded.width||!decoded.height||decoded.width>8192||decoded.height>8192||decoded.width*decoded.height>MAX_PIXELS||decoded.width!==expected.width||decoded.height!==expected.height)throw Error('Fully decoded image dimensions do not match the bounded container probe.');const after=fs.lstatSync(file);if(!sameStat(after,stat))throw Error('Managed output changed while it was being checked.');return {key:input.key,version:input.version,stat:{size:after.size,mtimeMs:after.mtimeMs,ctimeMs:after.ctimeMs,ino:after.ino,dev:after.dev}};}
parentPort.on('message',async inputs=>{try{const results=[];for(const input of inputs){try{results.push({ok:true,...await validate(input)});}catch(error){results.push({ok:false,key:input.key,reason:error.message||String(error)});}}parentPort.postMessage({results,decoderProcessCount,maxConcurrentDecoders});}catch(error){parentPort.postMessage({error:error.message||String(error)});}});
`;

let validationTail=Promise.resolve();
function serializeValidation<T>(task:()=>Promise<T>):Promise<T>{const next=validationTail.then(task,task);validationTail=next.then(()=>undefined,()=>undefined);return next;}
function fileStatVersion(file:string){const stat=fs.lstatSync(file);return {size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,ino:stat.ino,dev:stat.dev};}
function sameStat(a:any,b:any){return !!a&&!!b&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.ino===b.ino&&a.dev===b.dev;}
function runImageValidation(inputs:Array<{key:string;version:string;path:string;hash:string;extension:string}>,ffmpegPath:string,onMetrics?:(value:any)=>void){return new Promise<any[]>((resolve,reject)=>{const worker=new Worker(workerSource,{eval:true,workerData:{pngModule,ffmpegPath},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32,stackSizeMb:4}});let settled=false;const finish=(error?:Error,result?:any[])=>{if(settled)return;settled=true;clearTimeout(deadline);void worker.terminate();error?reject(error):resolve(result||[]);};const deadline=setTimeout(()=>finish(new Error('Asset batch image validation exceeded its 15 minute deadline.')),15*60_000);deadline.unref?.();worker.once('error',(error:Error)=>finish(error));worker.once('exit',code=>{if(!settled&&code!==0)finish(new Error(`Asset batch image validator exited with code ${code}.`));});worker.once('message',(message:any)=>message?.error?finish(new Error(String(message.error))):(onMetrics?.({decoderProcessCount:message?.decoderProcessCount||0,maxConcurrentDecoders:message?.maxConcurrentDecoders||0}),finish(undefined,message?.results)));worker.postMessage(inputs);});}

/** Explicit human review for one unambiguous, current candidate per image slot. */
export class AssetBatchReviewService{
 private production:AssetProductionService;
 private ffmpegPath:string;
 private validatedVersions=new Map<string,true>();
 constructor(private store:AtelierStore,private options:{ffmpegPath?:string;onValidationMetrics?:(value:{decoderProcessCount:number;maxConcurrentDecoders:number})=>void}={}){this.production=new AssetProductionService(store);this.ffmpegPath=options.ffmpegPath??process.env.AETHERFLOW_FFMPEG_PATH??'';}
 private digestFile(file:string){const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(256*1024);try{let read=0;while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,read));}finally{fs.closeSync(fd);}return hash.digest('hex');}
 private async verifySelectedBytes(row:ReviewRow,file:string){const expected=JSON.parse(row.version).stat,stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(file)!==path.resolve(file)||!sameStat(fileStatVersion(file),expected))throw new Error('A reviewed managed file changed after preview; refresh the batch review.');const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);const after=fs.lstatSync(file);if(hash.digest('hex')!==row.hash||!sameStat(after,stat))throw new Error('A reviewed managed file changed after preview; refresh the batch review.');}
 private sheetMapping(ctx:ReturnType<AssetProductionService['get']>,owner:Entity,candidate:any){
  const state=ctx.current.find(value=>value.itemId===owner.id),snapshot=state?.sheetCandidates?.find((value:any)=>value.candidateId===candidate.id&&value.artifactId===candidate.artifactId);
  if(!snapshot||snapshot.fresh!==true||!snapshot.memberIds?.includes(owner.id))throw new Error('The sheet source selection is old, incomplete or awaiting separate review. Prepare a current sheet candidate.');
 }
 private roleIsCurrent(ctx:ReturnType<AssetProductionService['get']>,item:Entity,role:string,candidate:any){
  if(!outputRoles.test(role))throw new Error('This role is not part of image batch review.');const view=role.includes(':')?role.slice(role.indexOf(':')+1):'',roleError=assetViewRoleError(item.data.route,item.data.views,item.data.depthEnabled,role);if(roleError)throw new Error(roleError);
  if(role==='sheet'){if(item.data.route!=='shared-prop')throw new Error('Only shared props can own a sheet.');this.sheetMapping(ctx,item,candidate);return;}
  if(role==='depth:sheet')throw new Error('Legacy depth sheets are retained in history. Use the main shared sheet built from each prop’s selected current front input.');
  else if(role.startsWith('depth:')||role==='depth'){if(item.data.route==='foliage'||item.data.depthEnabled!==true)throw new Error('Depth views apply only to enabled non-foliage items.');const views=item.data.views?.length?item.data.views:['front'],resolvedView=role==='depth'?(views.includes('front')?'front':views[0]):view;if(!views.includes(resolvedView))throw new Error('The depth view is not required by this master.');}
  else if(role.startsWith('foliage:')){if(item.data.route!=='foliage')throw new Error('Foliage color views require a foliage item.');}
  else{if(item.data.route==='foliage')throw new Error('Foliage color outputs use transparent foliage views.');const views=item.data.views?.length?item.data.views:['front'],resolvedView=role==='image'?(views.includes('front')?'front':views[0]):view;if(!views.includes(resolvedView))throw new Error('The color view is not required by this master.');}
  const state=ctx.current.find(value=>value.itemId===item.id);if(!Array.isArray(state?.imageInputFingerprints)||!state.imageInputFingerprints.includes(candidate.inputFingerprint))throw new Error('The candidate was made from stale image or depth inputs.');
  if(role==='depth'||role.startsWith('depth:')){const canonicalRole=role==='depth'?'depth:front':role,colorRole=canonicalRole.replace(/^depth/,'image'),color=state?.images?.find((entry:any)=>entry.role===colorRole)?.candidate;if(!color||candidate.dependsOnColorHash!==color.hash)throw new Error('The depth candidate does not match its accepted color source.');}
 }
 private planCore(ctx:ReturnType<AssetProductionService['get']>):CorePlan{
  const active=!ctx.job.data.catalogRequiresRevalidation&&(ctx.job.data.catalogStatus==='accepted'||ctx.job.data.catalogStatus==='pending'&&ctx.job.data.catalogPreviouslyAccepted===true),eligible:ReviewRow[]=[],blocked:BlockedRow[]=[],files=new Map<string,{path:string;extension:string}>();
  for(const slot of ctx.workflow.data.slots){if(!outputRoles.test(slot.role))continue;let pending=slot.candidates.filter((candidate:any)=>candidate.status==='pending');if(!pending.length)continue;const item=ctx.items.find(value=>value.id===slot.itemId),itemName=item?.name||slot.itemId;
   if(slot.role==='sheet'){
    const state=ctx.current.find(value=>value.itemId===slot.itemId),freshPending=pending.filter((candidate:any)=>state?.sheetCandidates?.some((row:any)=>row.candidateId===candidate.id&&row.fresh===true));
    for(const candidate of pending.filter((value:any)=>!freshPending.some((row:any)=>row.id===value.id)))blocked.push({itemId:slot.itemId,itemName,role:slot.role,candidateIds:[candidate.id],reason:'This pending sheet uses an old or stale source. Its history is preserved; prepare a current candidate.'});
    pending=freshPending;if(!pending.length)continue;
   }
   if(!active){blocked.push({itemId:slot.itemId,itemName,role:slot.role,candidateIds:pending.map((candidate:any)=>candidate.id),reason:'The accepted catalog is not active.'});continue;}
   if(pending.length!==1){blocked.push({itemId:slot.itemId,itemName,role:slot.role,candidateIds:pending.map((candidate:any)=>candidate.id),reason:'Several candidates are waiting for review in this slot.'});continue;}
   const candidate=pending[0];try{if(!item)throw new Error('The item is not part of this job.');const artifact=this.store.get('artifact',candidate.artifactId),owner=artifact&&ownerForArtifact(this.store,artifact);if(!artifact||owner?.kind!=='assetJob'||owner.id!==ctx.job.id||artifact.data.hash!==candidate.hash)throw new Error('The candidate artifact does not belong to this job or its hash changed.');this.roleIsCurrent(ctx,item,slot.role,candidate);const file=this.store.object(candidate.hash);if(!file||!fs.existsSync(file))throw new Error('Managed output file is missing or unsafe.');const extension=path.extname(String(artifact.data.sourceName||artifact.name)).toLowerCase();const stat=fileStatVersion(file),version=JSON.stringify({artifactId:artifact.id,artifactRevision:artifact.revision,hash:candidate.hash,stat});const key=`${slot.itemId}:${slot.role}:${candidate.id}`;eligible.push({itemId:item.id,itemName:item.name,role:slot.role,candidateId:candidate.id,artifactId:artifact.id,hash:candidate.hash,warnings:candidate.warnings||[],key,version});files.set(key,{path:file,extension});}
   catch(error){blocked.push({itemId:slot.itemId,itemName,role:slot.role,candidateIds:[candidate.id],reason:error instanceof Error?error.message:String(error)});}
  }
  return {eligible,blocked,files};
 }
 private async validatePlan(ctx:ReturnType<AssetProductionService['get']>):Promise<CorePlan>{
  return await serializeValidation(async()=>{
   const plan=this.planCore(ctx),inputs:any[]=[],cachedRows=new Set<string>();
   for(const row of [...plan.eligible]){
    const file=plan.files.get(row.key)!;
    if(!['.png','.jpg','.jpeg','.webp'].includes(file.extension)){
     plan.eligible=plan.eligible.filter(value=>value.key!==row.key);plan.files.delete(row.key);
     plan.blocked.push({itemId:row.itemId,itemName:row.itemName,role:row.role,candidateIds:[row.candidateId],reason:'Batch image review supports PNG, JPEG and WebP files. Inspect this non-image candidate individually.'});continue;
    }
    const cacheKey=`${ctx.job.id}\0${row.key}\0${row.version}`;
    if(this.validatedVersions.has(cacheKey)){cachedRows.add(row.key);continue;}
    inputs.push({key:row.key,version:row.version,path:file.path,hash:row.hash,extension:file.extension});
   }
   const workerResults=inputs.length?await runImageValidation(inputs,this.ffmpegPath,this.options.onValidationMetrics):[],resultByKey=new Map(workerResults.map(value=>[value.key,value]));
   for(const row of [...plan.eligible]){
    if(cachedRows.has(row.key))continue;
    try{
     const result:any=resultByKey.get(row.key);
     if(!result?.ok)throw new Error(result?.reason||'Image could not be validated.');
     if(result.version!==row.version)throw new Error('Managed output metadata changed while it was being checked.');
     const cacheKey=`${ctx.job.id}\0${row.key}\0${row.version}`;this.validatedVersions.set(cacheKey,true);
     if(this.validatedVersions.size>2048)this.validatedVersions.delete(this.validatedVersions.keys().next().value!);
    }catch(error){
     plan.eligible=plan.eligible.filter(value=>value.key!==row.key);plan.files.delete(row.key);
     plan.blocked.push({itemId:row.itemId,itemName:row.itemName,role:row.role,candidateIds:[row.candidateId],reason:error instanceof Error?error.message:String(error)});
    }
   }
   return plan;
  });
 }
 async plan(id:string){const ctx=this.production.get(id),plan=await this.validatePlan(ctx),current=this.production.get(id);if(current.job.revision!==ctx.job.revision||current.workflow.revision!==ctx.workflow.revision)throw Object.assign(new Error('Asset job or workflow changed while the batch was being checked; refresh the review.'),{code:'REVISION_CONFLICT'});return {jobId:id,jobRevision:ctx.job.revision,workflowRevision:ctx.workflow.revision,eligible:plan.eligible,blocked:plan.blocked};}
  async review(raw:unknown){const input=ReviewInput.parse(raw),initial=this.production.get(input.id);if(initial.job.revision!==input.expectedJobRevision||initial.workflow.revision!==input.expectedWorkflowRevision)throw Object.assign(new Error('Asset job or workflow changed; refresh the batch review before accepting.'),{code:'REVISION_CONFLICT'});const plan=await this.validatePlan(initial),actual=plan.eligible.map(row=>row.key),selected=new Set(input.candidateKeys);if(!selected.size||selected.size!==input.candidateKeys.length||input.candidateKeys.some(key=>!actual.includes(key))||JSON.stringify(input.candidateKeys)!==JSON.stringify(actual.filter(key=>selected.has(key))))throw Object.assign(new Error('Current valid candidates changed; refresh the batch review before accepting.'),{code:'REVISION_CONFLICT'});const selectedRows=plan.eligible.filter(row=>selected.has(row.key)),posted=new Map(input.candidateVersions.map(entry=>[entry.key,entry.version]));if(posted.size!==selectedRows.length||selectedRows.some(row=>posted.get(row.key)!==row.version))throw Object.assign(new Error('A reviewed output changed after the preview; refresh the batch review before accepting.'),{code:'REVISION_CONFLICT'});if(!selectedRows.length)throw new Error('There are no unambiguous current image candidates to accept.');
   for(const row of selectedRows){const file=plan.files.get(row.key)?.path;if(!file)throw new Error('A reviewed image is no longer available.');try{await this.verifySelectedBytes(row,file);}catch{this.validatedVersions.delete(`${input.id}\0${row.key}\0${row.version}`);throw Object.assign(new Error('A reviewed image changed after preview; refresh the batch review before accepting.'),{code:'REVISION_CONFLICT'});}}
   return this.store.transaction(()=>{const ctx=this.production.get(input.id);if(ctx.job.revision!==input.expectedJobRevision||ctx.workflow.revision!==input.expectedWorkflowRevision)throw Object.assign(new Error('Asset job or workflow changed; refresh the batch review before accepting.'),{code:'REVISION_CONFLICT'});const core=this.planCore(ctx),now=core.eligible;if(selectedRows.some(row=>{const currentRow=now.find(value=>value.key===row.key);return !currentRow||currentRow.version!==row.version;}))throw Object.assign(new Error('Current valid candidates or managed files changed; refresh the batch review before accepting.'),{code:'REVISION_CONFLICT'});for(const row of selectedRows){const file=core.files.get(row.key)?.path;if(!file||!sameStat(fileStatVersion(file),JSON.parse(row.version).stat))throw Object.assign(new Error('A reviewed managed file changed before acceptance; refresh the batch review.'),{code:'REVISION_CONFLICT'});}
    let slots=[...ctx.workflow.data.slots];for(const row of selectedRows){const index=slots.findIndex((slot:any)=>slot.itemId===row.itemId&&slot.role===row.role);if(index<0)throw new Error('A reviewed slot disappeared.');slots[index]=reviewAssetCandidate(slots[index],row.candidateId,'accept',new Date().toISOString());}const workflow=this.store.assetProductionPut({kind:'workflow',id:ctx.workflow.id,name:ctx.workflow.name,data:AssetWorkflowDataSchema.parse({...ctx.workflow.data,slots,updatedAt:new Date().toISOString()}),expectedRevision:ctx.workflow.revision});return {...this.production.get(input.id),workflow,accepted:selectedRows,blocked:plan.blocked};});
 }
}
