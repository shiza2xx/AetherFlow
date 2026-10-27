import {call} from './api';
import type {Entity} from '../shared/contracts';
import {flushTaskChecklistMutations} from './taskChecklistMutations';

export type TaskCompletionOutcome={ok:true;task:Entity}|{ok:false;error:{message:string;code?:string}};

export async function completeTask(taskId:string):Promise<TaskCompletionOutcome>{
  if(!await flushTaskChecklistMutations())return {ok:false,error:{message:'Pending checklist changes could not be saved.',code:'CHECKLIST_SAVE_FAILED'}};
  const current=await call({op:'get',kind:'task',id:taskId});
  if(!current.ok)return {ok:false,error:current.error};
  if(current.data.data.status==='Done')return {ok:true,task:current.data as Entity};
  const saved=await call({op:'put',entity:{id:current.data.id,kind:'task',name:current.data.name,data:{...current.data.data,status:'Done',progress:100},expectedRevision:current.data.revision}});
  return saved.ok?{ok:true,task:saved.data as Entity}:{ok:false,error:saved.error};
}
