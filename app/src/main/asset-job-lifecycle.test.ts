import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {AtelierStore} from './store';
import {AssetProductionService} from './asset-production';

const roots:string[]=[],stores:AtelierStore[]=[];
afterEach(()=>{for(const store of stores.splice(0))try{store.db.close();}catch{}for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function createStore(){const base=path.resolve('evidence/assets-job-lifecycle/test-workspaces');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'delete-'));roots.push(root);const store=new AtelierStore(root,path.join(root,'key'));stores.push(store);return {root,store};}

describe('asset project deletion lifecycle',()=>{
 it('soft deletes one job, preserves its linked records, hides it from active work, and restores it',()=>{
  const {root,store}=createStore(),service=new AssetProductionService(store),first=service.create({name:'Delete only this project',mode:'composite',target:'One prop'}),other=service.create({name:'Keep this project',mode:'prop-set',target:'Another prop'}),item=store.assetProductionPut({kind:'assetItem',id:crypto.randomUUID(),name:'Retained item',data:{schemaVersion:1,jobId:first.job.id,route:'module',views:['front'],depthEnabled:false}});
  store.link(first.job.id,item.id,'asset item');
  const preview=service.deletePreview(first.job.id,first.job.revision,root);
  expect(preview).toMatchObject({assetJobId:first.job.id,assetJobName:first.job.name,itemCount:1,historyRetained:true,linkedRecordsRetained:true,filesRetained:true});
  expect(()=>service.deletePreview(first.job.id,first.job.revision,`${root}-other`)).toThrow(/different workspace/i);
  expect(()=>service.deletePreview(first.job.id,first.job.revision+1,root)).toThrow(/changed/i);
  const deleted=service.delete(first.job.id,preview.expectedRevision,root);
  expect(deleted.data.deletedAt).toBeTruthy();
  expect(service.list().map(job=>job.id)).toEqual([other.job.id]);
  expect(service.listDeleted().map(job=>job.id)).toEqual([first.job.id]);
  expect(store.get('assetItem',item.id)).toEqual(item);
  expect(store.get('workflow',first.workflow.id)).toBeTruthy();
  expect(()=>service.get(first.job.id)).toThrow(/Deleted/i);
  expect(()=>store.assetProductionPut({id:first.job.id,kind:'assetJob',name:deleted.name,data:{...deleted.data,target:'must stay unchanged'},expectedRevision:deleted.revision})).toThrow(/restored/i);
  expect(service.restore(first.job.id,deleted.revision,root).data.deletedAt).toBeUndefined();
  expect(service.get(first.job.id).job.data.target).toBe('One prop');
  expect(service.list().map(job=>job.id).sort()).toEqual([first.job.id,other.job.id].sort());
 });
});
