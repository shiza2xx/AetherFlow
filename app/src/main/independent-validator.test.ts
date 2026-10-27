import {describe,it,expect} from 'vitest';
import {independentRigAuditPasses,independentWeightAuditPasses} from './domain-service';

const hash='a'.repeat(64);
describe('independent Blender gate predicates',()=>{
 it('requires the actual candidate hash and disabled-autoexec independent validator identity for rig checks',()=>{const audit={ok:true,checkKey:'skeleton-and-actions-valid',outputHash:hash,autoexec:'disabled',details:{boneCount:188,restPoseFingerprint:'b'.repeat(64),weightsPreserved:true,actions:['T-pose','Walk']}};expect(independentRigAuditPasses(hash,audit)).toBe(true);expect(independentRigAuditPasses(hash,{...audit,autoexec:'enabled'})).toBe(false);expect(independentRigAuditPasses('c'.repeat(64),audit)).toBe(false);expect(independentRigAuditPasses(hash,{...audit,details:{...audit.details,weightsPreserved:false}})).toBe(false);});
 it('requires a matching verified weight report while preserving valid source weights above eight influences',()=>{const audit={ok:true,checkKey:'weight-invariants-valid',outputHash:hash,autoexec:'disabled',details:{editedVertices:0,unmodifiedWeightsPreserved:true,maxInfluences:9}};expect(independentWeightAuditPasses(hash,audit)).toBe(true);expect(independentWeightAuditPasses(hash,{...audit,outputHash:'c'.repeat(64)})).toBe(false);expect(independentWeightAuditPasses(hash,{...audit,details:{...audit.details,unmodifiedWeightsPreserved:false}})).toBe(false);expect(independentWeightAuditPasses(hash,{...audit,details:{...audit.details,maxInfluences:0}})).toBe(false);});
});
