import {describe,expect,it} from 'vitest';
import {assetSlotCandidateView} from './asset-slot-candidates';

const candidates=[
 {id:'accepted',status:'accepted'},
 {id:'pending-old',status:'pending'},
 {id:'rejected',status:'rejected'},
 {id:'pending-new',status:'pending'},
];

describe('asset slot candidate presentation',()=>{
 it('shows one selected candidate and keeps every other version in history',()=>{
  const view=assetSlotCandidateView({acceptedCandidateId:'accepted',candidates},'pending-old',true);
  expect(view.primary?.id).toBe('pending-old');
  expect(view.history.map(candidate=>candidate.id)).toEqual(['accepted','rejected','pending-new']);
  expect(view.pendingReview?.id).toBe('pending-new');
  expect([view.primary,...view.history].map(candidate=>candidate?.id).sort()).toEqual(candidates.map(candidate=>candidate.id).sort());
 });

 it('surfaces the latest pending candidate by default before the accepted production version',()=>{
  const view=assetSlotCandidateView({acceptedCandidateId:'accepted',candidates});
  expect(view.primary?.id).toBe('pending-new');
  expect(view.history.map(candidate=>candidate.id)).toContain('accepted');
  expect(view.pendingReview).toBeNull();
  expect(assetSlotCandidateView({acceptedCandidateId:'accepted',candidates:[candidates[0]]}).primary?.id).toBe('accepted');
  expect(assetSlotCandidateView({candidates:[candidates[1],candidates[2],candidates[3]]}).primary?.id).toBe('pending-new');
 });

 it('preserves an explicit accepted selection and offers the hidden pending version for review',()=>{
  const view=assetSlotCandidateView({acceptedCandidateId:'accepted',candidates},'accepted',true);
  expect(view.primary?.id).toBe('accepted');
  expect(view.pendingReview?.id).toBe('pending-new');
  expect(view.history.map(candidate=>candidate.id)).toEqual(['pending-old','rejected','pending-new']);
 });

 it('only displays a rejected candidate when the user explicitly selects it',()=>{
  expect(assetSlotCandidateView({candidates:[candidates[2]]},'rejected').primary).toBeNull();
  expect(assetSlotCandidateView({candidates:[candidates[2]]},'rejected',true).primary?.id).toBe('rejected');
 });
});
