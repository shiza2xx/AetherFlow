import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {AtelierStore} from './store';
import type {Entity} from '../shared/contracts';
import {AssetJobDataSchema} from '../shared/asset-production';
import {ReferencePlanStateSchema,referencePlanAnalysisPrompt,validateReferencePlanMarkdown,type ReferencePlanOwnerKind} from '../shared/reference-plan';
import {CodexAppServer,referencePlanAstraModel,type CodexThreadSettings} from './codex-app-server';
import {findBoundAetherflowCodexThread,readCodexThreadMetadataByIdAsync,sessionScope,threadCwdMatches,type SessionIndexResult} from './codex-session';
import {bindAetherflowAssetJobSession,type OwnerSessionBinding} from './asset-job-codex-session';
import {activeReferencePlan,referencePlanSnapshot,referencePlanState,storedReferencePlan} from './reference-plan-domain';
import type {CodexRuntime} from './codex-launch';
import {AssetProductionService} from './asset-production';
import {ensureWorkbenchSkills} from './workbench-bootstrap';
import {materializeReferenceImages,type ReferenceImageCropper,type ReferenceImageFile,type ReferenceCrop} from './reference-plan-attachments';

type OwnerRef={kind:ReferencePlanOwnerKind;id:string};
type OwnerRequest={kind:ReferencePlanOwnerKind;ownerId:string;workspace:string;workspaceInstanceId:string};
type ReferenceCodexSession=Pick<CodexAppServer,'initialize'|'verifyAstra'|'startThread'|'resumeThread'|'request'|'runAnalysis'|'close'>;
type ServiceContext={
 currentStore:()=>AtelierStore;
 workspaceInstance:()=>string;
 runtime:(store:AtelierStore)=>CodexRuntime;
 resourceRoot?:string;
 busy?:(owner:OwnerRef)=>boolean;
 bindCharacterSession?:(store:AtelierStore,ownerId:string,expectedRevision:number,expectedSessionId:string|null,origin:NonNullable<OwnerSessionBinding['origin']>)=>Promise<unknown>;
 advance?:(store:AtelierStore,owner:OwnerRef)=>unknown;
 appServerFactory?:(runtime:CodexRuntime,cwd:string)=>ReferenceCodexSession;
 readThreadById?:(sessionId:string)=>Promise<SessionIndexResult>;
 cropSourceImage?:ReferenceImageCropper;
 onPlanSaved?:(owner:OwnerRef,artifactId:string)=>void;
};
const flights=new WeakMap<AtelierStore,Map<string,{runId:string;promise:Promise<unknown>}>>();
const lockMap=(store:AtelierStore)=>{let map=flights.get(store);if(!map){map=new Map();flights.set(store,map);}return map;};
const id=()=>crypto.randomUUID();
const sha=(bytes:Buffer|string)=>crypto.createHash('sha256').update(bytes).digest('hex');
const ownerKey=(owner:OwnerRef)=>`${owner.kind}:${owner.id}`;
const sameOwner=(left:OwnerRef,right:OwnerRef)=>left.kind===right.kind&&left.id===right.id;
const currentSession=(owner:Entity)=>owner.data.codexSession?.current||owner.data.guidedSession?.current||null;
const pendingSession=(owner:Entity)=>owner.data.codexSession?.pendingLaunch||owner.data.guidedSession?.pendingLaunch||null;

