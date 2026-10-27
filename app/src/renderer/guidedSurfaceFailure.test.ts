import {describe,expect,it} from 'vitest';
import {surfaceFailureMessage,surfaceFailureTransition} from './guidedSurfaceFailure';

describe('guided surface operation recovery messages',()=>{
 it('localizes immutable accepted assembly recovery toward head fitting',()=>{
  const failure={code:'ASSEMBLY_ALREADY_ACCEPTED_USE_HEAD_FIT',operation:'assemble-returns',phase:'preflight'};
  expect(surfaceFailureMessage('en',failure)).toContain('Continue with head fitting');
  expect(surfaceFailureMessage('ru',failure)).toContain('Продолжите подгонку головы');
 });
 it('localizes known geometry, UV, group and alignment causes with workflow context',()=>{
  const cases:[string,string][]=[
   ['SURFACE_FACE_COUNT_MISMATCH','triangle count'],['SURFACE_FACE_WINDING_MISMATCH','reversed winding'],
   ['SURFACE_FACE_CORRESPONDENCE_MISSING','no matching face'],['SURFACE_FACE_CORRESPONDENCE_AMBIGUOUS','overlapping faces'],
   ['SURFACE_FACE_CORRESPONDENCE_DUPLICATE','duplicated faces'],['SURFACE_REFERENCE_UV_MISSING','UV layer'],
   ['SURFACE_GROUP_SET_MISMATCH','group baseline'],['SURFACE_GROUP_ALIGNMENT_FAILED','uniform scale'],
  ];
  for(const [code,needle] of cases){const english=surfaceFailureMessage('en',{code,operation:'assemble-returns',group:'upper_body'}),russian=surfaceFailureMessage('ru',{code,operation:'assemble-returns',group:'upper_body'});expect(english).toContain('Stage 10');expect(english).toContain('upper body');expect(english.toLowerCase()).toContain(needle.toLowerCase());expect(russian).toContain('Этап 10');expect(russian).toContain('верх тела');expect(russian).not.toContain('недоступного файла');}
 });
 it('keeps legacy causes explicitly unknown and never implies a missing file',()=>{
  const message=surfaceFailureMessage('ru',{code:'SURFACE_OPERATION_FAILED',operation:'assemble-returns',phase:'legacy'});expect(message).toContain('Этап 10');expect(message).toContain('причина неизвестна');expect(message).toContain('Причина, связанная с геометрией, не предполагается');expect(message).not.toContain('недоступного файла');
 });
});

describe('surface failure lifetime',()=>{
 it('retains an unresolved failure across unrelated refreshes and dismisses only the selected operation',()=>{
  const failure={id:'failed-1',status:'failed',failure:{code:'SURFACE_FACE_COUNT_MISMATCH'}};expect(surfaceFailureTransition(failure,null,null)).toMatchObject({kind:'show',operationId:'failed-1'});expect(surfaceFailureTransition(failure,'failed-1',null)).toMatchObject({kind:'show',operationId:'failed-1'});expect(surfaceFailureTransition(failure,'failed-1','failed-1')).toEqual({kind:'keep'});
 });
 it('clears a displayed failure only after a later surface operation completes',()=>{
  expect(surfaceFailureTransition({id:'running-2',status:'running'},'failed-1',null)).toEqual({kind:'keep'});expect(surfaceFailureTransition({id:'failed-2',status:'failed',failure:{code:'SURFACE_FACE_WINDING_MISMATCH'}},'failed-1',null)).toMatchObject({kind:'show',operationId:'failed-2'});expect(surfaceFailureTransition({id:'completed-3',status:'complete'},'failed-1',null)).toEqual({kind:'clear'});expect(surfaceFailureTransition({id:'failed-1',status:'complete'},'failed-1',null)).toEqual({kind:'keep'});
 });
});
