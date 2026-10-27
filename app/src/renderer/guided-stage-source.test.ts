import {describe,expect,it} from 'vitest';
import {currentAcceptedFittedSlot,currentRigSourceSlot,preferredGuidedStageSourceId} from './guided-stage-source';

const fitHash='b'.repeat(64),baselineHash='c'.repeat(64);
const fit={current:true,confirmed:true,repairRequired:false,artifactId:'accepted-fit-blend',hash:fitHash};
const meshArtifact={id:'valid-fbx',name:'Rig source',data:{hash:'d'.repeat(64),sourceName:'mesh-only.fbx'}};
const slots=[
 {id:'mesh-fbx-slot',key:'mesh-only-fbx',artifactId:'valid-fbx',hash:meshArtifact.data.hash,reviewStatus:'submitted',artifact:meshArtifact},
 {id:'fit-slot',key:'fitted-assembly',artifactId:'accepted-fit-blend',hash:fitHash,reviewStatus:'accepted'},
 {id:'geometry-slot',key:'geometry-baseline',artifactId:'baseline',hash:baselineHash,reviewStatus:'accepted'},
 {id:'surface-slot',key:'surface-baseline',artifactId:'surface',hash:'e'.repeat(64),reviewStatus:'accepted'},
];
const currentBaseline={artifactId:'baseline',hash:baselineHash,verifiedHash:baselineHash,current:true,fittedAssemblyArtifactId:'accepted-fit-blend',fittedAssemblyHash:fitHash,proof:{sourceHashes:{assembled:fitHash}}};

describe('persisted guided fit and rig-source selection',()=>{
 it('keeps the first head-fit editor reachable after accepted prerequisites but before a fitted artifact exists',()=>{
  const prerequisites=[{id:'empty-fit-slot',key:'fitted-assembly',artifactId:null,reviewStatus:'pending'}];
  expect(preferredGuidedStageSourceId('receive-materials',prerequisites,{current:false},undefined,true)).toBe('empty-fit-slot');
  expect(preferredGuidedStageSourceId('receive-materials',prerequisites,{current:false},undefined,false)).toBeNull();
  expect(preferredGuidedStageSourceId('receive-materials',[{...prerequisites[0],artifactId:'old-invalidated-fit',reviewStatus:'invalidated'}],{current:false},undefined,true)).toBeNull();
 });
 it('shows a revisited accepted fit when the prior FBX/baseline is invalidated',()=>{
  const old=[{...slots[0],reviewStatus:'invalidated'},{...slots[1]},{...slots[2],reviewStatus:'invalidated'},{...slots[3],reviewStatus:'invalidated'}];
  expect(currentAcceptedFittedSlot(old,fit)?.artifactId).toBe('accepted-fit-blend');
  expect(preferredGuidedStageSourceId('receive-materials',old,fit,currentBaseline)).toBe('fit-slot');
  expect(preferredGuidedStageSourceId('export-rig-source',old,fit,{...currentBaseline,current:false})).toBe('fit-slot');
 });
 it('uses the regenerated FBX only when its verified baseline traces back to this exact accepted fit',()=>{
  expect(currentRigSourceSlot(slots,fit,currentBaseline)?.artifactId).toBe('valid-fbx');
  expect(preferredGuidedStageSourceId('export-rig-source',slots,fit,currentBaseline)).toBe('mesh-fbx-slot');
  expect(preferredGuidedStageSourceId('receive-materials',slots,fit,currentBaseline)).toBe('fit-slot');
  expect(preferredGuidedStageSourceId('export-rig-source',slots,fit,{...currentBaseline,fittedAssemblyHash:'f'.repeat(64)})).toBe('fit-slot');
  expect(preferredGuidedStageSourceId('export-rig-source',slots,fit,{...currentBaseline,proof:{sourceHashes:{assembled:'f'.repeat(64)}}})).toBe('fit-slot');
 });
 it('keeps an accepted texture-only Workbench version visible ahead of a legacy FBX while retaining its geometry baseline',()=>{
  const correctedFit={...slots[1],operativeArtifactId:'workbench-texture-v2',operativeHash:'f'.repeat(64),workbenchCorrection:true,workbenchPurpose:'textures'},correctedSlots=[slots[0],correctedFit,...slots.slice(2)],operativeFit={...fit,artifactId:'workbench-texture-v2',hash:'f'.repeat(64)};
  expect(currentAcceptedFittedSlot(correctedSlots,operativeFit)?.id).toBe('fit-slot');
  expect(preferredGuidedStageSourceId('receive-materials',correctedSlots,operativeFit,currentBaseline)).toBe('fit-slot');
  expect(preferredGuidedStageSourceId('export-rig-source',correctedSlots,operativeFit,currentBaseline)).toBe('fit-slot');
  // The rig is still verified against the original fitted bytes; material-only corrections do not replace its immutable geometry baseline.
  expect(currentRigSourceSlot(correctedSlots,operativeFit,currentBaseline)?.artifactId).toBe('valid-fbx');
 });
 it('never selects an operative fitted slot marked stale even if a caller reports its identity',()=>{
  const stale=[{...slots[1],operativeArtifactId:'stale-correction',operativeHash:'f'.repeat(64),operativeStale:true}];
  expect(currentAcceptedFittedSlot(stale,{...fit,artifactId:'stale-correction',hash:'f'.repeat(64)})).toBeNull();
  expect(preferredGuidedStageSourceId('receive-materials',stale,{...fit,artifactId:'stale-correction',hash:'f'.repeat(64)})).toBeNull();
 });
 it('does not promote pending, stale, invalidated, or hash-mismatched fits and FBX candidates',()=>{
  const invalidFit=[{id:'fit-slot',key:'fitted-assembly',artifactId:'fit',hash:fitHash,reviewStatus:'invalidated'}];
  for(const headFit of [
   {current:false,confirmed:false,artifactId:'fit',hash:fitHash},
   {current:true,confirmed:false,artifactId:'fit',hash:fitHash},
   {current:true,confirmed:true,repairRequired:true,artifactId:'fit',hash:fitHash},
   {current:true,confirmed:true,artifactId:'fit',hash:'f'.repeat(64)},
  ])expect(preferredGuidedStageSourceId('export-rig-source',invalidFit,headFit)).toBeNull();
  expect(currentRigSourceSlot([{...slots[0],reviewStatus:'invalidated'},...slots.slice(1)],fit,currentBaseline)).toBeNull();
  expect(currentRigSourceSlot(slots,fit,{...currentBaseline,current:false})).toBeNull();
 });
});
