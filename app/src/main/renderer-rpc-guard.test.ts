import {describe,expect,it} from 'vitest';
import {assertRendererWorkspaceTransitionCanStart} from './renderer-rpc-guard';

describe('renderer workspace transition guard',()=>{
 it('blocks a workspace switch while async settings validation is still pending, then releases it',async()=>{
  let active=0,finishValidation:(()=>void)|undefined;
  const begin=()=>{active+=1;let released=false;return ()=>{if(!released){released=true;active-=1;}};};
  const settingsRelease=begin();
  const settingsRequest=new Promise<void>(resolve=>{finishValidation=()=>{settingsRelease();resolve();};});
  const switchRelease=begin();
  expect(()=>assertRendererWorkspaceTransitionCanStart(active)).toThrow(expect.objectContaining({code:'WORKSPACE_BUSY'}));
  expect(active).toBe(2);
  switchRelease();
  finishValidation!();
  await settingsRequest;
  expect(active).toBe(0);
  expect(()=>assertRendererWorkspaceTransitionCanStart(active)).not.toThrow();
 });
});
