import {useSyncExternalStore} from 'react';
import type {UpdateStatus} from '../main/app-updater';
export type UpdateAction='updates:check'|'updates:download'|'updates:apply';
type Snapshot={status:UpdateStatus;visible:boolean;busy:UpdateAction|null;failedAction:UpdateAction|null};
let snapshot:Snapshot={status:{phase:'idle',currentVersion:'',canApply:false},visible:false,busy:null,failedAction:null};
const listeners=new Set<()=>void>();let dismissed=false,serviceRevision=0;
function publish(patch:Partial<Snapshot>){snapshot={...snapshot,...patch};for(const listener of listeners)listener();}
export const getUpdateSnapshot=()=>snapshot;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export function useUpdateSnapshot(){return useSyncExternalStore(subscribe,getUpdateSnapshot);}
function receive(status:UpdateStatus){
 const automatic=status.checkSource==='startup';
 const decision=['available','downloading','verifying','downloaded','applying','error','cancelled'].includes(status.phase);
 publish({status,visible:!dismissed&&(decision||snapshot.visible||status.phase==='checking'&&!automatic||status.phase==='current'&&!automatic)});
}
export function mountUpdateService(){
 const revision=++serviceRevision,off=window.atelier.onUpdateStatus((next:UpdateStatus)=>{if(revision===serviceRevision)receive(next)});
 void window.atelier.call({op:'updates:get'}).then((result:any)=>{if(revision===serviceRevision&&result.ok)receive(result.data)});
 return()=>{if(revision===serviceRevision)serviceRevision++;off()};
}
export function dismissUpdate(){dismissed=true;publish({visible:false});}
export function showUpdate(){dismissed=false;publish({visible:true});if(snapshot.status.phase==='idle')void runUpdateAction('updates:check');}
export async function runUpdateAction(op:UpdateAction){
 if(snapshot.busy||['checking','downloading','verifying','applying'].includes(snapshot.status.phase))return;
 dismissed=false;publish({visible:true,busy:op,failedAction:null});
 try{const result=await window.atelier.call({op});if(!result.ok)throw new Error(result.error.message);receive(result.data as UpdateStatus);if((result.data as UpdateStatus).phase==='error')publish({failedAction:op});}
 catch(error){publish({status:{...snapshot.status,phase:'error',message:error instanceof Error?error.message:String(error)},failedAction:op,visible:true});}
 finally{publish({busy:null});}
}
let cancelling=false;
export async function cancelUpdate(){if(cancelling)return;cancelling=true;try{const result=await window.atelier.call({op:'updates:cancel'});if(!result.ok)throw new Error(result.error.message);receive(result.data as UpdateStatus);}catch(error){publish({status:{...snapshot.status,message:error instanceof Error?error.message:String(error)},visible:true});}finally{cancelling=false;}}
