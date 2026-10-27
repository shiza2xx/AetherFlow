import {codexIndexUninitialized,findBoundCodexThread, findNewCodexThreadAsync, normalizedSessionPath, readCodexThreadByIdAsync, readCodexThreadsAsync, sessionScope, type SessionIndexResult} from './codex-session';
import type {AtelierStore} from './store';
import type {Entity} from '../shared/contracts';

export type OwnerSessionScope={host:string;profile:string;cwd:string};
export type OwnerSessionBinding={sessionId:string;scope:OwnerSessionScope;verifiedAt:string};
export type ProjectSessionState={history:OwnerSessionBinding[];current?:OwnerSessionBinding;pendingLaunch?:{startedAtMs:number;deadlineMs:number;baselineIds:string[];scope:OwnerSessionScope};launchHistory?:Array<{pending:{startedAtMs:number;deadlineMs:number;baselineIds:string[];scope:OwnerSessionScope};finishedAt:string;reason:string}>};
export type ProjectSessionReaders={readById?:(sessionId:string)=>Promise<SessionIndexResult>;readAll?:()=>Promise<SessionIndexResult>;findNew?:(options:{cwd:string;startedAtMs:number;deadlineMs:number;baselineIds:string[]})=>Promise<{index:SessionIndexResult;thread:SessionIndexResult['threads'][number]|null}>;now?:()=>number};

const SESSION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const samePath=(left:string,right:string)=>normalizedSessionPath(left)===normalizedSessionPath(right);

export function verifyProjectSessionBinding(value:unknown,index:SessionIndexResult,expected:OwnerSessionScope){
 const binding=value as OwnerSessionBinding|null|undefined;
 if(!binding)return {state:'unbound' as const,sessionId:null as string|null};
 if(typeof binding.sessionId!=='string'||!SESSION_ID.test(binding.sessionId)||!binding.scope||typeof binding.scope.host!=='string'||typeof binding.scope.profile!=='string'||typeof binding.scope.cwd!=='string')
  return {state:'invalid' as const,reason:'The saved project Codex session binding is malformed.'};
 if(binding.scope.host!==expected.host||!samePath(binding.scope.profile,expected.profile)||!samePath(binding.scope.cwd,expected.cwd))
  return {state:'invalid' as const,reason:'The bound project session belongs to another host, Codex profile, or project directory. No completed owner migration proves this path change.'};
 const verified=findBoundCodexThread(index,binding.sessionId,expected.cwd);
 return verified.ok?{state:'bound' as const,sessionId:binding.sessionId}:{state:'invalid' as const,reason:verified.reason};
}

export function nextProjectSessionState(previous:unknown,scope:OwnerSessionScope,sessionId:string,verifiedAt=new Date().toISOString()):ProjectSessionState{
 if(!SESSION_ID.test(sessionId))throw new Error('Project Codex session ID is invalid.');
 const old=(previous&&typeof previous==='object'?previous:{}) as Partial<ProjectSessionState>,history=Array.isArray(old.history)?old.history.filter(row=>row&&SESSION_ID.test(String(row.sessionId))):[];
 if(old.current&&old.current.sessionId!==sessionId)history.push(old.current);
 return {history,current:{sessionId,scope,verifiedAt},...(Array.isArray(old.launchHistory)?{launchHistory:old.launchHistory}:{})};
}

export function projectSessionPendingMatches(pending:unknown,expected:OwnerSessionScope){
 const value=pending as ProjectSessionState['pendingLaunch']|undefined;
 return !!value&&Number.isFinite(value.startedAtMs)&&Number.isFinite(value.deadlineMs)&&Array.isArray(value.baselineIds)&&value.scope?.host===expected.host&&samePath(String(value.scope?.profile||''),expected.profile)&&samePath(String(value.scope?.cwd||''),expected.cwd);
}

