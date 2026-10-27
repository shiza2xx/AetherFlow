import { describe, expect, it } from 'vitest';
import { getGuideActionCompletion,getGuideActionTarget,nextGuideAction, type GuideState } from './JourneyStepGuide';

const exportState = (rigBaselineCurrent: boolean): GuideState => ({
  locale: 'en',
  stepKey: 'export-rig-source',
  currentStepKey: 'export-rig-source',
  slots: [
    { slotKey: 'mesh-only-fbx', artifactId: 'fbx', purpose: 'model', required: true },
    { slotKey: 'geometry-baseline', artifactId: 'geometry', purpose: 'model', required: true },
    { slotKey: 'surface-baseline', artifactId: 'surface', purpose: 'model', required: true },
  ],
  sourcesCount: 1,
  canContinue: true,
  blockers: [],
  headFit: { current: true, confirmed: true, rigBaselineCurrent },
});

describe('guided stage progress labels', () => {
  it('takes grouping actions to the visible agent entry, not the advanced manual table',()=>{expect(getGuideActionTarget('prepare-groups',0)).toBe('agent');expect(getGuideActionTarget('prepare-groups',1)).toBe('results');expect(getGuideActionTarget('prepare-groups',2)).toBe('continue');});
  it('does not present stale rig-baseline artifacts as ready for handoff', () => {
    expect(getGuideActionCompletion(exportState(false), ['Create mesh-only FBX', 'Confirm rig baseline'])).toEqual([true, false]);
  });

  it('shows the rig handoff as complete only for a current confirmed fit lineage', () => {
    expect(getGuideActionCompletion(exportState(true), ['Create mesh-only FBX', 'Confirm rig baseline'])).toEqual([true, true]);
  });

  it('does not mark a fitting result complete while the registered fit is stale', () => {
    const state = exportState(true);
    state.stepKey = 'receive-materials';
    state.headFit = { current: false, confirmed: false };
    state.slots.push({ slotKey: 'fitted-assembly', artifactId: 'old-fit', purpose: 'model', required: true });
    expect(getGuideActionCompletion(state, Array(6).fill('stage action'))).toEqual([false, false, false, false, false, false]);
  });
});


describe('manual work updates the action checklist from saved evidence', () => {
 const state = (stepKey:string):GuideState => ({locale:'en',stepKey,currentStepKey:stepKey,slots:[],sourcesCount:1,canContinue:false,blockers:[]});
 const actions=['First action','Second action','Third action'];
 it('requires a physical delivery before declaring an export action complete',()=>{
  const p=state('generate-mesh');p.slots=['head','body'].map(part=>({slotKey:`depth-handoff-${part}`,artifactId:part,purpose:'handoff',required:true,delivered:false}));
  expect(getGuideActionCompletion(p,actions)).toEqual([false,false,false]);
  p.slots.forEach(slot=>slot.delivered=true);
  expect(getGuideActionCompletion(p,actions)).toEqual([true,false,false]);
 });
 it('moves from import to review after both models arrive, retaining human approval',()=>{
  const p=state('receive-mesh');p.slots=['head','body'].map(part=>({slotKey:`mesh-${part}`,artifactId:part,purpose:'model',required:true,reviewStatus:'pending'}));p.evidence={selectedMesh:{head:'head',body:'body'}};
  expect(getGuideActionCompletion(p,actions)).toEqual([true,false,false]);
  p.slots.forEach(slot=>slot.reviewStatus='accepted');p.canContinue=true;
  expect(getGuideActionCompletion(p,actions)).toEqual([true,true,true]);
 });
 it('never counts invalidated generated images toward a completed action',()=>{
  const p=state('views');p.slots=Array.from({length:8},(_,i)=>({artifactId:String(i),purpose:'views',required:true,reviewStatus:i===7?'invalidated':'pending'}));
  expect(getGuideActionCompletion(p,actions)[0]).toBe(false);
 });
 it('marks a completed external handoff complete when revisiting it',()=>{
  const p=state('rig-manual');p.completedStep=true;
  expect(getGuideActionCompletion(p,actions)).toEqual([true,true,true]);
 });
 for(const stepKey of ['texture-repair','weight-cleanup'])it(`allows the audited no-repair path for ${stepKey}`,()=>{
  const p=state(stepKey);p.evidence=stepKey==='texture-repair'?{textureRepair:{decision:'no-repair',auditPassed:true}}:{weightCleanup:{decision:'no-repair',auditPassed:true}};p.canContinue=true;
  expect(getGuideActionCompletion(p,actions)).toEqual([true,true,true]);
 });
 it('tracks texture-reference generation, acceptance and physical delivery separately',()=>{
  const p=state('texture-references');p.slots=['front','back'].map(view=>({slotKey:`texture-reference-hair-${view}`,artifactId:view,purpose:'texture-references',required:true,reviewStatus:'pending'}));
  expect(getGuideActionCompletion(p,actions)).toEqual([true,false,false]);
  p.slots.forEach(slot=>slot.reviewStatus='accepted');p.slots.push({slotKey:'texture-handoff-hair',artifactId:'package',purpose:'handoff',required:true,delivered:false});
  expect(getGuideActionCompletion(p,actions)).toEqual([true,true,false]);p.slots[2].delivered=true;
  expect(getGuideActionCompletion(p,actions)).toEqual([true,true,true]);
 });
});

it('keeps assembly review, surface mapping review, fitting and fit confirmation as distinct actions',()=>{expect(Array.from({length:6},(_,i)=>getGuideActionTarget('receive-materials',i))).toEqual(['results','operations','results','results','head-fit','head-fit-review']);});

it('offers Continue when a completed historical stage can return to current work',()=>{const p=exportState(true);p.currentStepKey='rig-manual';p.completedStep=true;expect(nextGuideAction(p).target).toBe('continue');});

it('does not report that a saved archive is a ready physical delivery',()=>{const p=exportState(true);p.stepKey=p.currentStepKey='generate-mesh';p.slots=['head','body'].map(part=>({slotKey:`depth-handoff-${part}`,artifactId:part,purpose:'model',required:true,delivered:false}));expect(nextGuideAction(p).target).toBe('operations');expect(nextGuideAction(p).text).toContain('folder');p.slots.forEach(slot=>slot.delivered=true);expect(nextGuideAction(p).target).toBe('continue');});
