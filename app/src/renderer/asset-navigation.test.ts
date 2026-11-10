import {describe,expect,it} from 'vitest';
import {assetSceneCandidateIsCurrent,assetStageHeaderCopy,defaultAssetImageRole,requiredAssetImageRoles,resolveAssetInstanceSelection,resolveAssetItemSelection,resolveAssetNavigationSelection,resolvePendingAssetSceneCandidate} from './asset-navigation';

describe('asset stage display labels',()=>{
 it('labels prop-set stage five as Export while preserving the composite scene flow',()=>{
  expect(assetStageHeaderCopy('assembly','prop-set','en')).toEqual({title:'Export',description:'Automatically check accepted files and export independent models and textures. No scene is needed.'});
  expect(assetStageHeaderCopy('assembly','prop-set','ru')).toEqual({title:'Экспорт',description:'Автоматически проверьте принятые файлы и экспортируйте отдельные модели и текстуры. Сцена не нужна.'});
  expect(assetStageHeaderCopy('assembly','composite','en')).toMatchObject({title:'Assembly',description:expect.stringMatching(/Build.*inspect or correct.*accept.*export/i)});
  expect(assetStageHeaderCopy('assembly','composite','ru')).toMatchObject({title:'Сборка',description:expect.stringMatching(/Соберите сцену.*проверьте и исправьте.*примите её и экспортируйте/i)});
 });
});

describe('defaultAssetImageRole',()=>{
 it('selects a strict front or side view and falls back to front for invalid legacy angles',()=>{
  expect(defaultAssetImageRole({data:{route:'module',views:['side']}})).toBe('image:side');
  expect(defaultAssetImageRole({data:{route:'module',views:['threequarter','back']}})).toBe('image:front');
 });
 it('uses the foliage front card instead of inventing a module view',()=>{
  expect(defaultAssetImageRole({data:{route:'foliage',views:[]}})).toBe('foliage:front');
 });
});

describe('requiredAssetImageRoles',()=>{
 it('exposes front and side for explicit wall/window modules and leaves generic and foliage roles alone',()=>{
  expect(requiredAssetImageRoles({data:{route:'module',viewType:'wall',views:['front']}})).toEqual(['image:front','image:side']);
  expect(requiredAssetImageRoles({data:{route:'module',viewType:'window',views:['front']}})).toEqual(['image:front','image:side']);
  expect(requiredAssetImageRoles({data:{route:'module',views:['front']}})).toEqual(['image:front']);
  expect(requiredAssetImageRoles({data:{route:'shared-prop',views:['front']}})).toEqual(['image:front','sheet']);
  expect(requiredAssetImageRoles({data:{route:'foliage',viewType:'wall',views:['front']}})).toEqual(['foliage:front','foliage:back','foliage:side','foliage:top']);
 });
});

