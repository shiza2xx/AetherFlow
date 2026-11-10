import { describe, expect, it } from 'vitest';
import { assetAssemblyDiagnostic, assetAssemblyFailureMessage, assetAssemblyStatusDetail, assetAssemblyStatusMessage, assetAssemblyStatusStorageKey, assetAssemblyStatusesForOwner, isAssetAssemblyFreshnessFailure, restoreAssetAssemblyStatuses, type AssetAssemblyActivity } from './asset-assembly-status';

const activity = (overrides: Partial<AssetAssemblyActivity> = {}): AssetAssemblyActivity => ({
  ownerId: 'job-a', operationId: 'op-a', action: 'assemble', state: 'running', startedAt: 100,
  message: 'Building scene…', ...overrides,
});

describe('asset assembly operation status', () => {
  it('scopes persisted state to workspace and job and marks unknown work as interrupted', () => {
    expect(assetAssemblyStatusStorageKey('D:/workspace', 'job a')).toContain('job%20a');
    const restored = restoreAssetAssemblyStatuses(JSON.stringify({ assemble: activity() }), 'job-a', 'ru');
    expect(restored.assemble).toMatchObject({ state: 'error', code: 'ASSET_OPERATION_INTERRUPTED' });
    expect(restored.assemble?.message).toMatch(/обновлении окна/i);
    expect(restoreAssetAssemblyStatuses(JSON.stringify({ assemble: activity() }), 'job-b', 'en')).toEqual({});
  });

  it('retains completed and failed states while ignoring malformed records', () => {
    const complete = activity({ state: 'complete', message: 'Export ready.' });
    const error = activity({ action: 'export', state: 'error', code: 'QA_EIO', detail: 'Disk write failed.' });
    const restored = restoreAssetAssemblyStatuses(JSON.stringify({ assemble: complete, export: error, preview: { ownerId: 'job-a' } }), 'job-a', 'en');
    expect(restored).toEqual({ assemble: complete, export: error });
  });

  it('exposes only the current owner’s activity while switching asset jobs', () => {
    const previous = activity({ state: 'error', detail: 'Old job failure.' });
    const current = activity({ ownerId: 'job-b', operationId: 'op-b', action: 'preview', artifactId: 'shared-artifact', message: 'Loading current job.' });
    expect(assetAssemblyStatusesForOwner({ assemble: previous, preview: current }, 'job-b')).toEqual({ preview: current });
    expect(assetAssemblyStatusesForOwner({ assemble: previous }, undefined)).toEqual({});
  });

  it('keeps cause details and recognizes stale revision failures for automatic refresh', () => {
    const failure = Object.assign(new Error('Build failed.', { cause: new Error('Workflow changed during assembly.') }), { code: 'REVISION_CONFLICT' });
    expect(assetAssemblyDiagnostic(failure)).toEqual({ code: 'REVISION_CONFLICT', detail: 'Build failed.\nCaused by: Workflow changed during assembly.' });
    expect(isAssetAssemblyFreshnessFailure(failure)).toBe(true);
    expect(isAssetAssemblyFreshnessFailure(new Error('Blender exited unexpectedly.'))).toBe(false);
  });

  it('gives localized next steps for stale inputs, Blender setup and failed files', () => {
    expect(assetAssemblyFailureMessage('Workflow changed; refresh before export.', 'ru')).toContain('Входные данные изменились');
    expect(assetAssemblyFailureMessage('Configure Blender before asset operations.', 'en')).toContain('configured Blender application path');
    expect(assetAssemblyFailureMessage('missing or corrupt dependency textures/base.png', 'ru')).toContain('восстановите или заново зарегистрируйте');
  });

  it('localizes saved and current status copy without rewriting state or raw diagnostics', () => {
    const error = activity({ action: 'export', state: 'error', message: 'The operation did not finish. Review the technical details and fix the reported cause before retrying.', code: 'QA_EXPORT_EIO', detail: 'Synthetic export failure.\nCaused by: controlled missing texture file.' });
    const complete = activity({ action: 'assemble', state: 'complete', message: 'Scene candidate created. Inspect it and make the human review decision below.' });
    const running = activity({ action: 'assemble', state: 'running', message: 'Building a scene and preview from current accepted inputs…' });
    const originalError = JSON.stringify(error);

    expect(assetAssemblyStatusMessage(error, 'ru')).toBe('Операция не завершилась. Проверьте технические сведения и исправьте указанную причину перед повтором.');
    expect(assetAssemblyStatusDetail(error, 'ru')).toBe(error.detail);
    expect(assetAssemblyStatusMessage(complete, 'ru')).toBe('Вариант сцены создан. Осмотрите его и примите решение о проверке ниже.');
    expect(assetAssemblyStatusMessage(running, 'ru')).toBe('Сборка сцены и предпросмотра из актуальных принятых данных…');
    expect(JSON.stringify(error)).toBe(originalError);
    expect(restoreAssetAssemblyStatuses(JSON.stringify({ export: error }), 'job-a', 'ru').export).toEqual(error);
  });

  it('keeps interrupted operations explicitly unknown while displaying the current locale', () => {
    const interrupted = activity({ action: 'assemble', state: 'error', code: 'ASSET_OPERATION_INTERRUPTED', message: 'The window refreshed before this operation was confirmed. Refresh the check and retry the action if it is still available.', detail: 'The assemble step has an unknown outcome. No result was confirmed.' });
    expect(assetAssemblyStatusMessage(interrupted, 'ru')).toMatch(/Ожидание операции прервалось при обновлении окна/);
    expect(assetAssemblyStatusDetail(interrupted, 'ru')).toMatch(/сборки сцены» неизвестен/i);
    expect(interrupted.detail).toBe('The assemble step has an unknown outcome. No result was confirmed.');
  });
});
