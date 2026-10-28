import {call} from './api';
import type {Entity} from '../shared/contracts';
import {flushTaskChecklistMutations} from './taskChecklistMutations';

export type TaskCompletionOutcome={ok:true;task:Entity}|{ok:false;error:{message:string;code?:string}};
export type TaskCompletionBlocker={id:string;name:string;status?:string;missing?:boolean};

export function taskCompletionBlockers(task:Entity,tasks:readonly Entity[]):TaskCompletionBlocker[]{
  const dependencies=Array.isArray(task.data.dependencyIds)?task.data.dependencyIds:Array.isArray(task.data.dependsOn)?task.data.dependsOn:[];
  const rows:TaskCompletionBlocker[]=dependencies.filter((id:unknown):id is string=>typeof id==='string').map(id=>{const dependency=tasks.find(item=>item.id===id&&item.kind==='task');return dependency?{id,name:dependency.name,status:String(dependency.data.status||'To do'),missing:false}:{id,name:`Missing task (${id})`,missing:true};});
  for(const child of tasks.filter(item=>item.kind==='task'&&item.data.parentTaskId===task.id&&item.data.status!=='Done'))rows.push({id:child.id,name:child.name,status:String(child.data.status||'To do')});
  return [...new Map(rows.map(row=>[row.id,row])).values()];
}

export async function completeTask(taskId:string):Promise<TaskCompletionOutcome>{
  if(!await flushTaskChecklistMutations())return {ok:false,error:{message:'Pending checklist changes could not be saved.',code:'CHECKLIST_SAVE_FAILED'}};
  const current=await call({op:'get',kind:'task',id:taskId});
  if(!current.ok)return {ok:false,error:current.error};
  if(current.data.data.status==='Done')return {ok:true,task:current.data as Entity};
  const saved=await call({op:'put',entity:{id:current.data.id,kind:'task',name:current.data.name,data:{...current.data.data,status:'Done',progress:100},expectedRevision:current.data.revision}});
  return saved.ok?{ok:true,task:saved.data as Entity}:{ok:false,error:saved.error};
}
