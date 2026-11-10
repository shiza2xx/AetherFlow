import { describe, expect, it } from 'vitest';
import { assetModelImportProgressStep, requestAssetModelImportCancel, restoreAssetModelImportActivity, settleAssetModelImportCancel, settleAssetModelImportPreview, type AssetModelImportActivity } from './asset-model-import-status';

const previewing: AssetModelImportActivity = {
  ownerId: 'job-a',
  itemId: 'item-a',
  phase: 'geometry',
  operationId: 'operation-a',
  stage: 'preview',
  itemName: 'Bracket',
  fileName: 'bracket-update.zip',
  state: 'preview',
  message: 'The model is saved. Its preview is loading.',
  startedAt: 1000,
  artifactId: 'source-a',
};
const messages = { complete: 'Preview ready for review.', error: 'Preview failed; the imported model remains saved.' };

describe('Asset model import preview status', () => {
  it('routes recovered status to the geometry, shared or texturing block that owns the import', () => {
    const items = [{ id: 'individual-a', data: { route: 'module' } }, { id: 'shared-a', data: { route: 'shared-prop' } }];
    expect(assetModelImportProgressStep({ itemId: 'individual-a', phase: 'geometry' }, items)).toBe('individual');
    expect(assetModelImportProgressStep({ itemId: 'shared-a', phase: 'geometry' }, items)).toBe('shared-geometry');
    expect(assetModelImportProgressStep({ itemId: 'shared:sheet-a', phase: 'shared-geometry' }, items)).toBe('shared-geometry');
    expect(assetModelImportProgressStep({ itemId: 'shared-a', phase: 'material' }, items)).toBe('shared-textures');
    expect(assetModelImportProgressStep({ itemId: 'individual-a', phase: 'material' }, items)).toBe('shared-textures');
  });
  it('keeps the import active while the matching viewer is still loading', () => {
    expect(settleAssetModelImportPreview(previewing, { artifactId: 'preview-a', sourceArtifactId: 'source-a', state: 'loading' }, messages)).toEqual(previewing);
  });

  it('does not accept a stale or unrelated viewer completion', () => {
    expect(settleAssetModelImportPreview(previewing, { artifactId: 'preview-old', sourceArtifactId: 'old-source', state: 'ready' }, messages)).toBe(previewing);
    expect(settleAssetModelImportPreview(previewing, { artifactId: 'preview-old', sourceArtifactId: 'source-a', ownerId: 'job-a', itemId: 'item-a', phase: 'geometry', operationId: 'older-operation', state: 'ready' }, messages)).toBe(previewing);
    expect(settleAssetModelImportPreview(previewing, { artifactId: 'preview-a', sourceArtifactId: 'source-a', ownerId: 'job-a', itemId: 'other-item', phase: 'geometry', operationId: 'operation-a', state: 'ready' }, messages)).toBe(previewing);
  });

  it('completes only after the expected artifact has rendered, and keeps failed previews distinct', () => {
    const identity = { ownerId: 'job-a', itemId: 'item-a', phase: 'geometry' as const, operationId: 'operation-a' };
    expect(settleAssetModelImportPreview(previewing, { artifactId: 'preview-a', sourceArtifactId: 'source-a', ...identity, state: 'ready' }, messages)).toMatchObject({ state: 'complete', artifactId: 'source-a', message: messages.complete });
    expect(settleAssetModelImportPreview(previewing, { artifactId: 'preview-a', sourceArtifactId: 'source-a', ...identity, state: 'error', message: 'parse failed', code: 'GLTF_PARSE' }, messages)).toMatchObject({ state: 'error', artifactId: 'source-a', message: messages.error, detail: 'parse failed', code: 'GLTF_PARSE' });
  });

  it('keeps cancellation pending until file registration settles and ignores stale cancel callbacks', () => {
    const registering = { ...previewing, stage: 'registering' as const, state: 'importing' as const, artifactId: undefined };
    const canceling = requestAssetModelImportCancel(registering, 'operation-a', 'Waiting for registration to finish.');
    expect(canceling).toMatchObject({ state: 'cancelling', message: 'Waiting for registration to finish.' });
    expect(requestAssetModelImportCancel(registering, 'another-operation', 'ignored')).toBe(registering);
    expect(settleAssetModelImportCancel(canceling, 'another-operation', true, { registered: 'registered', stopped: 'stopped' })).toBe(canceling);
    expect(settleAssetModelImportCancel(canceling, 'operation-a', true, { registered: 'registered; not submitted', stopped: 'stopped' })).toMatchObject({ state: 'cancelled', message: 'registered; not submitted' });
  });

  it('restores a durable error and converts interrupted active work into an explicit recoverable error', () => {
    expect(restoreAssetModelImportActivity(JSON.stringify({ ...previewing, state: 'error', code: 'BLENDER_EXIT', detail: 'exit 2' }), 'job-a', 'ru')).toMatchObject({ state: 'error', detail: 'exit 2', resumeStepOnMount: true });
    expect(restoreAssetModelImportActivity(JSON.stringify(previewing), 'job-a', 'ru')).toMatchObject({ state: 'error', code: 'IMPORT_INTERRUPTED', resumeStepOnMount: true, message: expect.stringContaining('Окно обновилось') });
    expect(restoreAssetModelImportActivity(JSON.stringify(previewing), 'job-b', 'en')).toBeNull();
  });
});