const stateOf=(project:Entity)=>((project.data.codexSession||{}) as ProjectSessionState);
const saveState=(store:AtelierStore,project:Entity,state:ProjectSessionState)=>store.put({id:project.id,kind:'project',name:project.name,data:{...project.data,codexSession:state},expectedRevision:project.revision});
function assertProjectSessionRecord(value:unknown){
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('The saved project Codex session record is malformed.'),{code:'SESSION_RECOVERY_REQUIRED'});
 const record=value as Partial<ProjectSessionState>;
 if(record.history!==undefined&&!Array.isArray(record.history)||record.current!==undefined&&(!record.current||typeof record.current!=='object')||record.pendingLaunch!==undefined&&(!record.pendingLaunch||typeof record.pendingLaunch!=='object'))throw Object.assign(new Error('The saved project Codex session record is malformed.'),{code:'SESSION_RECOVERY_REQUIRED'});
 if(record.current&&(typeof record.current.sessionId!=='string'||!SESSION_ID.test(record.current.sessionId)||!record.current.scope||typeof record.current.scope.host!=='string'||typeof record.current.scope.profile!=='string'||typeof record.current.scope.cwd!=='string'))throw Object.assign(new Error('The saved project Codex session binding is malformed.'),{code:'SESSION_RECOVERY_REQUIRED'});
 if(record.pendingLaunch&&(!Number.isFinite(record.pendingLaunch.startedAtMs)||!Number.isFinite(record.pendingLaunch.deadlineMs)||!Array.isArray(record.pendingLaunch.baselineIds)||record.pendingLaunch.baselineIds.some(id=>typeof id!=='string')||!record.pendingLaunch.scope||typeof record.pendingLaunch.scope.host!=='string'||typeof record.pendingLaunch.scope.profile!=='string'||typeof record.pendingLaunch.scope.cwd!=='string'))throw Object.assign(new Error('The saved project Codex launch record is malformed.'),{code:'SESSION_RECOVERY_REQUIRED'});
}

