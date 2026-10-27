import {describe, expect, it} from 'vitest';
import {RpcSchema} from '../shared/contracts';
import {isTextureGroupKey, textureGroupLabel, validateGroupDefinitions} from '../shared/character-groups';
import {prepareGroupRepartition} from './group-repartition';

const id = '12345678-1234-4123-8123-123456789abc';
const component = (n: number) => n.toString(16).padStart(24, '0');
const slot = (key: string, stepKey: string, group?: string) => ({key, stepKey, group, ...(key.startsWith('texture-reference-')?{purpose:'texture-references'}:{}), required: true, artifactId: `old-${key}`, hash: 'a'.repeat(64), candidateId: `candidate-${key}`, reviewStatus: 'accepted', candidates: [{id: `candidate-${key}`, artifactId: `old-${key}`, reviewStatus: 'accepted', reviewedBy: 'human'}]});

describe('arbitrary agent-defined character groups', () => {
  it('accepts multiple independent arbitrary names and more than five assembly inputs', () => {
    const names = ['strange_device_7', 'cloth_cluster', 'waist_assembly', 'tiny_prop'];
    const assignments = names.map((group, index) => ({componentId: component(index), group}));
    const groupDefinitions = names.map(key => ({key, name: `Logical object ${key}`}));
    expect(() => validateGroupDefinitions(assignments, groupDefinitions)).not.toThrow();
    const request = RpcSchema.parse({op: 'guided:surface:run', characterId: id, mode: 'repartition-groups', inputs: [{artifactId: id, source: 'head'}, {artifactId: id, source: 'body'}], assignments, groupDefinitions, expectedRevision: 7});
    expect((request as any).groupDefinitions).toEqual(groupDefinitions);
    const assembly = RpcSchema.parse({op: 'guided:surface:run', characterId: id, mode: 'assemble-returns', inputs: [...names, 'head', 'upper_body', 'lower_body'].map(source => ({artifactId: id, source}))});
    expect((assembly as any).inputs).toHaveLength(7);
    expect(textureGroupLabel('waist_assembly', [{key: 'waist_assembly', name: 'Ремень и ножны'}], 'ru')).toBe('Ремень и ножны');
  });
  it('rejects unsafe, colliding, unnamed and unused group definitions while retaining legacy groups', () => {
    for (const key of ['../belt', 'belt/front', 'body', 'assembled', 'constructor', '__proto__', 'CON'.toLowerCase(), 'group-key', 'x'.repeat(65)]) expect(isTextureGroupKey(key)).toBe(false);
    expect(() => validateGroupDefinitions([{componentId: component(1), group: 'accessories'}])).not.toThrow();
    expect(() => validateGroupDefinitions([{componentId: component(1), group: 'anything'}])).toThrow(/name/i);
    expect(() => validateGroupDefinitions([{componentId: component(1), group: 'anything'}], [{key: 'anything', name: 'One'}, {key: 'anything', name: 'Two'}])).toThrow();
    expect(() => validateGroupDefinitions([{componentId: component(1), group: 'head'}], [{key: 'unused', name: 'Empty object'}])).toThrow();
  });
  it('retires removed groups without deleting their version history and keeps untouched adopted references', () => {
    const state: any = {currentStepKey: 'texture-references', completedStepKeys: ['source', 'views', 'review-images', 'generate-mesh', 'receive-mesh', 'segment-mesh', 'receive-segments', 'prepare-groups'],
      groups: [{key: 'head', source: 'head', componentIds: [component(0)]}, {key: 'lower_body', source: 'body', componentIds: [component(1), component(2)]}, {key: 'old_prop', source: 'body', componentIds: [component(3)]}],
      slots: [slot('texture-reference-head-front', 'texture-references', 'head'), slot('texture-reference-lower_body-front', 'texture-references', 'lower_body'), slot('texture-reference-old_prop-back', 'texture-references', 'old_prop'), slot('textured-assembly', 'receive-materials')],
      surfaceMapping: {passed: true}, geometryBaseline: {current: true}, finalChecks: {passed: true}};
    const head = structuredClone(state.slots[0]);
    const result = prepareGroupRepartition(state, [{id: 'head', source: 'head', componentIds: [component(0)]}, {id: 'lower_body', source: 'body', componentIds: [component(1)]}, {id: 'one_compound_object', source: 'body', componentIds: [component(2), component(3)]}], 'partition-op');
    expect([...result.changed].sort()).toEqual(['lower_body', 'old_prop', 'one_compound_object']);
    expect(state.slots[0]).toEqual(head);
    expect(state.slots[1]).toMatchObject({artifactId: 'old-texture-reference-lower_body-front', reviewStatus: 'accepted', groupChangeNotice: {retainedHumanApproval:true}});
    expect(state.slots[2]).toMatchObject({retiredGroup: true, required: false, reviewStatus: 'invalidated'});
    expect(state.slots[2].candidates[0].artifactId).toBe('old-texture-reference-old_prop-back');
    expect(state.slots[3].reviewStatus).toBe('invalidated');
    expect(state.surfaceMapping.passed).toBe(false); expect(state.geometryBaseline.current).toBe(false); expect(state.finalChecks.passed).toBe(false);
    expect(state.currentStepKey).toBe('prepare-groups'); expect(state.completedStepKeys).not.toContain('prepare-groups');
    expect(state.groupPartitionHistory[0].groups).toHaveLength(3);
  });
  it('retains image approval with a guide-review notice when the saved world surface changed',()=>{
    const state:any={currentStepKey:'texture-references',completedStepKeys:['prepare-groups'],groups:[{key:'custom_thing',source:'body',componentIds:[component(1)]}],slots:[slot('texture-reference-custom_thing-front','texture-references','custom_thing')]};const result=prepareGroupRepartition(state,[{id:'custom_thing',source:'body',componentIds:[component(1)],baselineSurfaceUnchanged:false}],'surface-proof');expect(result.changed.has('custom_thing')).toBe(true);expect(state.slots[0].reviewStatus).toBe('accepted');expect(state.slots[0].groupChangeNotice).toBeDefined();
  });
  it('does not invalidate geometry or advance/rewind stages for a label-only change', () => {
    const state: any = {groups: [{key: 'custom_thing', name: 'Old label', source: 'body', componentIds: [component(1)]}], slots: [slot('texture-reference-custom_thing-front', 'texture-references', 'custom_thing'), slot('textured-assembly', 'receive-materials')], currentStepKey: 'texture-references', completedStepKeys: ['prepare-groups']};
    const result = prepareGroupRepartition(state, [{id: 'custom_thing', name: 'Better label', source: 'body', componentIds: [component(1)]}], 'label-op');
    expect(result.changed.size).toBe(0); expect(state.slots[0].reviewStatus).toBe('accepted'); expect(state.currentStepKey).toBe('texture-references'); expect(state.slots[1].reviewStatus).toBe('accepted');
  });
});
