import {validateAssetOutput} from './asset-output-validation';
import {validateDepthMapPng} from './depth-map-validation';
import {afterEach,describe,expect,it} from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {PNG} from 'pngjs';
import {AtelierStore} from './store';
import {AssetProductionService} from './asset-production';

const roots:string[]=[],stores:AtelierStore[]=[];
afterEach(()=>{for(const store of stores.splice(0))try{store.db.close();}catch{}for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const digest=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint=(item:any,job:any,depthEnabled:boolean)=>digest({itemName:item.name,item:{...item.data,depthEnabled},target:job.data.target,inclusions:job.data.inclusions,exclusions:job.data.exclusions,sourceCrop:job.data.sourceCrop,dimensions:job.data.dimensions,sourceHash:null});
const candidate=(id:string,hash:string,extra:Record<string,unknown>={})=>({id,artifactId:crypto.randomUUID(),hash,submittedAt:'2026-10-01T00:00:00.000Z',submittedBy:'mcp' as const,status:'accepted' as const,reviewedAt:'2026-10-01T00:01:00.000Z',reviewedBy:'human' as const,...extra});

function createStore(){
 const base=path.resolve('evidence/assets-batch-flow-20261102/test-workspaces');fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'depth-'));roots.push(root);const store=new AtelierStore(root,path.join(root,'key'));stores.push(store);
 return {root,store};
}