/** Owner-scoped reference plan editor and analysis lifecycle. It never selects a catalog item or accepts a production candidate. */
export class ReferencePlanService{
 constructor(private readonly store:AtelierStore,private readonly context:ServiceContext){}
 private checkWorkspace(workspace:string,instance:string){if(path.resolve(workspace)!==this.store.root||this.context.currentStore()!==this.store||this.context.workspaceInstance()!==instance)throw Object.assign(new Error('Workspace changed while the reference plan was open.'),{code:'WORKSPACE_STALE'});}
 private owner(kind:ReferencePlanOwnerKind,idValue:string){const owner=this.store.get(kind==='character'?'character':'assetJob',idValue);if(!owner||owner.data.deletedAt)throw Object.assign(new Error('Reference plan owner was not found or is in Deleted.'),{code:'NOT_FOUND'});return owner;}
 private sourceStage(owner:Entity,kind:ReferencePlanOwnerKind){if(kind==='assetJob'){if(owner.data.stage!=='source')throw Object.assign(new Error('A reference plan can only start from Assets stage 1, Source artwork.'),{code:'STAGE_MISMATCH'});return;}const workflow=this.store.workflowForCharacter(owner.id),guided=(workflow?.data.guided||{}) as any;if(owner.data.definitionVersion!==2||guided.currentStepKey!=='source')throw Object.assign(new Error('A reference plan can only start from Characters stage 1, Source artwork.'),{code:'STAGE_MISMATCH'});}
 get(kind:ReferencePlanOwnerKind,ownerId:string){const owner=this.owner(kind,ownerId),key=ownerKey({kind,id:ownerId}),state=referencePlanState(owner),active=lockMap(this.store).get(key);if(state.run?.status==='running'&&!active){this.saveState(owner,{...state,run:{...state.run,status:'interrupted',updatedAt:new Date().toISOString(),message:'The app closed before this analysis completed. Retry to start one new analysis.'}});}
  const latest=this.owner(kind,ownerId),snapshot=referencePlanSnapshot(this.store,kind,ownerId);return {...storedReferencePlan(this.store,kind,ownerId,snapshot),ownerRevision:latest.revision,sourceCount:snapshot.sourceArtifacts.length,sourceNames:snapshot.sourceArtifacts.map(item=>item.name),sourceHash:snapshot.sourceHash,lineageHash:snapshot.lineageHash,busy:!!active,codexDraftId:latest.data.referencePlan?.codexDraft?.lineageHash===snapshot.lineageHash?latest.data.referencePlan.codexDraft.id:null,astraModel:referencePlanAstraModel};
 }
 toggle(input:{kind:ReferencePlanOwnerKind;ownerId:string;enabled:boolean;expectedRevision:number;lineageHash:string}){const owner=this.owner(input.kind,input.ownerId);if(owner.revision!==input.expectedRevision)throw Object.assign(new Error('Owner changed; refresh the reference plan before updating it.'),{code:'REVISION_CONFLICT'});const snapshot=referencePlanSnapshot(this.store,input.kind,input.ownerId);if(snapshot.lineageHash!==input.lineageHash)throw Object.assign(new Error('The source, crop, or brief changed. Refresh before changing reference plan guidance.'),{code:'REVISION_CONFLICT'});const state=referencePlanState(owner);return this.saveState(owner,{...state,enabled:input.enabled});}
 save(input:{kind:ReferencePlanOwnerKind;ownerId:string;markdown:string;expectedRevision:number;lineageHash:string}){
  const owner=this.owner(input.kind,input.ownerId);if(owner.revision!==input.expectedRevision)throw Object.assign(new Error('Owner changed; refresh before saving the reference plan.'),{code:'REVISION_CONFLICT'});const key=ownerKey({kind:input.kind,id:input.ownerId});if(lockMap(this.store).has(key))throw Object.assign(new Error('Wait for the active Astra analysis to finish before editing this plan.'),{code:'REFERENCE_PLAN_BUSY'});
  const markdown=validateReferencePlanMarkdown(input.kind,input.markdown),snapshot=referencePlanSnapshot(this.store,input.kind,input.ownerId);if(snapshot.lineageHash!==input.lineageHash)throw Object.assign(new Error('The source, crop, or brief changed. Refresh before saving this version.'),{code:'REVISION_CONFLICT'});if(!snapshot.sourcePaths.length)throw Object.assign(new Error('Add a managed source image before saving a reference plan.'),{code:'REFERENCE_SOURCE_MISSING'});
  const artifact=this.persistVersion(this.owner(input.kind,input.ownerId),input.kind,snapshot,markdown,'manual'),latest=this.owner(input.kind,input.ownerId),state=referencePlanState(latest);this.saveState(latest,{...state,currentArtifactId:artifact.id,currentLineageHash:snapshot.lineageHash});return artifact;
 }
 codexRequest(input:OwnerRequest&{lineageHash:string}){
  this.checkWorkspace(input.workspace,input.workspaceInstanceId);
  const owner=this.owner(input.kind,input.ownerId),snapshot=referencePlanSnapshot(this.store,input.kind,input.ownerId);
  this.sourceStage(owner,input.kind);
  const state=referencePlanState(owner);
  if(!state.enabled||snapshot.lineageHash!==input.lineageHash)throw new Error('The reference or its settings changed. Reopen the plan request.');
  if(lockMap(this.store).has(ownerKey({kind:input.kind,id:input.ownerId})))throw new Error('Wait for the current Astra analysis to finish.');
  let draft=state.codexDraft;
  let ownerRevision=owner.revision;
  if(draft?.lineageHash!==snapshot.lineageHash){
   const draftId=id();
   const sources=snapshot.sourceArtifacts.map((artifact,index)=>({path:snapshot.sourcePaths[index],hash:String(artifact.data.hash),mime:String(artifact.data.mime||''),name:artifact.name}));
   const images=materializeReferenceImages({workspace:this.store.root,ownerKind:input.kind,ownerId:input.ownerId,runId:draftId,sources,crop:input.kind==='assetJob'?owner.data.sourceCrop as ReferenceCrop|null:null,cropImage:this.context.cropSourceImage});
   draft={id:draftId,lineageHash:snapshot.lineageHash,imageNames:images.paths.map(file=>path.basename(file))};
   ownerRevision=this.saveState(owner,{...state,codexDraft:draft}).revision;
  }
  const directory=this.codexDraftDirectory(input.kind,input.ownerId,draft.id);
  const imagePaths=draft.imageNames.map(name=>path.join(directory,name));
  for(const file of imagePaths)this.assertDraftFile(file);
  const markdown=referencePlanAnalysisPrompt({ownerKind:input.kind,ownerName:owner.name,goal:String(input.kind==='assetJob'?owner.data.target||'':owner.data.description||''),inclusions:owner.data.inclusions,exclusions:owner.data.exclusions,dimensions:owner.data.dimensions,crop:owner.data.sourceCrop,sourceCount:snapshot.sourceArtifacts.length,locale:this.store.settings().locale})
   .replace('the attached source artwork','the source artwork in the files listed below')
   .replace('do not generate or edit images or models, use tools or services, approve a catalog/model/image, or perform any production action','use local tools only to view the listed files and save the Markdown plan. Do not generate or edit images or models, use external services, approve production candidates, or perform production actions');
  const outputPath=path.join(directory,'plan.md');
  return {draftId:draft.id,ownerRevision,markdown:[
   'Prepare an AetherFlow reference plan. Open and visually inspect each local image listed here in order before writing the plan.',
   ...imagePaths.map(file=>`- ${file}`),
   `Save the finished Markdown as UTF-8 to this exact file: ${outputPath}`,
   'Write the complete file to plan.md.tmp in the same directory, then rename it to plan.md. AetherFlow will import it and advance automatically. Tell the user the plan is saved, without asking them to click an import button.',
   markdown
  ].join('\n')};
 }
 importCodexDraft(input:OwnerRequest&{draftId:string;poll?:boolean}){
  this.checkWorkspace(input.workspace,input.workspaceInstanceId);
  const owner=this.owner(input.kind,input.ownerId),state=referencePlanState(owner),draft=state.codexDraft;
  this.sourceStage(owner,input.kind);
  if(lockMap(this.store).has(ownerKey({kind:input.kind,id:input.ownerId})))return {advanced:false};
  if(!state.enabled||draft?.id!==input.draftId)throw Object.assign(new Error('The source or brief changed. Open a new Codex request for this reference.'),{code:'REFERENCE_PLAN_DRAFT_STALE'});
  const file=path.join(this.codexDraftDirectory(input.kind,input.ownerId,draft.id),'plan.md');
  if(!fs.existsSync(file)){
   if(input.poll)return {advanced:false};
   throw Object.assign(new Error('Codex has not saved the plan yet.'),{code:'REFERENCE_PLAN_DRAFT_MISSING'});
  }
  const snapshot=referencePlanSnapshot(this.store,input.kind,input.ownerId);
  if(draft.lineageHash!==snapshot.lineageHash)throw Object.assign(new Error('The source or brief changed. Open a new Codex request for this reference.'),{code:'REFERENCE_PLAN_DRAFT_STALE'});
  this.assertDraftFile(file,240000);
  const markdown=validateReferencePlanMarkdown(input.kind,fs.readFileSync(file,'utf8'));
  const imported=this.store.transaction(()=>{
   const artifact=this.persistVersion(owner,input.kind,snapshot,markdown,'manual',draft.id);
   this.saveState(owner,{...state,currentArtifactId:artifact.id,currentLineageHash:snapshot.lineageHash,codexDraft:undefined});
   const result=this.advance(input.kind,input.ownerId,snapshot.lineageHash,input.workspace,input.workspaceInstanceId,snapshot);
   return {artifact,result,advanced:true};
  });
  this.notifyPlanSaved({kind:input.kind,id:input.ownerId},imported.artifact.id);
  return imported;
 }
 private codexDraftDirectory(kind:ReferencePlanOwnerKind,ownerId:string,draftId:string){
  const root=fs.realpathSync.native(this.store.root),directory=path.join(root,'work',kind==='assetJob'?'assets':'characters',ownerId,'reference-plan-inputs',draftId);
  if(!fs.lstatSync(directory).isDirectory()||fs.realpathSync.native(directory)!==directory)throw new Error('The reference-plan draft directory is unsafe.');
  return directory;
 }
 private assertDraftFile(file:string,maxBytes=Infinity){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(file)!==file||stat.size>maxBytes)throw new Error('The reference-plan draft file is invalid or unsafe.');
 }
 async prepare(input:{kind:ReferencePlanOwnerKind;ownerId:string;expectedRevision:number;lineageHash:string;retry?:boolean;reuseOnly?:boolean;workspace:string;workspaceInstanceId:string}){
  this.checkWorkspace(input.workspace,input.workspaceInstanceId);const owner=this.owner(input.kind,input.ownerId);this.sourceStage(owner,input.kind);if(owner.revision!==input.expectedRevision)throw Object.assign(new Error('Owner changed; refresh before continuing.'),{code:'REVISION_CONFLICT'});const snapshot=referencePlanSnapshot(this.store,input.kind,input.ownerId);if(snapshot.lineageHash!==input.lineageHash)throw Object.assign(new Error('The source image, crop, or brief changed. Refresh before continuing.'),{code:'REVISION_CONFLICT'});if(!snapshot.sourcePaths.length)throw Object.assign(new Error('Add a managed source image before preparing the reference plan.'),{code:'REFERENCE_SOURCE_MISSING'});
  const key=ownerKey({kind:input.kind,id:input.ownerId}),locks=lockMap(this.store),existing=locks.get(key);if(existing)throw Object.assign(new Error('Astra is already preparing a reference plan for this owner.'),{code:'REFERENCE_PLAN_BUSY'});
  let state=referencePlanState(owner);if(state.run?.status==='running')throw Object.assign(new Error('The previous analysis stopped before completion. Retry to start a new run.'),{code:'REFERENCE_PLAN_INTERRUPTED'});
  if(state.enabled&&activeReferencePlan(this.store,input.kind,input.ownerId,snapshot)){const result=this.advance(input.kind,input.ownerId,snapshot.lineageHash,input.workspace,input.workspaceInstanceId,snapshot);return {started:false,advanced:true,result,state:this.get(input.kind,input.ownerId)};}
  if(input.reuseOnly)throw Object.assign(new Error('The saved plan changed. Reopen the Codex prompt for the current reference.'),{code:'REVISION_CONFLICT'});
  if(state.run&&['error','interrupted','stale'].includes(state.run.status)&&input.retry!==true)throw Object.assign(new Error('Retry the reference analysis explicitly, or turn the option off to continue without a plan.'),{code:'REFERENCE_PLAN_RETRY_REQUIRED'});
  const runId=id(),now=new Date().toISOString(),current=currentSession(owner);state={...state,enabled:true,run:{id:runId,status:'running',requestedAt:now,updatedAt:now,lineageHash:snapshot.lineageHash,sourceHash:snapshot.sourceHash,...current?.sessionId?{sessionId:String(current.sessionId)}:{}}};const saved=this.saveState(owner,state),capturedInstance=input.workspaceInstanceId;
  const sources=snapshot.sourceArtifacts.map((artifact,index)=>({path:snapshot.sourcePaths[index],hash:String(artifact.data.hash),mime:String(artifact.data.mime||''),name:artifact.name}));
  const promise=Promise.resolve().then(()=>this.execute({owner:{kind:input.kind,id:input.ownerId},runId,lineageHash:snapshot.lineageHash,sourceHash:snapshot.sourceHash,sourcePaths:snapshot.sourcePaths,sources,crop:(owner.data.sourceCrop||null) as ReferenceCrop|null,ownerRevision:saved.revision,workspace:input.workspace,workspaceInstanceId:capturedInstance}));locks.set(key,{runId,promise});
  try{return await promise;}finally{if(locks.get(key)?.runId===runId)locks.delete(key);}
 }
 private async execute(input:{owner:OwnerRef;runId:string;lineageHash:string;sourceHash:string;sourcePaths:string[];sources:ReferenceImageFile[];crop:ReferenceCrop|null;ownerRevision:number;workspace:string;workspaceInstanceId:string}){
  let server:ReferenceCodexSession|undefined,attachments:ReturnType<typeof materializeReferenceImages>|undefined;try{
   const isCurrent=()=>this.context.currentStore()===this.store&&this.context.workspaceInstance()===input.workspaceInstanceId&&path.resolve(input.workspace)===this.store.root;
   const owner=this.owner(input.owner.kind,input.owner.id),snapshot=referencePlanSnapshot(this.store,input.owner.kind,input.owner.id);if(!isCurrent()||snapshot.lineageHash!==input.lineageHash)throw Object.assign(new Error('Workspace or source changed before Astra analysis could start.'),{code:'WORKSPACE_STALE'});
   const work=path.resolve(this.store.root,'work',input.owner.kind==='assetJob'?'assets':'characters',input.owner.id);fs.mkdirSync(work,{recursive:true});if(this.context.resourceRoot)ensureWorkbenchSkills(this.context.resourceRoot,work,this.store.settings().locale,{kind:input.owner.kind,id:input.owner.id,name:owner.name});const scope=sessionScope(work);if(this.context.busy?.(input.owner))throw Object.assign(new Error('Finish active Codex, terminal, or workbench work for this owner before preparing a reference plan.'),{code:'OWNER_BUSY'});
   if(pendingSession(owner))throw Object.assign(new Error('A Codex launch is still unresolved for this owner. Verify its session before preparing a reference plan.'),{code:'SESSION_RECOVERY_REQUIRED'});
   attachments=materializeReferenceImages({workspace:this.store.root,ownerKind:input.owner.kind,ownerId:input.owner.id,runId:input.runId,sources:input.sources,crop:input.owner.kind==='assetJob'?input.crop:null,cropImage:this.context.cropSourceImage});
   const runtime=this.context.runtime(this.store),client=this.context.appServerFactory?this.context.appServerFactory(runtime,work):CodexAppServer.start(runtime,work);server=client;await client.initialize();await client.verifyAstra();
   let sessionId:string,restoreSettings:CodexThreadSettings,settingsEnvelope:any,origin:OwnerSessionBinding['origin']|undefined,newThread=false;
   const binding=currentSession(owner);
   if(binding?.sessionId){
    const index=await (this.context.readThreadById||readCodexThreadMetadataByIdAsync)(String(binding.sessionId));const verified=findBoundAetherflowCodexThread(index,String(binding.sessionId),scope.cwd,{kind:input.owner.kind,id:input.owner.id,scope:binding.scope||scope,origin:binding.origin});if(!verified.ok)throw Object.assign(new Error(verified.reason),{code:'SESSION_RECOVERY_REQUIRED'});
    const resumed=await client.resumeThread(String(binding.sessionId),scope.cwd),thread=resumed?.thread;if(thread?.id!==binding.sessionId||!threadCwdMatches(String(thread.cwd||''),scope.cwd))throw Object.assign(new Error('Codex app-server resumed a different thread or working directory.'),{code:'SESSION_RECOVERY_REQUIRED'});if(thread.status?.type!=='idle')throw Object.assign(new Error('The bound Codex thread is busy or unavailable. Wait for it to finish before preparing the reference plan.'),{code:'SESSION_BUSY'});sessionId=String(binding.sessionId);settingsEnvelope=resumed;
   }else{
    const started=await client.startThread(scope.cwd),thread=started?.thread,startRequestId=String(started?.requestId||started?.request_id||'');if(!thread||typeof thread.id!=='string'||!threadCwdMatches(String(thread.cwd||''),scope.cwd)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(startRequestId))throw new Error('Codex app-server did not return a verifiable new thread ID and request ID in this owner directory.');sessionId=thread.id;settingsEnvelope=started;newThread=true;
    origin={kind:'aetherflow-app-server',verified:true,ownerKind:input.owner.kind,ownerId:input.owner.id,sessionId,startRequestId,host:scope.host,profile:scope.profile,cwd:scope.cwd,createdAt:new Date().toISOString()};
   }
   if(!isCurrent())throw Object.assign(new Error('Workspace changed while Codex was starting. The analysis was stopped before sending the source image.'),{code:'WORKSPACE_STALE'});
   if(typeof settingsEnvelope?.model!=='string'||!settingsEnvelope.model||settingsEnvelope.approvalPolicy===undefined||settingsEnvelope.sandbox===undefined||!settingsEnvelope.thread||!('environments'in settingsEnvelope.thread))throw new Error('Codex app-server did not return the current model, permissions, and environment settings needed to restore the user’s thread after Astra analysis.');restoreSettings={model:settingsEnvelope.model,approvalPolicy:settingsEnvelope.approvalPolicy,...'approvalsReviewer'in settingsEnvelope?{approvalsReviewer:settingsEnvelope.approvalsReviewer}:{},...settingsEnvelope.activePermissionProfile!==undefined?{activePermissionProfile:settingsEnvelope.activePermissionProfile}:{},sandbox:settingsEnvelope.sandbox,environments:settingsEnvelope.thread.environments};
   const ownerData=owner.data,goal=input.owner.kind==='assetJob'?String(ownerData.target||''):String(ownerData.description||''),analysis=referencePlanAnalysisPrompt({ownerKind:input.owner.kind,ownerName:owner.name,goal,inclusions:ownerData.inclusions||[],exclusions:ownerData.exclusions||[],dimensions:ownerData.dimensions||'',crop:ownerData.sourceCrop||null,sourceCount:input.sourcePaths.length,locale:this.store.settings().locale});
   const bindCompletedThread=async()=>{
    if(!newThread||!isCurrent())return;
    const readThread=this.context.readThreadById||readCodexThreadMetadataByIdAsync;
    let index=await readThread(sessionId);
    // Codex persists routing asynchronously. Keep the finished turn alive while its exact UUID appears.
    for(const delay of [150,300,600,1000,1500]){
     if(!index.available||index.threads.length||!isCurrent())break;
     await new Promise(resolve=>setTimeout(resolve,delay));
     index=await readThread(sessionId);
    }
    const verified=findBoundAetherflowCodexThread(index,sessionId,scope.cwd,{kind:input.owner.kind,id:input.owner.id,scope,origin});
    const latest=this.owner(input.owner.kind,input.owner.id),latestState=referencePlanState(latest),latestSnapshot=referencePlanSnapshot(this.store,input.owner.kind,input.owner.id);
    if(isCurrent()&&verified.ok&&latestState.run?.id===input.runId&&latestState.enabled&&latestSnapshot.lineageHash===input.lineageHash&&!currentSession(latest)?.sessionId){
     if(input.owner.kind==='assetJob')bindAetherflowAssetJobSession(this.store,input.owner.id,latest.revision,null,origin!);
     else if(this.context.bindCharacterSession)await this.context.bindCharacterSession(this.store,input.owner.id,latest.revision,null,origin!);
    }
   };
   let accepted=false;
   let result:Awaited<ReturnType<ReferenceCodexSession['runAnalysis']>>;
   try{
    result=await client.runAnalysis({threadId:sessionId,cwd:scope.cwd,imagePaths:attachments.paths,prompt:analysis,model:referencePlanAstraModel,restoreSettings,onTurnStarted:()=>{accepted=true;}});
   }catch(error){
    if(accepted)await bindCompletedThread();
    throw error;
   }
   await bindCompletedThread();
   if(!isCurrent())throw Object.assign(new Error('Workspace changed before the completed plan could be saved.'),{code:'WORKSPACE_STALE'});
   const markdown=validateReferencePlanMarkdown(input.owner.kind,result.markdown),latest=this.owner(input.owner.kind,input.owner.id),latestSnapshot=referencePlanSnapshot(this.store,input.owner.kind,input.owner.id),latestState=referencePlanState(latest);
   if(latestState.run?.id!==input.runId||latestSnapshot.lineageHash!==input.lineageHash||!latestState.enabled){this.persistHistoricalRun(latest,input.owner.kind,latestSnapshot.lineageHash===input.lineageHash?latestSnapshot:snapshot,markdown,input.runId,input.lineageHash,'stale',sessionId,'Source or plan selection changed before Astra completed.');return {started:true,advanced:false,stale:true,state:this.get(input.owner.kind,input.owner.id)};}
   const artifact=this.persistVersion(latest,input.owner.kind,latestSnapshot,markdown,'astra',input.runId),after=this.owner(input.owner.kind,input.owner.id),afterState=referencePlanState(after);if(afterState.run?.id!==input.runId||!isCurrent())return {started:true,advanced:false,stale:true,artifact,state:this.get(input.owner.kind,input.owner.id)};
   this.saveState(after,{...afterState,enabled:true,currentArtifactId:artifact.id,currentLineageHash:input.lineageHash,run:{...afterState.run,status:'ready',updatedAt:new Date().toISOString(),sessionId,artifactId:artifact.id,message:undefined},history:[...afterState.history,{runId:input.runId,status:'ready',artifactId:artifact.id,lineageHash:input.lineageHash,finishedAt:new Date().toISOString()}].slice(-1000)});
   this.notifyPlanSaved(input.owner,artifact.id);
   const current=this.owner(input.owner.kind,input.owner.id),currentState=referencePlanState(current);let advanced=false,resultState:unknown;
   if(isCurrent()&&currentState.run?.id===input.runId&&currentState.enabled&&latestSnapshot.lineageHash===input.lineageHash){resultState=this.advance(input.owner.kind,input.owner.id,input.lineageHash,input.workspace,input.workspaceInstanceId,latestSnapshot);advanced=true;}
   return {started:true,advanced,result:resultState,artifact,state:this.get(input.owner.kind,input.owner.id)};
  }catch(error){const message=error instanceof Error?error.message:String(error);try{const owner=this.owner(input.owner.kind,input.owner.id),state=referencePlanState(owner);if(state.run?.id===input.runId){const status=(error as any)?.code==='WORKSPACE_STALE'?'stale':'error';this.saveState(owner,{...state,run:{...state.run,status,updatedAt:new Date().toISOString(),message:message.slice(0,2000)},history:[...state.history,{runId:input.runId,status:status==='stale'?'stale':'error',lineageHash:input.lineageHash,finishedAt:new Date().toISOString()}].slice(-1000)});}}catch{/* Retain the persisted running record; reopening marks it interrupted. */}throw error;
  }finally{server?.close();attachments?.cleanup();}
 }
 private notifyPlanSaved(owner:OwnerRef,artifactId:string){
  try{this.context.onPlanSaved?.(owner,artifactId);}catch{/* The saved plan remains available if notification delivery fails. */}
 }
 private persistVersion(owner:Entity,kind:ReferencePlanOwnerKind,snapshot:ReturnType<typeof referencePlanSnapshot>,markdown:string,source:'manual'|'astra',runId?:string){
  const bytes=Buffer.from(markdown,'utf8'),registered=this.store.registerImmutableBytes(bytes,'text/markdown'),previous=referencePlanState(owner).currentArtifactId||undefined,artifactId=id(),now=new Date().toISOString(),relative=path.join('work',kind==='assetJob'?'assets':'characters',owner.id,'reference-plans',`${artifactId}.md`).replace(/\\/g,'/'),file=path.resolve(this.store.root,...relative.split('/'));
  let createdFile=false;
  try{
   const root=fs.realpathSync.native(this.store.root),parts=relative.split('/').slice(0,-1);let folder=root;
   for(const part of parts){folder=path.join(folder,part);if(!fs.existsSync(folder))fs.mkdirSync(folder);const stat=fs.lstatSync(folder);if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync.native(folder)!==folder)throw new Error('The owner reference-plan folder is unsafe.');}
   if(!folder.startsWith(`${root}${path.sep}`))throw new Error('The owner reference-plan folder is outside this workspace.');
   fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});createdFile=true;if(sha(fs.readFileSync(file))!==registered.hash)throw new Error('The readable reference-plan file failed integrity verification.');
   return this.store.transaction(()=>{this.owner(kind,owner.id);const artifact=this.store.assetProductionPut({id:artifactId,kind:'artifact',name:`${owner.name} reference plan v${new Date(now).toISOString().slice(0,10)}`,data:{hash:registered.hash,bytes:registered.bytes,mime:'text/markdown',sourceName:'reference-plan.md',logicalPath:relative,parentId:owner.id,ownerKind:kind,sourceInputHash:snapshot.lineageHash,sourceHash:snapshot.sourceHash,versionOf:previous,immutableVersion:true,planSource:source,...runId?{runId}:{},createdAt:now}});this.store.link(owner.id,artifact.id,'reference plan');return artifact;});
  }catch(error){if(createdFile){try{const stat=fs.lstatSync(file),real=fs.realpathSync.native(file);if(stat.isFile()&&!stat.isSymbolicLink()&&real===file&&file.startsWith(`${fs.realpathSync.native(this.store.root)}${path.sep}`)&&sha(fs.readFileSync(file))===registered.hash)fs.rmSync(file);}catch{}}throw error;}
 }
 private persistHistoricalRun(owner:Entity,kind:ReferencePlanOwnerKind,snapshot:ReturnType<typeof referencePlanSnapshot>,markdown:string,runId:string,lineageHash:string,status:'stale',sessionId:string,message:string){
  const artifact=this.persistVersion(owner,kind,snapshot,markdown,'astra',runId),latest=this.owner(kind,owner.id),state=referencePlanState(latest);if(state.run?.id===runId)this.saveState(latest,{...state,run:{...state.run,status,updatedAt:new Date().toISOString(),sessionId,artifactId:artifact.id,message},history:[...state.history,{runId,status,artifactId:artifact.id,lineageHash,finishedAt:new Date().toISOString()}].slice(-1000)});return artifact;
 }
 private saveState(owner:Entity,state:unknown){const data={...owner.data,referencePlan:ReferencePlanStateSchema.parse(state)};if(owner.kind==='assetJob')return this.store.assetProductionPut({id:owner.id,kind:'assetJob',name:owner.name,data:AssetJobDataSchema.parse(data),expectedRevision:owner.revision});return this.store.put({id:owner.id,kind:'character',name:owner.name,data,expectedRevision:owner.revision});}
 private advance(kind:ReferencePlanOwnerKind,ownerId:string,lineageHash:string,workspace:string,instance:string,knownSnapshot?:ReturnType<typeof referencePlanSnapshot>){this.checkWorkspace(workspace,instance);const snapshot=knownSnapshot||referencePlanSnapshot(this.store,kind,ownerId);if(snapshot.lineageHash!==lineageHash||!activeReferencePlan(this.store,kind,ownerId,snapshot))throw Object.assign(new Error('The saved plan no longer matches this owner’s source and brief.'),{code:'REVISION_CONFLICT'});const owner=this.owner(kind,ownerId);this.sourceStage(owner,kind);if(this.context.advance)return this.context.advance(this.store,{kind,id:ownerId});if(kind==='assetJob')return new AssetProductionService(this.store).update({id:ownerId,expectedRevision:owner.revision,stage:'composition'});throw new Error('The guided character transition handler is unavailable.');}
}