export async function prepareProjectCodexSession(store:AtelierStore,project:Entity,work:string,readers:ProjectSessionReaders={},options:{allowExpiredRetry?:boolean}={}){
 assertProjectSessionRecord(project.data.codexSession);const expected=sessionScope(work),state=stateOf(project);
 if(state.current){
  const index=await (readers.readById||readCodexThreadByIdAsync)(state.current.sessionId);
  const result=verifyProjectSessionBinding(state.current,index,expected);
  if(result.state!=='bound')throw Object.assign(new Error(result.reason||'The project Codex session could not be verified.'),{code:'SESSION_RECOVERY_REQUIRED'});
  return {sessionId:result.sessionId,pending:null as null,project};
 }
 if(state.pendingLaunch&&!projectSessionPendingMatches(state.pendingLaunch,expected))
  throw Object.assign(new Error('A pending project Codex launch belongs to another host, profile, or project directory. It needs explicit recovery before starting another chat.'),{code:'SESSION_RECOVERY_REQUIRED'});
 if(state.pendingLaunch&&projectSessionPendingMatches(state.pendingLaunch,expected)){
  const pending=state.pendingLaunch!,found=await (readers.findNew||findNewCodexThreadAsync)({cwd:expected.cwd,startedAtMs:pending.startedAtMs,deadlineMs:pending.deadlineMs,baselineIds:pending.baselineIds}),foundIndex:SessionIndexResult=found.index.available?found.index:!readers.findNew&&codexIndexUninitialized(expected.profile)?{available:true,threads:[]}:found.index;
  if(!foundIndex.available)throw Object.assign(new Error(foundIndex.reason||'The existing project session could not be checked in the local Codex index.'),{code:'SESSION_RECOVERY_REQUIRED'});
  if(foundIndex.threads.length>1)throw Object.assign(new Error('More than one new Codex session matches this project. No session was selected; review local thread metadata before starting another.'),{code:'SESSION_RECOVERY_REQUIRED'});
  let recovered=found.thread;
  if(!recovered){
   // The first real user message may appear after the short startup discovery window (or after restart).
   // Keep the original launch intent and inspect exact-cwd metadata beyond its advisory deadline;
   // never replace an unresolved launch with a fresh session.
   const readAll=await (readers.readAll||readCodexThreadsAsync)(),all:SessionIndexResult=readAll.available?readAll:!readers.readAll&&codexIndexUninitialized(expected.profile)?{available:true,threads:[]}:readAll;if(!all.available)throw Object.assign(new Error(all.reason||'The pending project session is unresolved; its local Codex index could not be checked.'),{code:'SESSION_RECOVERY_REQUIRED'});
   const baseline=new Set(pending.baselineIds),late=all.threads.filter(thread=>thread.source==='cli'&&!thread.archived&&!baseline.has(thread.id)&&Number.isFinite(thread.createdAtMs)&&thread.createdAtMs>=pending.startedAtMs&&threadCwdMatchesSafe(thread.cwd,expected.cwd));
   if(late.length>1)throw Object.assign(new Error('More than one new Codex session matches this pending project launch. No session was selected; review local thread metadata before starting another.'),{code:'SESSION_RECOVERY_REQUIRED'});
   recovered=late[0]||null;
  }
  if(recovered){
   const valid=findBoundCodexThread({available:true,threads:[recovered]},recovered.id,expected.cwd);
   if(!valid.ok)throw Object.assign(new Error(valid.reason),{code:'SESSION_RECOVERY_REQUIRED'});
   const latest=store.get('project',project.id);if(!latest)throw new Error('Terminal project was not found.');
   const latestState=stateOf(latest);if(JSON.stringify(latestState.pendingLaunch)!==JSON.stringify(pending))throw Object.assign(new Error('Project session intent changed during verification.'),{code:'REVISION_CONFLICT'});
   const next=nextProjectSessionState(latestState,expected,recovered.id),saved=saveState(store,latest,next);
   return {sessionId:recovered.id,pending:null as null,project:saved};
  }
  const now=(readers.now||Date.now)();
  if(options.allowExpiredRetry===true&&now>pending.deadlineMs){
   const latest=store.get('project',project.id),latestState=latest?stateOf(latest):undefined;
   if(!latest||latest.revision!==project.revision||JSON.stringify(latestState?.pendingLaunch)!==JSON.stringify(pending))throw Object.assign(new Error('Project session intent changed during recovery. Refresh before opening Codex.'),{code:'REVISION_CONFLICT'});
   const freshRead=await (readers.readAll||readCodexThreadsAsync)(),freshIndex:SessionIndexResult=freshRead.available?freshRead:!readers.readAll&&codexIndexUninitialized(expected.profile)?{available:true,threads:[]}:freshRead;
   if(!freshIndex.available)throw Object.assign(new Error(freshIndex.reason||'The previous project session could not be rechecked. Retry verification before starting another chat.'),{code:'SESSION_RECOVERY_REQUIRED'});
   const baseline=new Set(pending.baselineIds),arrived=freshIndex.threads.filter(thread=>Number.isFinite(thread.createdAtMs)&&thread.createdAtMs>=pending.startedAtMs&&!baseline.has(thread.id)&&threadCwdMatchesSafe(thread.cwd,expected.cwd));
   if(arrived.length>1)throw Object.assign(new Error('More than one new Codex session matches this pending project launch. No session was selected; review local thread metadata before starting another.'),{code:'SESSION_RECOVERY_REQUIRED'});
   if(arrived.length===1){
    const candidate=arrived[0];
    if(candidate.source.toLowerCase()!=='cli'||candidate.archived)throw Object.assign(new Error('A possible project session appeared during recovery, but its source is archived or not the Codex CLI. Review local thread metadata before starting another.'),{code:'SESSION_RECOVERY_REQUIRED'});
    const verified=findBoundCodexThread({available:true,threads:[candidate]},candidate.id,expected.cwd);
    if(!verified.ok)throw Object.assign(new Error(verified.reason),{code:'SESSION_RECOVERY_REQUIRED'});
    const latest=store.get('project',project.id),latestState=latest?stateOf(latest):undefined;
    if(!latest||latest.revision!==project.revision||JSON.stringify(latestState?.pendingLaunch)!==JSON.stringify(pending)||latestState?.current)throw Object.assign(new Error('Project session intent changed during recovery. Refresh before opening Codex.'),{code:'REVISION_CONFLICT'});
    const saved=saveState(store,latest,nextProjectSessionState(latestState!,expected,candidate.id));
    return {sessionId:candidate.id,pending:null as null,project:saved};
   }
   const current=store.get('project',project.id),currentState=current?stateOf(current):undefined;
   if(!current||current.revision!==project.revision||JSON.stringify(currentState?.pendingLaunch)!==JSON.stringify(pending)||currentState?.current)throw Object.assign(new Error('Project session intent changed during recovery. Refresh before opening Codex.'),{code:'REVISION_CONFLICT'});
   const startedAtMs=(readers.now||Date.now)(),fresh={startedAtMs,deadlineMs:startedAtMs+10*60_000,baselineIds:freshIndex.threads.filter(thread=>threadCwdMatchesSafe(thread.cwd,expected.cwd)).map(thread=>thread.id),scope:expected};
   const launchHistory=[...(currentState!.launchHistory||[]),{pending,finishedAt:new Date(now).toISOString(),reason:'expired-zero-match-explicit-retry'}];
   const saved=saveState(store,current,{...currentState!,launchHistory,pendingLaunch:fresh});
   return {sessionId:undefined as string|undefined,pending:fresh,project:saved};
  }
  throw Object.assign(new Error('The project launch is unresolved. Retry verification, or explicitly start a separate Codex chat.'),{code:'SESSION_RECOVERY_REQUIRED'});
 }
 const index=await (readers.readAll||readCodexThreadsAsync)();
 if(!index.available&&state.pendingLaunch)throw Object.assign(new Error(index.reason||'The previous project launch is still pending; Codex thread metadata is unavailable.'),{code:'SESSION_RECOVERY_REQUIRED'});
 const baselineIds=index.available?index.threads.filter(thread=>threadCwdMatchesSafe(thread.cwd,expected.cwd)).map(thread=>thread.id):[];
 const startedAtMs=(readers.now||Date.now)(),pending={startedAtMs,deadlineMs:startedAtMs+10*60_000,baselineIds,scope:expected};
 const latest=store.get('project',project.id);if(!latest||latest.revision!==project.revision)throw Object.assign(new Error('The project changed while its Codex session was being checked. Refresh and retry.'),{code:'REVISION_CONFLICT'});
 const saved=saveState(store,latest,{...state,pendingLaunch:pending});
 return {sessionId:undefined as string|undefined,pending,project:saved};
}

