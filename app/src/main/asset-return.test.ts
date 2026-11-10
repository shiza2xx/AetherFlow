import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {AtelierStore} from './store';
import {AssetProductionService} from './asset-production';
import {AssetReturnService} from './asset-return';

const roots:string[]=[],stores:AtelierStore[]=[];
function fixture(){const root=fs.mkdtempSync(path.resolve('evidence/qa-scratch/asset-return-dedup-'));roots.push(root);const store=new AtelierStore(root,path.join(root,'key'));stores.push(store);const production=new AssetProductionService(store),created=production.create({name:'Return lineage',mode:'prop-set',target:'A single bracket'}),catalog=production.catalog({id:created.job.id,expectedRevision:created.workflow.revision,items:[{name:'Bracket',route:'module',views:['front'],depthEnabled:false}]}),reviewed=production.reviewCatalog({id:created.job.id,expectedRevision:catalog.job.revision,expectedWorkflowRevision:catalog.workflow.revision,decision:'accept'});return {root,store,production,returns:new AssetReturnService(store),job:created.job,item:catalog.items[0],workflow:reviewed.workflow};}
function writePng(root:string,name:string,color:[number,number,number]){const image=new PNG({width:4,height:4});for(let i=0;i<image.data.length;i+=4){image.data[i]=color[0];image.data[i+1]=color[1];image.data[i+2]=color[2];image.data[i+3]=255;}const file=path.join(root,name);fs.writeFileSync(file,PNG.sync.write(image));return file;}
function writeObj(root:string,name:string){const file=path.join(root,name);fs.writeFileSync(file,'o Bracket\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');return file;}
async function acceptPhoto(store:AtelierStore,production:AssetProductionService,jobId:string,itemId:string,file:string){const context=production.get(jobId),artifact=await store.ingest(file,itemId,'artifact'),submitted=production.submit({id:jobId,expectedRevision:context.workflow.revision,outputs:[{itemId,role:'image:front',artifactId:artifact.id}]},'ui');return production.review({id:jobId,expectedRevision:submitted.workflow.revision,itemId,role:'image:front',candidateId:submitted.candidateIds[0],decision:'accept'});}
async function returnMesh(store:AtelierStore,returns:AssetReturnService,production:AssetProductionService,jobId:string,itemId:string,file:string){const context=production.get(jobId),artifact=await store.ingest(file,itemId,'artifact');return {artifact,result:await returns.submit({id:jobId,expectedRevision:context.workflow.revision,stage:'geometry',assignments:[{artifactId:artifact.id,itemId}]},'ui')};}
afterEach(()=>{for(const store of stores.splice(0))try{store.db.close()}catch{}for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe('asset model return duplicate hashes',()=>{
 it('creates a new review candidate for identical mesh bytes after geometry inputs change, and dedupes only against the current lineage',async()=>{
  const {root,store,production,returns,job,item}=fixture();
  await acceptPhoto(store,production,job.id,item.id,writePng(root,'front-1.png',[120,80,40]));
  const originalFile=writeObj(root,'original.obj'),original=await returnMesh(store,returns,production,job.id,item.id,originalFile);
  expect(original.result.candidateIds).toHaveLength(1);expect(original.result.duplicates).toEqual([]);
  let context=production.get(job.id),slot=context.workflow.data.slots.find((value:any)=>value.itemId===item.id&&value.role==='geometry'),first=slot.candidates.find((value:any)=>value.id===original.result.candidateIds[0]);
  expect(first.status).toBe('pending');const acceptedFirst=production.review({id:job.id,expectedRevision:context.workflow.revision,itemId:item.id,role:'geometry',candidateId:first.id,decision:'accept'});
  const oldFingerprint=production.get(job.id).current.find(value=>value.itemId===item.id)!.geometryInputFingerprint;
  await acceptPhoto(store,production,job.id,item.id,writePng(root,'front-2.png',[35,145,105]));
  context=production.get(job.id);expect(context.current.find(value=>value.itemId===item.id)!.geometryNeedsReview).toBe(true);expect(context.current.find(value=>value.itemId===item.id)!.geometryInputFingerprint).not.toBe(oldFingerprint);

  const sameBytesFile=writeObj(root,'same-mesh-new-return.obj'),replacement=await returnMesh(store,returns,production,job.id,item.id,sameBytesFile);
  expect(replacement.artifact.data.hash).toBe(original.artifact.data.hash);
  expect(replacement.result.duplicates).toEqual([]);expect(replacement.result.candidateIds).toHaveLength(1);
  context=production.get(job.id);slot=context.workflow.data.slots.find((value:any)=>value.itemId===item.id&&value.role==='geometry');
  const second=slot.candidates.find((value:any)=>value.id===replacement.result.candidateIds[0]);
  expect(second).toMatchObject({status:'pending',artifactId:replacement.artifact.id,hash:first.hash,inputFingerprint:context.current.find(value=>value.itemId===item.id)!.geometryInputFingerprint});
  expect(slot.candidates.find((value:any)=>value.id===first.id)).toMatchObject({status:'accepted',inputFingerprint:oldFingerprint});
  const acceptedSecond=production.review({id:job.id,expectedRevision:context.workflow.revision,itemId:item.id,role:'geometry',candidateId:second.id,decision:'accept'});
  expect(production.get(job.id).current.find(value=>value.itemId===item.id)).toMatchObject({geometryNeedsReview:false,geometry:{artifactId:replacement.artifact.id,hash:first.hash}});

  const sameCurrentFile=writeObj(root,'same-mesh-current-return.obj'),duplicate=await returnMesh(store,returns,production,job.id,item.id,sameCurrentFile);
  expect(duplicate.result.candidateIds).toEqual([]);expect(duplicate.result.duplicates).toEqual([{artifactId:duplicate.artifact.id,itemId:item.id,candidateId:second.id}]);
  const finalSlot=production.get(job.id).workflow.data.slots.find((value:any)=>value.itemId===item.id&&value.role==='geometry');
  expect(finalSlot.candidates).toHaveLength(2);expect(finalSlot.candidates.find((value:any)=>value.id===second.id).status).toBe('accepted');
  expect(acceptedFirst.revision).toBeLessThan(acceptedSecond.revision);
 });
});
