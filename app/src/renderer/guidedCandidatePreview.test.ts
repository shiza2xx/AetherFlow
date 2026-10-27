import {describe,it,expect} from 'vitest';
import {guidedCandidatePreview} from './guidedCandidatePreview';

describe('history inspection without adoption',()=>{
 const failed={id:'failed',artifactId:'failed-png',reviewStatus:'invalidated',technicalValidation:{status:'failed',reason:'grayscale'}};
 it('shows the newest failed candidate when there is no working output',()=>{
  const slot={id:'depth',candidates:[{...failed,id:'older',artifactId:'old-png'},failed]},before=structuredClone(slot);
  expect(guidedCandidatePreview(slot)).toMatchObject({artifactId:'failed-png',historyOnly:true,candidate:failed});
  expect(slot).toEqual(before);
 });
 it('preserves the current result unless history is explicitly selected and never mutates it',()=>{
  const slot={id:'depth',artifactId:'working-png',candidateId:'working',candidates:[failed]},before=structuredClone(slot);
  expect(guidedCandidatePreview(slot).artifactId).toBe('working-png');
  expect(guidedCandidatePreview(slot,{slotId:'depth',candidateId:'failed'})).toMatchObject({artifactId:'failed-png',historyOnly:true});
  expect(guidedCandidatePreview(slot,null).artifactId).toBe('working-png');expect(slot).toEqual(before);
 });
 it('does not carry another slot inspection into a different view',()=>{
  const slot={id:'right',artifactId:'right-png',candidates:[failed]};
  expect(guidedCandidatePreview(slot,{slotId:'left',candidateId:'failed'})).toMatchObject({artifactId:'right-png',historyOnly:false});
 });
});
