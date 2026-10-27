import {call} from './api';
import type {Entity} from '../shared/contracts';
import {reconcileChecklist} from './taskChecklistReconcile';
import type {ChecklistItem} from './taskChecklistReconcile';

export {reconcileChecklist} from './taskChecklistReconcile';
export type {ChecklistItem} from './taskChecklistReconcile';
type Outcome={ok:true;task:Entity}|{ok:false;error:any;task?:Entity};
const queues=new Map<string,Promise<void>>();

export async function flushTaskChecklistMutations():Promise<boolean>{
  const pending=[...queues.values()];
  if(!pending.length)return true;
  await Promise.all(pending);
  return queues.size===0;
}

export function mutateTaskChecklist(taskId:string,change:(items:ChecklistItem[])=>ChecklistItem[]):Promise<Outcome>{
  const previous=queues.get(taskId)||Promise.resolve();
  const operation=previous.then(async():Promise<Outcome>=>{
    const current=await call({op:'get',kind:'task',id:taskId});
    if(!current.ok)return {ok:false,error:current.error};
    const before=Array.isArray(current.data.data.checklist)?current.data.data.checklist as ChecklistItem[]:[];
    const next=change(before);
    const wasComplete=before.length>0&&before.every(item=>item.completed),isComplete=next.length>0&&next.every(item=>item.completed);
    const reopens=current.data.data.status==='Done'&&wasComplete&&!isComplete;
    const saved=await call({op:'put',entity:{id:current.data.id,kind:'task',name:current.data.name,data:{...current.data.data,checklist:next,...(reopens?{status:'To do'}:{})},expectedRevision:current.data.revision}});
    return saved.ok?{ok:true,task:saved.data as Entity}:{ok:false,error:saved.error,task:current.data as Entity};
  }).catch((error):Outcome=>({ok:false,error:{message:String(error?.message||error),code:'CHECKLIST_SAVE_FAILED'}}));
  const settled=operation.then(()=>undefined,()=>undefined);
  queues.set(taskId,settled);
  void settled.then(()=>{if(queues.get(taskId)===settled)queues.delete(taskId);});
  return operation;
}