describe('job-wide asset depth choice',()=>{
 it('restores the persisted job-wide choice and item order after reopening the store',()=>{
  const {root,store}=createStore(),service=new AssetProductionService(store),created=service.create({name:'Persisted depth',mode:'composite',target:'A wood planter'}),moduleId=crypto.randomUUID(),foliageId=crypto.randomUUID();
  const proposed=service.catalog({id:created.job.id,expectedRevision:created.workflow.revision,items:[{id:moduleId,name:'Planter body',route:'module',views:['front'],depthEnabled:false},{id:foliageId,name:'Canopy cards',route:'foliage',views:['front','back','side','top'],depthEnabled:false}]});
  const accepted=service.reviewCatalog({id:created.job.id,expectedRevision:proposed.job.revision,expectedWorkflowRevision:proposed.workflow.revision,decision:'accept'});
  service.setDepth({id:created.job.id,expectedJobRevision:accepted.job.revision,expectedWorkflowRevision:accepted.workflow.revision,depthEnabled:true});
  store.db.close();
  const reopenedStore=new AtelierStore(root,path.join(root,'key'));stores.push(reopenedStore);const reopened=new AssetProductionService(reopenedStore).get(created.job.id);
  expect(reopened.workflow.data.depthEnabled).toBe(true);
  expect(reopened.workflow.data.catalogItemOrder).toEqual([moduleId,foliageId]);
  expect(reopened.items.map((item:any)=>[item.id,item.data.depthEnabled])).toEqual([[moduleId,true],[foliageId,false]]);
 });

 it('accepts the latest view edits atomically while preserving human review history and rejecting stale revisions',()=>{
  const {store}=createStore(),service=new AssetProductionService(store),created=service.create({name:'Editable views',mode:'composite',target:'A timber outbuilding'}),itemId=crypto.randomUUID(),instanceId=crypto.randomUUID(),transform={position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]};
  const initial=service.catalog({id:created.job.id,expectedRevision:created.workflow.revision,items:[{id:itemId,name:'Roof module',route:'module',views:['front']}],instances:[{id:instanceId,masterItemId:itemId,transform}],assumptions:['Source-backed pitched roof']});
  const accepted=service.reviewCatalog({id:created.job.id,expectedRevision:initial.job.revision,expectedWorkflowRevision:initial.workflow.revision,decision:'accept'}),before=service.get(created.job.id),candidateId=crypto.randomUUID(),candidate={id:candidateId,artifactId:crypto.randomUUID(),hash:'a'.repeat(64),submittedAt:'2026-11-04T00:00:00.000Z',submittedBy:'ui' as const,status:'accepted' as const,reviewedAt:'2026-11-04T00:01:00.000Z',reviewedBy:'human' as const,warnings:[]};
  const withHistory=store.assetProductionPut({kind:'workflow',id:before.workflow.id,name:before.workflow.name,data:{...before.workflow.data,slots:[{itemId,role:'image:front',acceptedCandidateId:candidateId,candidates:[candidate]}]},expectedRevision:before.workflow.revision});
  const saved=service.acceptCatalogEdits({id:created.job.id,expectedJobRevision:accepted.job.revision,expectedWorkflowRevision:withHistory.revision,items:[{id:itemId,name:'Roof module',route:'module',viewType:'roof',views:['front','side']}],instances:withHistory.data.instances,assumptions:['Source-backed tiled pitch']});
  const result=service.get(created.job.id),item=result.items.find((entry:any)=>entry.id===itemId);
  expect(saved.job.data.catalogStatus).toBe('accepted');expect(saved.workflow.data.catalogProposal).toBeUndefined();if(!item)throw new Error('Accepted item was not persisted.');
  expect(item.data).toMatchObject({viewType:'roof',views:['front','side']});expect(result.workflow.data.instances).toEqual(withHistory.data.instances);expect(result.workflow.data.catalogAssumptions).toEqual(['Source-backed tiled pitch']);
  expect(result.workflow.data.slots).toEqual(withHistory.data.slots);expect(result.workflow.data.slots[0].acceptedCandidateId).toBe(candidateId);expect(result.workflow.data.slots[0].candidates[0].status).toBe('accepted');
  const snapshot=JSON.stringify({job:store.get('assetJob',created.job.id),workflow:store.get('workflow',created.workflow.id),item:store.get('assetItem',itemId)});
  expect(()=>service.acceptCatalogEdits({id:created.job.id,expectedJobRevision:saved.job.revision-1,expectedWorkflowRevision:saved.workflow.revision,items:[{id:itemId,name:'Changed',route:'module',viewType:'wall',views:['front']}]})).toThrow(/changed/i);
  expect(()=>service.acceptCatalogEdits({id:created.job.id,expectedJobRevision:saved.job.revision,expectedWorkflowRevision:saved.workflow.revision-1,items:[{id:itemId,name:'Changed',route:'module',viewType:'wall',views:['front']}]})).toThrow(/changed/i);
  expect(JSON.stringify({job:store.get('assetJob',created.job.id),workflow:store.get('workflow',created.workflow.id),item:store.get('assetItem',itemId)})).toBe(snapshot);
 });

 it('preserves accepted color review and restores only exact legacy fingerprints when toggled back',()=>{
  const {store}=createStore(),service=new AssetProductionService(store),created=service.create({name:'Mixed depth',mode:'prop-set',target:'A low wood stool'}),ids=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  const catalog=service.catalog({id:created.job.id,expectedRevision:created.workflow.revision,items:[
   {id:ids[0],name:'Stool seat',route:'module',views:['front'],depthEnabled:false},
   {id:ids[1],name:'Shared peg',route:'shared-prop',views:['front'],depthEnabled:true},
   {id:ids[2],name:'Leaf clump',route:'foliage',views:['front','back','side','top'],depthEnabled:false},
  ]});
  service.reviewCatalog({id:created.job.id,expectedRevision:catalog.job.revision,expectedWorkflowRevision:catalog.workflow.revision,decision:'accept'});const before=service.get(created.job.id),solid=before.items[0],shared=before.items[1],geometryHash='b'.repeat(64),imageHash='a'.repeat(64),geometryFp=digest({imageInputFingerprint:fingerprint(solid,before.job,false),images:[{role:'image:front',hash:imageHash}]}),materialFp=digest({geometryHash,geometryInputFingerprint:geometryFp,imageInputFingerprint:fingerprint(solid,before.job,false),images:[{role:'image:front',hash:imageHash}]}),acceptedColor=candidate(crypto.randomUUID(),imageHash,{inputFingerprint:fingerprint(solid,before.job,false)}),rejectedColor={...candidate(crypto.randomUUID(),'c'.repeat(64)),status:'rejected' as const},geometryCandidateRow=candidate(crypto.randomUUID(),geometryHash,{inputFingerprint:geometryFp}),materialCandidateRow=candidate(crypto.randomUUID(),'d'.repeat(64),{inputFingerprint:materialFp,dependsOnGeometryHash:geometryHash}),sharedColor=candidate(crypto.randomUUID(),'e'.repeat(64),{inputFingerprint:fingerprint(shared,before.job,true)}),sheetCandidate=candidate(crypto.randomUUID(),'f'.repeat(64)),depthSheetCandidate=candidate(crypto.randomUUID(),'9'.repeat(64),{inputFingerprint:fingerprint(shared,before.job,true),dependsOnSheetHash:'f'.repeat(64)});
  const seeded=store.assetProductionPut({kind:'workflow',id:before.workflow.id,name:before.workflow.name,data:{...before.workflow.data,slots:[
   {itemId:ids[0],role:'image:front',acceptedCandidateId:acceptedColor.id,candidates:[acceptedColor,rejectedColor]},
   {itemId:ids[0],role:'geometry',acceptedCandidateId:geometryCandidateRow.id,candidates:[geometryCandidateRow]},
   {itemId:ids[0],role:'material',acceptedCandidateId:materialCandidateRow.id,candidates:[materialCandidateRow]},
   {itemId:ids[1],role:'image:front',acceptedCandidateId:sharedColor.id,candidates:[sharedColor]},
   {itemId:ids[1],role:'sheet',acceptedCandidateId:sheetCandidate.id,candidates:[sheetCandidate]},
   {itemId:ids[1],role:'depth:sheet',acceptedCandidateId:depthSheetCandidate.id,candidates:[depthSheetCandidate]},
  ]},expectedRevision:before.workflow.revision});
  const withHistory=service.get(created.job.id),imageHistory=JSON.stringify(withHistory.workflow.data.slots[0].candidates),geometryCandidate=withHistory.workflow.data.slots.find((slot:any)=>slot.role==='geometry').candidates[0],materialCandidate=withHistory.workflow.data.slots.find((slot:any)=>slot.role==='material').candidates[0];
  expect(withHistory.current.find((value:any)=>value.itemId===ids[0])).toMatchObject({imagesNeedReview:false,geometryNeedsReview:false,materialNeedsCompatibilityReview:false});
   expect(withHistory.current.find((value:any)=>value.itemId===ids[1])).toMatchObject({imagesNeedReview:false,depthsNeedReview:true});
  expect(withHistory.workflow.data.slots.find((slot:any)=>slot.itemId===ids[1]&&slot.role==='depth:sheet')?.acceptedCandidateId).toBe(depthSheetCandidate.id);
  const enabled=service.setDepth({id:created.job.id,expectedJobRevision:withHistory.job.revision,expectedWorkflowRevision:seeded.revision,depthEnabled:true}),enabledItems=enabled.items;
  expect(enabled.items.map((value:any)=>value.id)).toEqual(ids);
  expect(enabledItems.filter((value:any)=>value.data.route!=='foliage').every((value:any)=>value.data.depthEnabled)).toBe(true);
  expect(enabledItems.find((value:any)=>value.id===ids[2])!.data.depthEnabled).toBe(false);
  expect(enabled.workflow.data.depthEnabled).toBe(true);
  expect(JSON.stringify(enabled.workflow.data.slots[0].candidates)).toBe(imageHistory);
  expect(enabled.workflow.data.slots[0].candidates[0]).toMatchObject({reviewedBy:'human',status:'accepted'});
  expect(enabled.workflow.data.slots[0].candidates[1]).toMatchObject({reviewedBy:'human',status:'rejected'});
   expect(enabled.current.find((value:any)=>value.itemId===ids[1])).toMatchObject({imagesNeedReview:false,depthsNeedReview:true});
  const enabledState=enabled.current.find((value:any)=>value.itemId===ids[0]);
  expect(enabledState).toMatchObject({imagesNeedReview:false,geometryNeedsReview:true,materialNeedsCompatibilityReview:true});
  expect(enabledState!.geometry.id).toBe(geometryCandidate.id);
  expect(enabledState!.material.id).toBe(materialCandidate.id);
  const reverted=service.setDepth({id:created.job.id,expectedJobRevision:enabled.job.revision,expectedWorkflowRevision:enabled.workflow.revision,depthEnabled:false}),revertedState=reverted.current.find((value:any)=>value.itemId===ids[0]);
  expect(reverted.items.map((value:any)=>value.id)).toEqual(ids);
  expect(revertedState).toMatchObject({imagesNeedReview:false,geometryNeedsReview:false,materialNeedsCompatibilityReview:false});
  expect(reverted.current.find((value:any)=>value.itemId===ids[1])).toMatchObject({imagesNeedReview:false,depthsNeedReview:false});
  expect(reverted.workflow.data.slots.find((slot:any)=>slot.itemId===ids[1]&&slot.role==='depth:sheet')?.acceptedCandidateId).toBe(depthSheetCandidate.id);
  expect(reverted.workflow.data.slots[0].candidates).toEqual(enabled.workflow.data.slots[0].candidates);
  const changed=service.update({id:reverted.job.id,expectedRevision:reverted.job.revision,target:'A tall wood stool'}),stale=service.get(created.job.id).current.find((value:any)=>value.itemId===ids[0]);
  expect(stale!.imagesNeedReview).toBe(true);
  const restored=service.update({id:changed.id,expectedRevision:changed.revision,target:'A low wood stool'});
  expect(service.get(restored.id).current.find((value:any)=>value.itemId===ids[0])!.imagesNeedReview).toBe(false);
  store.db.close();
 });

 it('keeps accepted image, geometry, and material candidates current when only placements change',()=>{
  const {store}=createStore(),service=new AssetProductionService(store),created=service.create({name:'Placement correction',mode:'composite',target:'A small wooden stool'}),itemId=crypto.randomUUID(),instanceId=crypto.randomUUID(),initialTransform={position:[0,0,0] as [number,number,number],rotation:[0,0,0] as [number,number,number],scale:[1,1,1] as [number,number,number]};
  try{
   const proposed=service.catalog({id:created.job.id,expectedRevision:created.workflow.revision,items:[{id:itemId,name:'Stool seat',route:'module',views:['front'],depthEnabled:false}],instances:[{id:instanceId,masterItemId:itemId,transform:initialTransform}]}),accepted=service.reviewCatalog({id:created.job.id,expectedRevision:proposed.job.revision,expectedWorkflowRevision:proposed.workflow.revision,decision:'accept'}),context=service.get(created.job.id),item=context.items[0];
   const imageInputFingerprint=fingerprint(item,context.job,false),imageHash='a'.repeat(64),geometryHash='b'.repeat(64),geometryInputFingerprint=digest({imageInputFingerprint,images:[{role:'image:front',hash:imageHash}]}),materialInputFingerprint=digest({geometryHash,geometryInputFingerprint,imageInputFingerprint,images:[{role:'image:front',hash:imageHash}]}),imageAccepted=candidate(crypto.randomUUID(),imageHash,{inputFingerprint:imageInputFingerprint}),imagePending={id:crypto.randomUUID(),artifactId:crypto.randomUUID(),hash:'c'.repeat(64),submittedAt:'2026-10-02T00:00:00.000Z',submittedBy:'ui' as const,status:'pending' as const,warnings:[]},imageRejected={...candidate(crypto.randomUUID(),'d'.repeat(64)),status:'rejected' as const},geometryAccepted=candidate(crypto.randomUUID(),geometryHash,{inputFingerprint:geometryInputFingerprint}),materialAccepted=candidate(crypto.randomUUID(),'e'.repeat(64),{inputFingerprint:materialInputFingerprint,dependsOnGeometryHash:geometryHash});
   const seeded=store.assetProductionPut({kind:'workflow',id:accepted.workflow.id,name:accepted.workflow.name,data:{...accepted.workflow.data,slots:[
    {itemId,role:'image:front',acceptedCandidateId:imageAccepted.id,candidates:[imageAccepted,imagePending,imageRejected]},
    {itemId,role:'geometry',acceptedCandidateId:geometryAccepted.id,candidates:[geometryAccepted]},
    {itemId,role:'material',acceptedCandidateId:materialAccepted.id,candidates:[materialAccepted]},
   ]},expectedRevision:accepted.workflow.revision}),before=service.get(created.job.id),beforeSlots=JSON.stringify(before.workflow.data.slots),beforeCurrent=before.current[0];
   expect(beforeCurrent).toMatchObject({imagesNeedReview:false,geometryNeedsReview:false,materialNeedsCompatibilityReview:false});
   const movedTransform={position:[2,1,3] as [number,number,number],rotation:[0,0.5,0] as [number,number,number],scale:[1,1,1] as [number,number,number]},placementProposal=service.catalog({id:created.job.id,expectedRevision:before.workflow.revision,expectedJobRevision:before.job.revision,items:[{id:itemId,name:'Stool seat',route:'module',views:['front'],depthEnabled:false}],instances:[{id:instanceId,masterItemId:itemId,transform:movedTransform}]});
   expect(JSON.stringify(placementProposal.workflow.data.slots)).toBe(beforeSlots);
   expect(placementProposal.job.data.catalogRequiresRevalidation).toBe(false);
   const placementAccepted=service.reviewCatalog({id:created.job.id,expectedRevision:placementProposal.job.revision,expectedWorkflowRevision:placementProposal.workflow.revision,decision:'accept'}),after=service.get(created.job.id);
   expect(after.workflow.data.slots).toEqual(before.workflow.data.slots);
   expect(after.job.data).toMatchObject({catalogStatus:'accepted',catalogRequiresRevalidation:false});
   expect(after.activeInstances).toEqual([{id:instanceId,masterItemId:itemId,transform:movedTransform}]);
   expect(after.current[0]).toMatchObject({imagesNeedReview:false,geometryNeedsReview:false,materialNeedsCompatibilityReview:false});
   expect(after.current[0].dependencyFingerprint).not.toBe(beforeCurrent.dependencyFingerprint);
   expect(placementAccepted.workflow.data.slots[0].candidates.map((value:any)=>[value.id,value.status])).toEqual([[imageAccepted.id,'accepted'],[imagePending.id,'pending'],[imageRejected.id,'rejected']]);
   void seeded;
  }finally{store.db.close();}
 });

 it('keeps pending catalog review intact, applies the saved choice to newly accepted items and rejects stale revisions atomically',()=>{
  const {store}=createStore(),service=new AssetProductionService(store),created=service.create({name:'Pending proposal',mode:'composite',target:'A tree'}),firstId=crypto.randomUUID();
  const catalog=service.catalog({id:created.job.id,expectedRevision:created.workflow.revision,items:[{id:firstId,name:'Trunk',route:'module',views:['front'],depthEnabled:false},{name:'Leaves',route:'foliage',views:['front','back','side','top'],depthEnabled:false}]});
  const accepted=service.reviewCatalog({id:created.job.id,expectedRevision:catalog.job.revision,expectedWorkflowRevision:catalog.workflow.revision,decision:'accept'}),previous=service.get(created.job.id),leafId=previous.items.find((value:any)=>value.data.route==='foliage')!.id;
  const proposed=service.catalog({id:created.job.id,expectedRevision:accepted.workflow.revision,items:[{id:firstId,name:'Trunk',route:'module',views:['front'],depthEnabled:false},{id:leafId,name:'Leaves',route:'foliage',views:['front','back','side','top'],depthEnabled:false},{name:'Branch',route:'module',views:['front'],depthEnabled:false}]});
  const pendingProposal=JSON.stringify(proposed.workflow.data.catalogProposal),enabled=service.setDepth({id:proposed.job.id,expectedJobRevision:proposed.job.revision,expectedWorkflowRevision:proposed.workflow.revision,depthEnabled:true});
  expect(enabled.job.data.catalogStatus).toBe('pending');
  expect(enabled.job.data.catalogPreviouslyAccepted).toBe(true);
  expect(JSON.stringify(enabled.workflow.data.catalogProposal)).toBe(pendingProposal);
  expect(enabled.items.map((value:any)=>value.id)).toEqual([firstId,leafId]);
  expect(enabled.items.filter((value:any)=>value.data.route!=='foliage').every((value:any)=>value.data.depthEnabled)).toBe(true);
  expect(enabled.items.find((value:any)=>value.data.route==='foliage')!.data.depthEnabled).toBe(false);
  const staleSnapshot=JSON.stringify({job:enabled.job,workflow:enabled.workflow,items:enabled.items});
  expect(()=>service.setDepth({id:enabled.job.id,expectedJobRevision:enabled.job.revision-1,expectedWorkflowRevision:enabled.workflow.revision,depthEnabled:false})).toThrow(/changed|refresh/i);
  const unchanged=service.get(enabled.job.id);expect(JSON.stringify({job:unchanged.job,workflow:unchanged.workflow,items:unchanged.items})).toBe(staleSnapshot);
  const afterStale=service.get(enabled.job.id);
  expect(afterStale.workflow.data.depthEnabled).toBe(true);
  expect(JSON.stringify(afterStale.workflow.data.catalogProposal)).toBe(pendingProposal);
  const final=service.reviewCatalog({id:afterStale.job.id,expectedRevision:afterStale.job.revision,expectedWorkflowRevision:afterStale.workflow.revision,decision:'accept'});
  const finalContext=service.get(final.job.id);
  expect(finalContext.items.map((value:any)=>value.id)).toEqual([firstId,leafId,proposed.items[2].id]);
  expect(finalContext.items.filter((value:any)=>value.data.route!=='foliage').every((value:any)=>value.data.depthEnabled)).toBe(true);
  expect(finalContext.items.find((value:any)=>value.data.route==='foliage')!.data.depthEnabled).toBe(false);
  expect(finalContext.workflow.data.catalogProposal).toBeUndefined();
  store.db.close();
 });

 it('rebinds previously accepted color candidates when making a unique clone and leaves unrepresented sheets stale',async()=>{
  const {root,store}=createStore(),service=new AssetProductionService(store),created=service.create({name:'Legacy clone',mode:'prop-set',target:'A small table'}),moduleId=crypto.randomUUID(),foliageId=crypto.randomUUID(),moduleInstanceId=crypto.randomUUID(),foliageInstanceId=crypto.randomUUID();
  const proposal=service.catalog({id:created.job.id,expectedRevision:created.workflow.revision,items:[{id:moduleId,name:'Table top',route:'module',views:['front'],depthEnabled:false},{id:foliageId,name:'Leaf cards',route:'foliage',views:['front','back','side','top'],depthEnabled:false}],instances:[{id:moduleInstanceId,masterItemId:moduleId,transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}},{id:foliageInstanceId,masterItemId:foliageId,transform:{position:[1,0,0],rotation:[0,0,0],scale:[1,1,1]}}]});
  const accepted=service.reviewCatalog({id:created.job.id,expectedRevision:proposal.job.revision,expectedWorkflowRevision:proposal.workflow.revision,decision:'accept'}),context=service.get(created.job.id),makeImage=async(parent:string,name:string)=>{const image=new PNG({width:8,height:8});image.data.fill(130);const file=path.join(root,name);fs.writeFileSync(file,PNG.sync.write(image));return await store.ingest(file,parent,'artifact');},moduleArtifact=await makeImage(moduleId,'module.png'),foliageArtifact=await makeImage(foliageId,'foliage.png'),moduleFp=fingerprint(context.items.find((item:any)=>item.id===moduleId),context.job,false),foliageFp=fingerprint(context.items.find((item:any)=>item.id===foliageId),context.job,false),moduleCandidate=candidate(crypto.randomUUID(),moduleArtifact.data.hash,{artifactId:moduleArtifact.id,inputFingerprint:moduleFp}),moduleRejected={...candidate(crypto.randomUUID(),'8'.repeat(64)),status:'rejected' as const},foliageCandidate=candidate(crypto.randomUUID(),foliageArtifact.data.hash,{artifactId:foliageArtifact.id,inputFingerprint:foliageFp});
  const seeded=store.assetProductionPut({kind:'workflow',id:accepted.workflow.id,name:accepted.workflow.name,data:{...accepted.workflow.data,slots:[{itemId:moduleId,role:'image:front',acceptedCandidateId:moduleCandidate.id,candidates:[moduleCandidate,moduleRejected]},{itemId:foliageId,role:'foliage:front',acceptedCandidateId:foliageCandidate.id,candidates:[foliageCandidate]}]},expectedRevision:accepted.workflow.revision});
  const enabled=service.setDepth({id:created.job.id,expectedJobRevision:accepted.job.revision,expectedWorkflowRevision:seeded.revision,depthEnabled:true}),masterHistory=JSON.stringify(enabled.workflow.data.slots.find((slot:any)=>slot.itemId===moduleId).candidates),moduleClone=service.makeUnique({id:created.job.id,expectedRevision:enabled.workflow.revision,instanceId:moduleInstanceId,name:'Table top clone'}),cloneSlot=moduleClone.workflow.data.slots.find((slot:any)=>slot.itemId===moduleClone.item.id&&slot.role==='image:front'),cloneCandidate=cloneSlot.candidates[0],cloneState=service.get(created.job.id).current.find((value:any)=>value.itemId===moduleClone.item.id);
  expect(cloneCandidate).toMatchObject({status:'accepted',reviewedBy:'human',inputFingerprint:cloneState!.imageInputFingerprint});expect(cloneCandidate.artifactId).not.toBe(moduleCandidate.artifactId);expect(cloneState).toMatchObject({imagesNeedReview:false});expect(JSON.stringify(moduleClone.workflow.data.slots.find((slot:any)=>slot.itemId===moduleId).candidates)).toBe(masterHistory);
  const afterClone=service.get(created.job.id),changed=service.update({id:created.job.id,expectedRevision:afterClone.job.revision,target:'A different tall table'});expect(service.get(changed.id).current.find((value:any)=>value.itemId===moduleClone.item.id)!.imagesNeedReview).toBe(true);const reverted=service.update({id:changed.id,expectedRevision:changed.revision,target:'A small table'}),afterRevert=service.get(created.job.id);
  const foliageClone=service.makeUnique({id:created.job.id,expectedRevision:afterRevert.workflow.revision,instanceId:foliageInstanceId,name:'Leaf cards clone'}),foliageState=service.get(created.job.id).current.find((value:any)=>value.itemId===foliageClone.item.id);expect(foliageState).toMatchObject({imagesNeedReview:false});expect(foliageState!.images.find((entry:any)=>entry.role==='foliage:front')!.candidate.status).toBe('accepted');
 });

 it('records the exact accepted color hash for each depth map and blocks pending or stale view inputs',async()=>{
  const {root,store}=createStore(),service=new AssetProductionService(store),created=service.create({name:'Depth source binding',mode:'composite',target:'A small wooden wall'}),itemId=crypto.randomUUID(),catalog=service.catalog({id:created.job.id,expectedRevision:created.workflow.revision,items:[{id:itemId,name:'Wooden wall',route:'module',viewType:'wall',views:['front','side'],depthEnabled:false}]}),acceptedCatalog=service.reviewCatalog({id:created.job.id,expectedRevision:catalog.job.revision,expectedWorkflowRevision:catalog.workflow.revision,decision:'accept'});service.setDepth({id:created.job.id,expectedJobRevision:acceptedCatalog.job.revision,expectedWorkflowRevision:acceptedCatalog.workflow.revision,depthEnabled:true});
  const makePng=(name:string,color:[number,number,number],blackBorder=false)=>{const image=new PNG({width:16,height:16});for(let y=0;y<16;y++)for(let x=0;x<16;x++){const border=blackBorder&&(x===0||y===0||x===15||y===15),offset=(y*16+x)*4;image.data[offset]=border?1:color[0];image.data[offset+1]=border?1:color[1];image.data[offset+2]=border?0:color[2];image.data[offset+3]=255;}const file=path.join(root,name);fs.writeFileSync(file,PNG.sync.write(image));return file;};
  const fresh=service.get(created.job.id),frontArtifact=await store.ingest(makePng('accepted-front.png',[160,90,45]),itemId,'artifact'),frontSubmitted=service.submit({id:created.job.id,expectedRevision:fresh.workflow.revision,outputs:[{itemId,role:'image:front',artifactId:frontArtifact.id}]},'mcp'),frontCandidateId=frontSubmitted.candidateIds[0],frontAccepted=service.review({id:created.job.id,expectedRevision:frontSubmitted.workflow.revision,itemId,role:'image:front',candidateId:frontCandidateId,decision:'accept'}),firstColorHash=frontAccepted.data.slots.find((value:any)=>value.role==='image:front').candidates.find((value:any)=>value.id===frontCandidateId).hash;
  const depthArtifact=await store.ingest(makePng('depth-front.png',[140,141,140],true),itemId,'artifact'),depthSubmitted=service.submit({id:created.job.id,expectedRevision:frontAccepted.revision,outputs:[{itemId,role:'depth:front',artifactId:depthArtifact.id}]},'mcp'),depthCandidate=depthSubmitted.workflow.data.slots.find((value:any)=>value.role==='depth:front').candidates[0];
  expect(depthCandidate).toMatchObject({dependsOnColorHash:firstColorHash,status:'pending',hash:depthArtifact.data.hash});
  service.review({id:created.job.id,expectedRevision:depthSubmitted.workflow.revision,itemId,role:'depth:front',candidateId:depthCandidate.id,decision:'accept'});expect(service.get(created.job.id).current.find((value:any)=>value.itemId===itemId)).toMatchObject({depthsNeedReview:false});
  const latest=service.get(created.job.id),replacementColor=await store.ingest(makePng('replacement-front.png',[170,95,50]),itemId,'artifact'),replacementSubmitted=service.submit({id:created.job.id,expectedRevision:latest.workflow.revision,outputs:[{itemId,role:'image:front',artifactId:replacementColor.id}]},'mcp'),replacementAccepted=service.review({id:created.job.id,expectedRevision:replacementSubmitted.workflow.revision,itemId,role:'image:front',candidateId:replacementSubmitted.candidateIds[0],decision:'accept'});
  expect(service.get(created.job.id).current.find((value:any)=>value.itemId===itemId)).toMatchObject({depthsNeedReview:true});
  const pendingSide=await store.ingest(makePng('pending-side.png',[120,75,35]),itemId,'artifact'),sideSubmitted=service.submit({id:created.job.id,expectedRevision:replacementAccepted.revision,outputs:[{itemId,role:'image:side',artifactId:pendingSide.id}]},'mcp'),sideDepth=await store.ingest(makePng('depth-side.png',[140,140,140],true),itemId,'artifact');
  expect(()=>service.submit({id:created.job.id,expectedRevision:sideSubmitted.workflow.revision,outputs:[{itemId,role:'depth:side',artifactId:sideDepth.id}]},'mcp')).toThrow(/current accepted image:side color input/i);
  expect(service.get(created.job.id).workflow.data.slots.find((value:any)=>value.role==='depth:front').candidates.map((value:any)=>value.id)).toEqual([depthCandidate.id]);
 });
});


