export type AssetModelImportPhase = 'geometry' | 'material' | 'shared-geometry';
export type AssetModelImportState = 'importing' | 'cancelling' | 'preview' | 'complete' | 'error' | 'cancelled';
export type AssetModelImportRetryRequest = { operationId: string; token: string };

export type AssetModelImportActivity = {
  ownerId: string;
  itemId: string;
  phase: AssetModelImportPhase;
  operationId: string;
  stage: 'registering' | 'submitting' | 'preview';
  itemName: string;
  fileName: string;
  state: AssetModelImportState;
  message: string;
  startedAt: number;
  /** Ask Stage 4 to reopen this import's progress block once after a UI refresh. */
  resumeStepOnMount?: boolean;
  artifactId?: string;
  code?: string;
  detail?: string;
};

export type AssetModelImportProgressStep = 'individual' | 'shared-geometry' | 'shared-textures';

export function assetModelImportProgressStep(
  activity: Pick<AssetModelImportActivity, 'itemId' | 'phase'>,
  items: Array<{ id: string; data?: { route?: string } }>,
): AssetModelImportProgressStep {
  if (activity.phase === 'shared-geometry') return 'shared-geometry';
  if (activity.phase === 'material') return 'shared-textures';
  const item = items.find(value => value.id === activity.itemId);
  if (item?.data?.route === 'shared-prop') return 'shared-geometry';
  return 'individual';
}

export type AssetModelViewerLoadStatus = {
  artifactId: string;
  sourceArtifactId?: string;
  ownerId?: string;
  itemId?: string;
  phase?: AssetModelImportPhase;
  operationId?: string;
  state: 'loading' | 'ready' | 'error';
  message?: string;
  code?: string;
};

export function settleAssetModelImportPreview(
  activity: AssetModelImportActivity | null,
  viewer: AssetModelViewerLoadStatus,
  messages: { complete: string; error: string; loading?: string },
): AssetModelImportActivity | null {
  if (!activity || !['preview', 'complete'].includes(activity.state)
    || activity.artifactId !== (viewer.sourceArtifactId || viewer.artifactId)
    || activity.ownerId !== viewer.ownerId
    || activity.itemId !== viewer.itemId
    || activity.phase !== viewer.phase
    || activity.operationId !== viewer.operationId) return activity;
  if (viewer.state === 'loading') return activity.state === 'complete'
    ? { ...activity, state: 'preview', message: messages.loading || activity.message }
    : activity;
  if (viewer.state === 'ready') return { ...activity, state: 'complete', message: messages.complete, detail: undefined, code: undefined };
  return { ...activity, state: 'error', message: messages.error, detail: viewer.message || messages.error, code: viewer.code || 'MODEL_PREVIEW_FAILED' };
}

export function requestAssetModelImportCancel(
  activity: AssetModelImportActivity | null,
  operationId: string,
  message: string,
): AssetModelImportActivity | null {
  if (!activity || activity.operationId !== operationId || activity.state !== 'importing' || activity.stage !== 'registering') return activity;
  return { ...activity, state: 'cancelling', message };
}

const requestedImportCancellations = new Set<string>();

export function requestAssetModelImportCancellation(operationId: string): void {
  requestedImportCancellations.add(operationId);
}

export function isAssetModelImportCancellationRequested(operationId: string): boolean {
  return requestedImportCancellations.has(operationId);
}

export function clearAssetModelImportCancellation(operationId: string): void {
  requestedImportCancellations.delete(operationId);
}

export function settleAssetModelImportCancel(
  activity: AssetModelImportActivity | null,
  operationId: string,
  registered: boolean,
  messages: { registered: string; stopped: string },
): AssetModelImportActivity | null {
  if (!activity || activity.operationId !== operationId || activity.state !== 'cancelling') return activity;
  return { ...activity, state: 'cancelled', message: registered ? messages.registered : messages.stopped };
}

export function assetModelImportStorageKey(workspace: string, ownerId: string): string {
  return `atelier.asset-model-import:${encodeURIComponent(workspace)}:${encodeURIComponent(ownerId)}`;
}

export function restoreAssetModelImportActivity(
  value: string | null,
  ownerId: string,
  locale: 'en' | 'ru',
): AssetModelImportActivity | null {
  if (!value) return null;
  try {
    const activity = JSON.parse(value) as AssetModelImportActivity;
    if (!activity || activity.ownerId !== ownerId || typeof activity.operationId !== 'string' || typeof activity.itemId !== 'string') return null;
    if (!['geometry', 'material', 'shared-geometry'].includes(activity.phase) || !['registering', 'submitting', 'preview'].includes(activity.stage) || !['importing', 'cancelling', 'preview', 'complete', 'error', 'cancelled'].includes(activity.state)) return null;
    if (!Number.isFinite(activity.startedAt)) activity.startedAt = Date.now();
    if (activity.state === 'importing' || activity.state === 'cancelling' || activity.state === 'preview') {
      return {
        ...activity,
        resumeStepOnMount: true,
        state: 'error',
        message: locale === 'ru'
          ? 'Окно обновилось до подтверждения результата. Обновите задание и проверьте деталь перед повтором.'
          : 'The window refreshed before this operation was confirmed. Refresh the job and check the item before retrying.',
        code: 'IMPORT_INTERRUPTED',
        detail: locale === 'ru'
          ? 'Ожидание операции остановилось при обновлении интерфейса. Регистрация исходного файла могла завершиться; повторная отправка не выполнялась автоматически.'
          : 'The UI stopped waiting when it refreshed. Source registration may have completed; no automatic resubmission was performed.',
      };
    }
    return { ...activity, resumeStepOnMount: true };
  } catch {
    return null;
  }
}
