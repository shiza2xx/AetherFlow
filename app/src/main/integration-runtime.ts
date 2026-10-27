import path from 'node:path';
import type {AtelierStore} from './store';
import {resolveCodexRuntime,preflightCodexRuntime,type CodexRuntime} from './codex-launch';
let tail:Promise<unknown>=Promise.resolve();
const cache=new Map<string,{expires:number;value:CodexRuntime}>();
export function repairLegacyNodeSetting(store:AtelierStore){
  const settings=store.settings();
  if(!settings.nodePath||/^electron(?:\.exe)?$/i.test(path.basename(settings.nodePath))){
    const runtime=resolveCodexRuntime(settings);
    if(runtime.node)return store.setSettings({nodePath:runtime.node});
  }
  return settings;
}
export function integrationRuntime(settings:{codexPath:string;nodePath:string}):Promise<CodexRuntime>{
  const key=JSON.stringify([settings.codexPath,settings.nodePath]);
  const run=async()=>{
    const saved=cache.get(key);if(saved&&saved.expires>Date.now())return saved.value;
    const value=await preflightCodexRuntime(resolveCodexRuntime(settings));
    cache.clear();cache.set(key,{expires:Date.now()+30000,value});return value;
  };
  const result=tail.then(run,run);tail=result.catch(()=>undefined);return result;
}
