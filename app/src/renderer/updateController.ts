import {useSyncExternalStore} from 'react';
import type {UpdateStatus} from '../main/app-updater';
export type UpdateAction='updates:check'|'updates:download'|'updates:apply';
type Snapshot={status:UpdateStatus;visible:boolean;busy:UpdateAction|null;failedAction:UpdateAction|null};
let snapshot:Snapshot={status:{phase:'idle',currentVersion:'',canApply:false},visible:false,busy:null,failedAction:null};
const listeners=new Set<()=>void>();let serviceRevision=0;
function publish(patch:Partial<Snapshot>){snapshot={...snapshot,...patch};for(const listener of listeners)listener();}
export const getUpdateSnapshot=()=>snapshot;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener)}};
export function useUpdateSnapshot(){return useSyncExternalStore(subscribe,getUpdateSnapshot);}
function receive(status:UpdateStatus){
 publish({status});
}
export function mountUpdateService(){
 const revision=++serviceRevision,off=window.atelier.onUpdateStatus((next:UpdateStatus)=>{if(revision===serviceRevision)receive(next)});
 void window.atelier.call({op:'updates:get'}).then((result:any)=>{if(revision===serviceRevision&&result.ok)receive(result.data)});
 return()=>{if(revision===serviceRevision)serviceRevision++;off()};
}
export function dismissUpdate(){if(snapshot.visible)publish({visible:false});}
export function showUpdate(){publish({visible:true});if(snapshot.status.phase==='idle')void runUpdateAction('updates:check');}
export async function runUpdateAction(op:UpdateAction){
 if(snapshot.busy||['checking','downloading','verifying','applying'].includes(snapshot.status.phase))return;
 publish({busy:op,failedAction:null});
 try{const result=await window.atelier.call({op});if(!result.ok)throw new Error(result.error.message);receive(result.data as UpdateStatus);if((result.data as UpdateStatus).phase==='error')publish({failedAction:op});}
 catch(error){publish({status:{...snapshot.status,phase:'error',message:error instanceof Error?error.message:String(error)},failedAction:op});}
 finally{publish({busy:null});}
}
let cancelling=false;
export async function cancelUpdate(){if(cancelling)return;cancelling=true;try{const result=await window.atelier.call({op:'updates:cancel'});if(!result.ok)throw new Error(result.error.message);receive(result.data as UpdateStatus);}catch(error){publish({status:{...snapshot.status,message:error instanceof Error?error.message:String(error)}});}finally{cancelling=false;}}