function threadCwdMatchesSafe(left:string,right:string){try{return samePath(left,right);}catch{return false;}}

export function finishProjectCodexLaunch(store:AtelierStore,projectId:string,pending:ProjectSessionState['pendingLaunch']){
 const latest=store.get('project',projectId);if(!latest)return null;const state=stateOf(latest);
 if(!pending||JSON.stringify(state.pendingLaunch)!==JSON.stringify(pending))return null;
 return saveState(store,latest,{...state,launchHistory:[...(state.launchHistory||[]),{pending,finishedAt:new Date().toISOString(),reason:'spawn-failed'}],pendingLaunch:undefined});
}

export async function startNewProjectCodexSession(store:AtelierStore,projectId:string,work:string,readers:ProjectSessionReaders={}){
 const project=store.get('project',projectId);if(!project)throw new Error('Terminal project was not found.');assertProjectSessionRecord(project.data.codexSession);
 const latest=store.get('project',projectId);if(!latest||latest.revision!==project.revision)throw Object.assign(new Error('Project session intent changed. Refresh before starting a new chat.'),{code:'REVISION_CONFLICT'});
 const expected=sessionScope(work),state=stateOf(latest),index=await (readers.readAll||readCodexThreadsAsync)(),startedAtMs=(readers.now||Date.now)(),pending={startedAtMs,deadlineMs:startedAtMs+10*60_000,baselineIds:index.available?index.threads.filter(thread=>threadCwdMatchesSafe(thread.cwd,expected.cwd)).map(thread=>thread.id):[],scope:expected};
 const afterRead=store.get('project',projectId);if(!afterRead||afterRead.revision!==latest.revision||JSON.stringify(stateOf(afterRead))!==JSON.stringify(state))throw Object.assign(new Error('Project session intent changed while preparing a separate chat. Refresh before starting again.'),{code:'REVISION_CONFLICT'});
 const history=[...(state.history||[])];if(state.current)history.push({...state.current,verifiedAt:new Date().toISOString()});
 const launchHistory=[...(state.launchHistory||[])];if(state.pendingLaunch)launchHistory.push({pending:state.pendingLaunch,finishedAt:new Date(startedAtMs).toISOString(),reason:'user-started-separate-chat'});
 const saved=saveState(store,latest,{history,current:undefined,pendingLaunch:pending,launchHistory});
 return {project:saved,pending,indexAvailable:index.available};
}

export async function discoverProjectCodexSession(store:AtelierStore,projectId:string,work:string,pending:NonNullable<ProjectSessionState['pendingLaunch']>,isStillOwned:()=>boolean,readers:ProjectSessionReaders={}){
 const expected=sessionScope(work);
 for(let attempt=0;attempt<24;attempt++){
  await new Promise(resolve=>setTimeout(resolve,1500));if(!isStillOwned())return null;
  const found=await (readers.findNew||findNewCodexThreadAsync)({cwd:expected.cwd,startedAtMs:pending.startedAtMs,deadlineMs:pending.deadlineMs,baselineIds:pending.baselineIds});
  if(!found.index.available||found.index.threads.length!==1||!found.thread)continue;
  const verified=findBoundCodexThread(found.index,found.thread.id,expected.cwd);if(!verified.ok)return null;
  const latest=store.get('project',projectId);if(!latest)return null;const state=stateOf(latest);
  if(JSON.stringify(state.pendingLaunch)!==JSON.stringify(pending))return null;
  return saveState(store,latest,nextProjectSessionState(state,expected,found.thread.id));
 }
 return null;
}
