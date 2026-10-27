import type {Rpc} from '../shared/contracts';
let tail:Promise<unknown>=Promise.resolve(),generation=0,worker:Worker|undefined,cancelDecode:(()=>void)|undefined;
if(typeof window!=='undefined')window.atelier.onWorkspaceChanged(()=>{generation++;cancelDecode?.();worker?.terminate();worker=undefined;});
function decode(bytes:ArrayBuffer,mime:string):Promise<ArrayBuffer>{
  worker??=new Worker(new URL('./image-preview.worker.ts',import.meta.url),{type:'module'});
  const active=worker;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{active.terminate();if(worker===active)worker=undefined;reject(new Error('Image preview timed out. Please retry.'));},20000);
    cancelDecode=()=>{clearTimeout(timeout);reject(new Error('Workspace changed.'));};
    active.onmessage=event=>{clearTimeout(timeout);cancelDecode=undefined;if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.bytes);};
    active.onerror=()=>{clearTimeout(timeout);active.terminate();if(worker===active)worker=undefined;reject(new Error('Image preview failed. Please retry.'));};
    active.postMessage({bytes,mime},[bytes]);
  });
}
export function call(rpc:Rpc):Promise<any>{
  if(rpc.op!=='asset:thumbnail'&&rpc.op!=='file:gallery-preview')return window.atelier.call(rpc);
  const started=generation;
  const run=async()=>{
    if(started!==generation)return {ok:false,error:{message:'Workspace changed.'}};
    try{
      const response=await window.atelier.call(rpc);if(started!==generation)throw new Error('Workspace changed.');if(!response.ok||response.data.url)return response;
      const {sourceKey,mime,base64}=response.data;
      const raw=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));
      const png=await decode(raw.buffer,mime);
      if(started!==generation)throw new Error('Workspace changed.');
      // PNG is at most 360x240; avoid spreading it on the JS call stack.
      let binary='';for(const byte of new Uint8Array(png))binary+=String.fromCharCode(byte);
      return await window.atelier.call({op:'image-preview:commit',sourceKey,base64:btoa(binary)});
    }catch(error){return {ok:false,error:{message:error instanceof Error?error.message:'Image preview failed.'}};}
  };
  const result=tail.then(run,run);tail=result.catch(()=>undefined);return result;
}