describe('resolveAssetNavigationSelection',()=>{
 const item={id:'item-a',name:'Wall',data:{route:'module',views:['front','side']}};
 const geometry={id:'geometry-candidate',artifactId:'geometry-artifact',status:'accepted'};
 const material={id:'material-candidate',artifactId:'material-artifact',status:'accepted'};
 const current={itemId:item.id,geometry,material,materialNeedsCompatibilityReview:false,images:[{role:'image:front',candidate:{id:'image-front'}},{role:'image:side',candidate:null}]};
 const state=(overrides:any={})=>({job:{id:'job-a',data:{mode:'composite',selectedItemId:null,selectedRole:null,selectedCandidateId:null,catalogStatus:'accepted',catalogRequiresRevalidation:false}},items:[item],workflow:{data:{slots:[{itemId:item.id,role:'geometry',acceptedCandidateId:geometry.id,candidates:[geometry]},{itemId:item.id,role:'material',acceptedCandidateId:material.id,candidates:[material]},{itemId:item.id,role:'image:front',acceptedCandidateId:'image-front',candidates:[{id:'image-front',status:'accepted'}]}],sceneCandidates:[],sceneAcceptedCandidateId:null}},current:[current],activeInstances:[],...overrides});
 it('keeps the default catalog item and role in one persisted geometry selection',()=>{
  expect(resolveAssetNavigationSelection('geometry',state())).toEqual({itemId:item.id,instanceId:null,role:'geometry',candidateId:geometry.id,candidateExplicit:false,sceneCandidateId:null});
 });
 it('binds stage and scene selection to the exact selected item, accepted scene and current revision',()=>{
  const validation={readyForAssembly:true,readyForExport:true,dependencyFingerprint:'current',scene:{id:'scene-a'},sceneStale:false},scene={id:'scene-a',status:'accepted',dependencyFingerprint:'current'};
  expect(assetSceneCandidateIsCurrent(scene,validation,'scene-a')).toBe(true);
  expect(resolveAssetNavigationSelection('assembly',state({workflow:{data:{...state().workflow.data,sceneCandidates:[scene],sceneAcceptedCandidateId:scene.id}},activeInstances:[{id:'instance-a',masterItemId:item.id}],job:{data:{...state().job.data,selectedInstanceId:'instance-a'}}}),null,scene.id,validation)).toEqual({itemId:item.id,instanceId:'instance-a',role:null,candidateId:null,candidateExplicit:false,sceneCandidateId:scene.id});
 });
 it('ignores a legacy selected scene in prop-set mode without deleting saved scene history',()=>{
  const scene={id:'legacy-scene',status:'accepted',dependencyFingerprint:'current'},validation={readyForAssembly:true,readyForExport:true,dependencyFingerprint:'current',scene,sceneStale:false},base=state({job:{id:'job-a',data:{...state().job.data,mode:'prop-set',selectedSceneCandidateId:scene.id}},workflow:{data:{...state().workflow.data,sceneCandidates:[scene],sceneAcceptedCandidateId:scene.id}}});
  expect(resolveAssetNavigationSelection('assembly',base,null,scene.id,validation)).toMatchObject({role:'material',candidateId:material.id,sceneCandidateId:null,instanceId:null});
  expect(base.workflow.data.sceneCandidates).toEqual([scene]);
 });
 it('opens the current pending scene for human inspection without accepting it',()=>{
  const scene={id:'scene-pending',status:'pending',dependencyFingerprint:'current'},validation={readyForAssembly:true,readyForExport:false,dependencyFingerprint:'current',scene:null,sceneStale:false},base=state({workflow:{data:{...state().workflow.data,sceneCandidates:[scene],sceneAcceptedCandidateId:null}}});
  expect(resolveAssetNavigationSelection('assembly',base,null,null,validation)).toEqual({itemId:item.id,instanceId:null,role:null,candidateId:null,candidateExplicit:false,sceneCandidateId:scene.id});
  expect(scene.status).toBe('pending');
 });
 it('selects the latest current pending scene by default, while preserving a saved old or new pending choice',()=>{
  const old={id:'scene-old',status:'pending',dependencyFingerprint:'current'},latest={id:'scene-latest',status:'pending',dependencyFingerprint:'current'},candidates=[old,latest],validation={readyForAssembly:true,dependencyFingerprint:'current',scene:null,sceneStale:false},base=state({workflow:{data:{...state().workflow.data,sceneCandidates:candidates,sceneAcceptedCandidateId:null}}});
  expect(resolvePendingAssetSceneCandidate(candidates,validation,null)).toBe(latest);
  expect(resolveAssetNavigationSelection('assembly',base,null,null,validation).sceneCandidateId).toBe(latest.id);
  for(const selected of [old,latest]){
   expect(resolvePendingAssetSceneCandidate(candidates,validation,null,selected.id)).toBe(selected);
   expect(resolveAssetNavigationSelection('assembly',base,null,selected.id,validation).sceneCandidateId).toBe(selected.id);
  }
  expect(candidates.map(entry=>entry.status)).toEqual(['pending','pending']);
 });
 it('does not keep pre-acceptance pending scenes actionable after a newer scene is accepted',()=>{
  const old={id:'scene-old-pending',status:'pending',dependencyFingerprint:'current'},accepted={id:'scene-new-accepted',status:'accepted',dependencyFingerprint:'current'},candidates=[old,accepted],validation={readyForAssembly:true,readyForExport:true,dependencyFingerprint:'current',scene:accepted,sceneStale:false},base=state({workflow:{data:{...state().workflow.data,sceneCandidates:candidates,sceneAcceptedCandidateId:accepted.id}}});
  expect(resolvePendingAssetSceneCandidate(candidates,validation,accepted.id)).toBeNull();
  expect(resolveAssetNavigationSelection('assembly',base,null,null,validation).sceneCandidateId).toBe(accepted.id);
  // An explicit history selection remains available for inspection, but is not
  // returned as a review action after the accepted scene.
  expect(resolveAssetNavigationSelection('assembly',base,null,old.id,validation).sceneCandidateId).toBe(old.id);
  expect(resolvePendingAssetSceneCandidate(candidates,validation,accepted.id,old.id)).toBeNull();
  expect(old.status).toBe('pending');
 });
 it('offers a newly submitted pending scene after the accepted scene and skips older pending history',()=>{
  const old={id:'scene-old-pending',status:'pending',dependencyFingerprint:'current'},accepted={id:'scene-accepted',status:'accepted',dependencyFingerprint:'current'},latest={id:'scene-new-pending',status:'pending',dependencyFingerprint:'current'},candidates=[old,accepted,latest],validation={readyForAssembly:true,readyForExport:false,dependencyFingerprint:'current',scene:accepted,sceneStale:false},base=state({workflow:{data:{...state().workflow.data,sceneCandidates:candidates,sceneAcceptedCandidateId:accepted.id}}});
  expect(resolvePendingAssetSceneCandidate(candidates,validation,accepted.id)).toBe(latest);
  expect(resolvePendingAssetSceneCandidate(candidates,validation,accepted.id,old.id)).toBe(latest);
  expect(resolveAssetNavigationSelection('assembly',base,null,null,validation).sceneCandidateId).toBe(latest.id);
  // The old scene can still be selected from history while the new scene stays
  // the actionable review target.
  expect(resolveAssetNavigationSelection('assembly',base,null,old.id,validation).sceneCandidateId).toBe(old.id);
  expect(latest.status).toBe('pending');
 });
 it('falls back from stale or rejected saved selections to the latest current pending candidate and isolates project switches',()=>{
  const old={id:'scene-old',status:'pending',dependencyFingerprint:'old'},rejected={id:'scene-rejected',status:'rejected',dependencyFingerprint:'current'},latest={id:'scene-latest',status:'pending',dependencyFingerprint:'current'},validation={readyForAssembly:true,dependencyFingerprint:'current',scene:null,sceneStale:false};
  const projectA=state({job:{id:'job-a',data:{...state().job.data,selectedSceneCandidateId:old.id}},workflow:{data:{...state().workflow.data,sceneCandidates:[old],sceneAcceptedCandidateId:null}}});
  const projectB=state({job:{id:'job-b',data:{...state().job.data,selectedSceneCandidateId:null}},workflow:{data:{...state().workflow.data,sceneCandidates:[rejected,latest],sceneAcceptedCandidateId:null}}});
  expect(resolveAssetNavigationSelection('assembly',projectA,null,old.id,validation).sceneCandidateId).toBeNull();
  expect(resolveAssetNavigationSelection('assembly',projectB,null,old.id,validation).sceneCandidateId).toBe(latest.id);
  expect(resolveAssetNavigationSelection('assembly',projectB,null,rejected.id,validation).sceneCandidateId).toBe(latest.id);
  expect(resolvePendingAssetSceneCandidate([rejected,latest],validation,null,rejected.id)).toBe(latest);
  expect(projectA.job.id).not.toBe(projectB.job.id);
 });
 it('drops stale scenes and points Assembly at the current registered model candidate',()=>{
  const stale={id:'scene-old',status:'accepted',dependencyFingerprint:'old'},validation={readyForAssembly:true,dependencyFingerprint:'current',scene:null,sceneStale:true};
  expect(assetSceneCandidateIsCurrent(stale,validation,'scene-old')).toBe(false);
  expect(resolveAssetNavigationSelection('assembly',state({workflow:{data:{...state().workflow.data,sceneCandidates:[stale],sceneAcceptedCandidateId:stale.id}}}),null,stale.id,validation)).toEqual({itemId:item.id,instanceId:null,role:'material',candidateId:material.id,candidateExplicit:false,sceneCandidateId:null});
 });
 it('uses a sole accepted item as the default but leaves ambiguous catalogs unselected',()=>{
  const multiple={...item,id:'item-b'};
  expect(resolveAssetNavigationSelection('images',state({items:[item,multiple]})).itemId).toBe(null);
  expect(resolveAssetNavigationSelection('images',state()).itemId).toBe(item.id);
 });
 it('persists an Assembly default item with its accepted model or current scene in one update tuple',()=>{
  const multiple={...item,id:'item-b',name:'Roof'};
  const noSavedItem=state({items:[item,multiple],job:{data:{mode:'composite',selectedItemId:null,selectedRole:null,selectedCandidateId:null,selectedSceneCandidateId:null,catalogStatus:'accepted',catalogRequiresRevalidation:false}}});
  expect(resolveAssetNavigationSelection('assembly',noSavedItem)).toEqual({itemId:item.id,instanceId:null,role:'material',candidateId:material.id,candidateExplicit:false,sceneCandidateId:null});
  const scene={id:'scene-a',status:'accepted',dependencyFingerprint:'current'},validation={readyForAssembly:true,dependencyFingerprint:'current',scene:{id:scene.id},sceneStale:false},withScene={...noSavedItem,workflow:{data:{...noSavedItem.workflow.data,sceneCandidates:[scene],sceneAcceptedCandidateId:scene.id}}};
  expect(resolveAssetNavigationSelection('assembly',withScene,null,scene.id,validation)).toEqual({itemId:item.id,instanceId:null,role:null,candidateId:null,candidateExplicit:false,sceneCandidateId:scene.id});
 });
 it('keeps the first real view and each production role selected when a rail item is clicked',()=>{
  const jobState=state();
  expect(resolveAssetItemSelection('images',jobState,item.id)).toEqual({itemId:item.id,instanceId:null,role:'image:front',candidateId:'image-front',candidateExplicit:false,sceneCandidateId:null});
  expect(resolveAssetItemSelection('geometry',jobState,item.id)).toEqual({itemId:item.id,instanceId:null,role:'geometry',candidateId:geometry.id,candidateExplicit:false,sceneCandidateId:null});
  const materialReview=state({job:{id:'job-a',data:{...state().job.data,selectedItemId:item.id,selectedRole:'material'}}});
  expect(resolveAssetItemSelection('geometry',materialReview,item.id)).toEqual({itemId:item.id,instanceId:null,role:'material',candidateId:material.id,candidateExplicit:false,sceneCandidateId:null});
 });
 it('normalizes a stored legacy materials selection into the geometry-stage material review',()=>{
  const legacy=state({job:{id:'job-a',data:{...state().job.data,stage:'materials',selectedItemId:item.id,selectedRole:'material',selectedCandidateId:material.id,selectedCandidateExplicit:true}}});
  expect(resolveAssetNavigationSelection('geometry',legacy)).toEqual({itemId:item.id,instanceId:null,role:'material',candidateId:material.id,candidateExplicit:true,sceneCandidateId:null});
  const noLegacySlot=state({job:{id:'job-a',data:{...state().job.data,stage:'materials',selectedItemId:item.id,selectedRole:'guide:front'}}});
  expect(resolveAssetNavigationSelection('geometry',noLegacySlot).role).toBe('geometry');
 });
 it('persists a clicked instance with its master role and candidate, or a current scene as one tuple',()=>{
  const instance={id:'instance-a',masterItemId:item.id},withInstance=state({activeInstances:[instance],job:{data:{...state().job.data,selectedInstanceId:null}}});
  expect(resolveAssetInstanceSelection(withInstance,instance.id)).toEqual({itemId:item.id,instanceId:instance.id,role:'material',candidateId:material.id,candidateExplicit:false,sceneCandidateId:null});
  const scene={id:'scene-a',status:'accepted',dependencyFingerprint:'current'},validation={readyForAssembly:true,dependencyFingerprint:'current',scene:{id:scene.id},sceneStale:false},withScene={...withInstance,workflow:{data:{...withInstance.workflow.data,sceneCandidates:[scene],sceneAcceptedCandidateId:scene.id}}};
  expect(resolveAssetInstanceSelection(withScene,instance.id,scene.id,validation)).toEqual({itemId:item.id,instanceId:instance.id,role:null,candidateId:null,candidateExplicit:false,sceneCandidateId:scene.id});
 });
 it('surfaces a new pending correction by default but preserves an explicitly selected historical version',()=>{
  const base=state(),slot=base.workflow.data.slots.find((entry:any)=>entry.role==='image:front');slot.candidates.push({id:'pending-fix',status:'pending'});
  base.job.data={...base.job.data,selectedItemId:item.id,selectedRole:'image:front',selectedCandidateId:'image-front',selectedCandidateExplicit:false};
  expect(resolveAssetNavigationSelection('images',base)).toMatchObject({role:'image:front',candidateId:'pending-fix',candidateExplicit:false});
  expect(resolveAssetItemSelection('images',base,item.id)).toMatchObject({candidateId:'pending-fix',candidateExplicit:false});
  const explicitlySelected={...base,job:{...base.job,data:{...base.job.data,selectedCandidateExplicit:true}}};
  expect(resolveAssetNavigationSelection('images',explicitlySelected)).toMatchObject({candidateId:'image-front',candidateExplicit:true});
  expect(resolveAssetItemSelection('images',explicitlySelected,item.id)).toMatchObject({candidateId:'image-front',candidateExplicit:true});
  expect(slot.acceptedCandidateId).toBe('image-front');
 });
});