it('shares character depth validation, accepts near-black original bytes and rejects actual tint or clipped borders',async()=>{
 const {root,store}=createStore(),service=new AssetProductionService(store),job=service.create({name:'Depth encoding parity',mode:'composite',target:'Test wall'});
 const png=new PNG({width:32,height:32});
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){const p=(y*32+x)*4,b=x===0||x===31||y===0||y===31;png.data[p]=b?0:140;png.data[p+1]=b?1:141;png.data[p+2]=b?0:140;png.data[p+3]=255;}
 const bytes=PNG.sync.write(png),file=path.join(root,'original-depth.png');fs.writeFileSync(file,bytes);const artifact=await store.ingest(file,job.job.id,'artifact');
 expect(validateAssetOutput(store,artifact,'depth:front').depthValidation).toEqual(validateDepthMapPng(bytes));
 expect(fs.readFileSync(store.object(artifact.data.hash)!)).toEqual(bytes);expect(fs.readFileSync(file)).toEqual(bytes);
 for(const [name,edit] of [['tinted',(data:Buffer)=>{for(let i=0;i<data.length;i+=4){data[i]=140;data[i+1]=180;data[i+2]=140;}}],['clipped',(data:Buffer)=>{data[0]=100;data[1]=100;data[2]=100;}]] as const){
  const copy=new PNG({width:32,height:32});png.data.copy(copy.data);edit(copy.data);const out=PNG.sync.write(copy),target=path.join(root,name+'.png');fs.writeFileSync(target,out);const invalid=await store.ingest(target,job.job.id,'artifact');
  expect(()=>validateAssetOutput(store,invalid,'depth:front')).toThrow(name==='tinted'?/grayscale/:/black|border/);
  expect(fs.readFileSync(store.object(invalid.data.hash)!)).toEqual(out);
 }
});
