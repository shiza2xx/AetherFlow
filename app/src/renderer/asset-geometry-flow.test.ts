import { describe, expect, it } from 'vitest';
import { assetGeometryStages, assetGeometryStep, assetTextureStep, currentAssetPhoto } from './asset-geometry-flow';

const accepted = (artifactId: string, hash: string, extra: Record<string, unknown> = {}) => ({ artifactId, hash, status: 'accepted', reviewedBy: 'human', inputFingerprint: 'a'.repeat(64), ...extra });

describe('asset Stage 4 return steps', () => {
  it('selects depth front only when it is current and paired with its color source', () => {
    const item = { id: 'depth-item', name: 'Depth box', data: { route: 'module', depthEnabled: true, views: ['front', 'side'] } }, state = {
      imageInputFingerprints: ['a'.repeat(64)],
      images: [{ role: 'image:front', candidate: accepted('color-id', 'b'.repeat(64)) }],
      depths: [{ role: 'depth:front', candidate: accepted('depth-id', 'c'.repeat(64), { dependsOnColorHash: 'b'.repeat(64) }) }],
    };
    expect(currentAssetPhoto(item, state)).toMatchObject({ role: 'depth:front', candidate: { artifactId: 'depth-id' } });
    state.depths[0].candidate = accepted('wrong-depth', 'd'.repeat(64), { dependsOnColorHash: 'e'.repeat(64) });
    expect(currentAssetPhoto(item, state)).toBeNull();
    state.depths[0].candidate = { ...accepted('stale-depth', 'f'.repeat(64), { dependsOnColorHash: 'b'.repeat(64) }), inputFingerprint: '9'.repeat(64) };
    expect(currentAssetPhoto(item, state)).toBeNull();

    state.images = [{ role: 'image', candidate: accepted('legacy-color', '8'.repeat(64)) }];
    state.depths = [{ role: 'depth', candidate: accepted('legacy-depth', '7'.repeat(64), { dependsOnColorHash: '8'.repeat(64) }) }];
    expect(currentAssetPhoto(item, state)).toMatchObject({ role: 'depth:front', candidate: { artifactId: 'legacy-depth' } });
  });

  it('keeps depth as the geometry lineage while showing only the current color front in its card', () => {
    const color = accepted('color-id', 'b'.repeat(64));
    const depth = accepted('depth-id', 'c'.repeat(64), { dependsOnColorHash: color.hash });
    const item = { id: 'depth-item', name: 'Depth box', data: { route: 'module', depthEnabled: true, views: ['front'] } };
    const state = { itemId: item.id, imageInputFingerprints: ['a'.repeat(64)], images: [{ role: 'image:front', candidate: color }], depths: [{ role: 'depth:front', candidate: depth }], geometryInputFingerprint: 'd'.repeat(64), geometryNeedsReview: false };
    const step = assetGeometryStep(item, state, { data: { slots: [] } });

    expect(step).toMatchObject({ role: 'depth:front', photo: { role: 'depth:front', candidate: { artifactId: 'depth-id' } }, displayPhoto: { role: 'image:front', candidate: { artifactId: 'color-id' } }, canImport: true });

    state.images = [];
    const withoutColor = assetGeometryStep(item, state, { data: { slots: [] } });
    expect(withoutColor.displayPhoto).toBeNull();
    expect(withoutColor.photo).toBeNull();
    expect(withoutColor.canImport).toBe(false);
  });

  it('shows a shared item’s current color front without claiming it is a geometry input', () => {
    const item = { id: 'shared-item', name: 'Shared prop', data: { route: 'shared-prop', depthEnabled: true, views: ['front'] } };
    const state = { itemId: item.id, imageInputFingerprints: ['a'.repeat(64)], images: [{ role: 'image:front', candidate: accepted('shared-color', 'b'.repeat(64)) }], depths: [] };
    expect(assetGeometryStep(item, state, { data: { slots: [] } })).toMatchObject({ photo: null, displayPhoto: { role: 'image:front', candidate: { artifactId: 'shared-color' } } });
  });

  it('waits for individual accepted geometry, then offers texturing only for current accepted shared partitions', () => {
    const ids = ['module', 'prop-a', 'prop-b'], items = ids.map((id, index) => ({ id, name: id, data: { route: index ? 'shared-prop' : 'module', depthEnabled: false, views: ['front'] } }));
    const stateFor = (id: string, hasGeometry: boolean, shared = false, partitioned = false) => ({ itemId: id, imageInputFingerprints: ['a'.repeat(64)], images: [{ role: 'image:front', candidate: accepted(`${id}-color`, `${id.length}`.repeat(64)) }], depths: [], geometry: hasGeometry ? accepted(`${id}-geometry`, '2'.repeat(64), shared ? { dependsOnSheetHash: '4'.repeat(64) } : {}) : null, geometryNeedsReview: false, materialInputFingerprint: '3'.repeat(64), materialNeedsCompatibilityReview: false, imagesNeedReview: false, sharedPartitionReady: partitioned, sharedSheetSource: shared ? { state: 'ready' } : null, sheets: shared ? [{ fresh: true, accepted: true, hash: '4'.repeat(64), candidate: accepted(`${id}-sheet`, '4'.repeat(64)) }] : [] });
    let ctx: any = { items, workflow: { data: { slots: [] } }, current: [stateFor(ids[0], false), stateFor(ids[1], false, true), stateFor(ids[2], false, true)] };
    expect(assetGeometryStages(ctx).individualReady).toBe(false);
    expect(assetGeometryStages(ctx).geometry).toHaveLength(1);
    expect(assetGeometryStages(ctx).sharedGeometry).toHaveLength(2);
    ctx.current[0] = stateFor(ids[0], true);
    expect(assetGeometryStages(ctx).individualReady).toBe(true);
    expect(assetGeometryStages(ctx).allGeometryReady).toBe(false);
    ctx.current[1] = stateFor(ids[1], true, true, true); ctx.current[2] = stateFor(ids[2], true, true, false);
    expect(assetGeometryStages(ctx).allGeometryReady).toBe(true);
    expect(assetGeometryStages(ctx).sharedSheetReady).toBe(true);
    expect(assetGeometryStages(ctx).texturing.map((step: any) => step.item.id)).toEqual(['prop-a', 'prop-b']);
    expect(assetGeometryStages(ctx).texturing.map((step: any) => step.canImport)).toEqual([true, false]);
    expect(assetGeometryStages(ctx).texturing.map((step: any) => step.geometryReady)).toEqual([true, false]);
  });

  it('marks current pending geometry for review and excludes stale pending candidates from import locks', () => {
    const item = { id: 'item', name: 'Item', data: { route: 'module', depthEnabled: false, views: ['front'] } }, state = { itemId: 'item', imageInputFingerprints: ['a'.repeat(64)], images: [{ role: 'image:front', candidate: accepted('color', 'b'.repeat(64)) }], depths: [], geometry: null, geometryInputFingerprint: 'c'.repeat(64), geometryNeedsReview: false };
    const ctx: any = { items: [item], current: [state], workflow: { data: { slots: [{ itemId: 'item', role: 'geometry', candidates: [{ artifactId: 'pending', status: 'pending', inputFingerprint: 'c'.repeat(64) }] }] } } };
    expect(assetGeometryStages(ctx).geometry[0]).toMatchObject({ canImport: false, pending: { artifactId: 'pending' } });
    ctx.workflow.data.slots[0].candidates[0].inputFingerprint = 'd'.repeat(64);
    expect(assetGeometryStages(ctx).geometry[0]).toMatchObject({ canImport: true, pending: null });
  });

  it('keeps the texture return on the original current color photo and blocks stale geometry or pending material', () => {
    const item = { id: 'item', name: 'Prop', data: { route: 'shared-prop', depthEnabled: true, views: ['front'] } };
    const color = accepted('original-color', 'b'.repeat(64));
    const state = { itemId: item.id, imageInputFingerprints: ['a'.repeat(64)], images: [{ role: 'image:front', candidate: color }], depths: [{ role: 'depth:front', candidate: accepted('geometry-depth', 'c'.repeat(64), { dependsOnColorHash: color.hash }) }], geometry: accepted('segmented-geometry', 'd'.repeat(64)), geometryInputFingerprint: 'e'.repeat(64), materialInputFingerprint: 'f'.repeat(64), geometryNeedsReview: false, materialNeedsCompatibilityReview: false, imagesNeedReview: false, sharedPartitionReady: true };
    const workflow: any = { data: { slots: [] } };
    expect(assetTextureStep(item, state, workflow)).toMatchObject({ photo: { role: 'image:front', candidate: { artifactId: 'original-color' } }, geometryReady: true, canImport: true });
    state.sharedPartitionReady = false;
    expect(assetTextureStep(item, state, workflow)).toMatchObject({ geometryReady: false, canImport: false });
    state.sharedPartitionReady = true;
    state.geometryNeedsReview = true;
    expect(assetTextureStep(item, state, workflow)).toMatchObject({ geometryReady: false, canImport: false });
    state.geometryNeedsReview = false;
    workflow.data.slots.push({ itemId: item.id, role: 'material', candidates: [{ status: 'pending', inputFingerprint: state.materialInputFingerprint }] });
    expect(assetTextureStep(item, state, workflow)).toMatchObject({ canImport: false, pending: { status: 'pending' } });
  });

  it('never offers a module in the shared-object texturing slider', () => {
    const item = { id: 'module', name: 'Already textured module', data: { route: 'module', depthEnabled: false, views: ['front'] } };
    const state = { itemId: item.id, imageInputFingerprints: ['a'.repeat(64)], images: [{ role: 'image:front', candidate: accepted('module-color', 'b'.repeat(64)) }], geometry: accepted('module-model', 'c'.repeat(64)), geometryNeedsReview: false, materialInputFingerprint: 'd'.repeat(64), materialNeedsCompatibilityReview: false, imagesNeedReview: false };
    expect(assetTextureStep(item, state, { data: { slots: [] } })).toMatchObject({ geometryReady: false, accepted: false, canImport: false });
    expect(assetGeometryStages({ items: [item], current: [state], workflow: { data: { slots: [] } } }).texturing).toEqual([]);
  });
});
