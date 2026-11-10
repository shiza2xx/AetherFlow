import { describe, expect, it } from 'vitest';
import { assetGeometryProgressSteps, assetPhotoRoleLabel, assetPhotoWaitingReason, assetStage4ReturnSections, assetTexturingHandoffGroups, assetTexturingHandoffWaitingReason, hasAssetPhotoFiles, hasExistingAssetReturnModels, shouldShowAssetReturnWorkflow } from './asset-stage4-presentation';

describe('Stage 4 return presentation', () => {
  it('localizes photo roles and actionable missing, stale, and pending reasons', () => {
    expect(assetPhotoRoleLabel('image:front', 'ru')).toBe('Цвет · спереди');
    expect(assetPhotoRoleLabel('depth:side', 'ru')).toBe('Карта глубины · сбоку');
    expect(assetPhotoRoleLabel('foliage:top', 'en')).toBe('Foliage · top');
    expect(assetPhotoRoleLabel('sheet', 'ru')).toBe('Общий лист геометрии');
    expect(assetPhotoWaitingReason('Accept a current color view before geometry generation.', 'ru')).toBe('Примите актуальную цветную фотографию этого ракурса.');
    expect(assetPhotoWaitingReason('A current image candidate is awaiting human review.', 'ru')).toBe('Текущий вариант ожидает проверки.');
    expect(assetPhotoWaitingReason('The accepted image is stale; review a current return before exporting.', 'ru')).toBe('Этот принятый вид устарел. Примите актуальный источник и экспортируйте снова.');
    expect(assetPhotoWaitingReason('Accept a current depth view paired with the current color view.', 'en')).toBe('Accept a current depth map paired with its color view.');
    expect(assetPhotoWaitingReason('The accepted shared sheet mapping is missing or corrupt.', 'ru')).toBe('Нужен актуальный общий лист геометрии с целой картой сопоставления.');
  });

  it('requires at least one exported photo before revealing a new return slider and preserves prior model history', () => {
    const empty = { data: { slots: [], sharedSources: [] } };
    expect(shouldShowAssetReturnWorkflow(null, empty)).toBe(false);
    const oneFile = { path: 'colored/prop-front.png', hash: 'a'.repeat(64) };
    expect(hasAssetPhotoFiles({ entries: [] })).toBe(false);
    expect(hasAssetPhotoFiles({ receipt: { entries: [] } })).toBe(false);
    expect(hasAssetPhotoFiles({ entries: [oneFile] })).toBe(true);
    expect(shouldShowAssetReturnWorkflow({ operationId: null, current: true, status: 'empty', entries: [], waiting: [{}] }, empty)).toBe(false);
    expect(shouldShowAssetReturnWorkflow({ operationId: 'old-empty-export', current: true, status: 'partial', receipt: { entries: [], waiting: [{}] } }, empty)).toBe(false);
    expect(shouldShowAssetReturnWorkflow({ operationId: 'export-1', current: true, status: 'partial', receipt: { entries: [oneFile] } }, empty)).toBe(true);
    expect(shouldShowAssetReturnWorkflow({ operationId: 'export-2', current: true, status: 'ready', entries: [oneFile] }, empty)).toBe(true);
    expect(shouldShowAssetReturnWorkflow({ operationId: 'export-2', current: false, status: 'outdated', entries: [oneFile] }, empty)).toBe(false);
    expect(shouldShowAssetReturnWorkflow({ operationId: 'export-2', current: true, status: 'failed', entries: [oneFile] }, empty)).toBe(false);
    for (const status of ['pending', 'accepted', 'rejected']) {
      const workflow = { data: { slots: [{ role: 'geometry', candidates: [{ status }] }], sharedSources: [] } };
      expect(hasExistingAssetReturnModels(workflow)).toBe(true);
      expect(shouldShowAssetReturnWorkflow({ operationId: 'old-empty-export', current: true, status: 'partial', receipt: { entries: [] } }, workflow)).toBe(true);
    }
    expect(shouldShowAssetReturnWorkflow(null, { data: { slots: [], sharedSources: [{ status: 'accepted' }] } })).toBe(true);
  });

  it('keeps shared-only projects on their shared step without an empty individual slider', () => {
    const sharedOnly = [{ data: { route: 'shared-prop' } }], moduleOnly = [{ data: { route: 'module' } }], foliageOnly = [{ data: { route: 'foliage' } }];
    expect(assetStage4ReturnSections(sharedOnly, false)).toEqual({ individualGeometry: false, sharedGeometry: false, textureReturns: false });
    expect(assetStage4ReturnSections(sharedOnly, true)).toEqual({ individualGeometry: false, sharedGeometry: true, textureReturns: true });
    expect(assetStage4ReturnSections(moduleOnly, true)).toEqual({ individualGeometry: true, sharedGeometry: false, textureReturns: false });
    expect(assetStage4ReturnSections(foliageOnly, true)).toEqual({ individualGeometry: false, sharedGeometry: false, textureReturns: false });
  });

  it('shows only real route steps and keeps modules separate from shared texture returns', () => {
    const module = { id: 'module', data: { route: 'module' } }, shared = { id: 'shared', data: { route: 'shared-prop' } }, foliage = { id: 'foliage', data: { route: 'foliage' } };
    const empty = (items: any[]) => ({ items, current: items.map(item => ({ itemId: item.id })), workflow: { data: { slots: [] } } });
    expect(assetGeometryProgressSteps(empty([module]), null).map(step => step.id)).toEqual(['photos', 'individual']);
    expect(assetGeometryProgressSteps(empty([shared]), null).map(step => step.id)).toEqual(['photos', 'shared-geometry', 'shared-textures']);
    expect(assetGeometryProgressSteps(empty([foliage]), null).map(step => step.id)).toEqual(['foliage']);
    expect(assetGeometryProgressSteps(empty([module, shared, foliage]), null).map(step => step.id)).toEqual(['photos', 'individual', 'shared-geometry', 'shared-textures', 'foliage']);
  });

  it('marks only current accepted work complete and exposes pending legacy reviews', () => {
    const module = { id: 'module', data: { route: 'module' } }, shared = { id: 'shared', data: { route: 'shared-prop' } };
    const ctx: any = { items: [module, shared], current: [
      { itemId: 'module', geometry: { status: 'accepted' } },
      { itemId: 'shared', geometry: { status: 'accepted' }, sharedPartitionReady: true, material: { status: 'accepted' } },
    ], workflow: { data: { slots: [{ itemId: 'module', role: 'guide:front', candidates: [{ status: 'pending' }] }] } } };
    const steps = assetGeometryProgressSteps(ctx, { operationId: 'export', current: true, status: 'ready', receipt: { entries: [{ path: 'color.png', hash: 'a'.repeat(64) }], waiting: [] } });
    expect(steps.map(step => [step.id, step.done])).toEqual([
      ['photos', true], ['individual', true], ['shared-geometry', true], ['shared-textures', true], ['additional-review', false],
    ]);
    ctx.current[1].materialNeedsCompatibilityReview = true;
    expect(assetGeometryProgressSteps(ctx, null).find(step => step.id === 'shared-textures')?.done).toBe(false);
  });

  it('opens an additional review step for a stale accepted material color reference', () => {
    const module = { id: 'module', data: { route: 'module' } };
    const ctx = {
      items: [module],
      current: [{ itemId: 'module', geometry: { status: 'accepted' }, materialInputFingerprint: 'new' }],
      workflow: { data: { slots: [{ itemId: 'module', role: 'material-reference:front', acceptedCandidateId: 'reference', candidates: [{ id: 'reference', status: 'accepted', inputFingerprint: 'old' }] }] } },
    };
    expect(assetGeometryProgressSteps(ctx, null).map(step => step.id)).toEqual(['photos', 'individual', 'additional-review']);
  });

  it('groups only verified registered models and color references under their exact item owners', () => {
    const hash = 'a'.repeat(64), shared = { itemId: 'prop-a', itemName: 'Lantern', artifactId: 'artifact', hash, path: 'Lantern/geometry/model.fbx' };
    expect(assetTexturingHandoffGroups([
      { ...shared, role: 'geometry' },
      { ...shared, role: 'image:front', path: 'Lantern/color/front.png' },
      { ...shared, role: 'image:side', path: 'Lantern/color/side.png' },
      { ...shared, itemId: 'prop-b', itemName: 'Crate', role: 'geometry', path: 'Crate/geometry/model.fbx' },
      { ...shared, itemId: 'unverified', itemName: 'Bad hash', role: 'geometry', hash: 'bad' },
      { ...shared, role: 'depth:front' },
      { ...shared, role: 'partition-source' },
    ])).toEqual([
      { itemId: 'prop-a', itemName: 'Lantern', model: { ...shared, role: 'geometry' }, colorReferences: [
        { ...shared, role: 'image:front', path: 'Lantern/color/front.png' },
        { ...shared, role: 'image:side', path: 'Lantern/color/side.png' },
      ] },
      { itemId: 'prop-b', itemName: 'Crate', model: { ...shared, itemId: 'prop-b', itemName: 'Crate', role: 'geometry', path: 'Crate/geometry/model.fbx' }, colorReferences: [] },
    ]);
    expect(assetTexturingHandoffWaitingReason('Foliage uses cards, not Tripo geometry.', 'ru')).toContain('Листва');
    expect(assetTexturingHandoffWaitingReason('A current human-accepted geometry model is required.', 'en')).toContain('Accept this separated prop’s current model');
    expect(assetTexturingHandoffWaitingReason('A current human-accepted partitioned model from the accepted shared sheet is required.', 'ru')).toContain('разделённую модель');
    expect(assetTexturingHandoffWaitingReason('A current human-accepted front color reference is required.', 'ru')).toContain('Примите актуальный цветной референс');
  });
});
