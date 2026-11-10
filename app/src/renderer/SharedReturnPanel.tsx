import React, { useEffect, useRef, useState } from 'react';
import { call } from './api';
import { Artwork } from './Artwork';
import ThreeViewer from './ThreeViewer';
import { Upload } from 'lucide-react';
import type { Entity } from '../shared/contracts';
import type { AssetPromptSelection } from '../shared/asset-prompt';
import { assetModelImportDiagnostic, assetModelImportError, assetModelImportSource } from './asset-model-import-copy';
import AssetModelImportStatus from './AssetModelImportStatus';
import type { AssetModelImportActivity, AssetModelImportRetryRequest, AssetModelViewerLoadStatus } from './asset-model-import-status';
import { clearAssetModelImportCancellation, isAssetModelImportCancellationRequested, settleAssetModelImportCancel, settleAssetModelImportPreview } from './asset-model-import-status';

async function rpc(value: any) {
  const result = await call(value);
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data;
}

export default function SharedReturnPanel({ ctx, workspace, workspaceInstanceId, locale, theme, refresh, openPrompt, runCodex, onContext, viewerActive, onViewerRequest, importActivity, updateImportActivity, onImportFailure, previewRetryRequest, onCancelImport, onDismissImportActivity, onRetryImportPreview }: {
  ctx: any; workspace: string; workspaceInstanceId: string; locale: 'en' | 'ru'; theme: 'dark' | 'light'; refresh: () => Promise<unknown>;
  openPrompt: (selection: AssetPromptSelection) => void; runCodex: () => void; onContext: (value: any) => void;
  viewerActive: boolean; onViewerRequest: (open: boolean) => void;
  importActivity: AssetModelImportActivity | null;
  updateImportActivity: (next: AssetModelImportActivity | null | ((current: AssetModelImportActivity | null) => AssetModelImportActivity | null)) => void;
  onImportFailure: (message: string, detail: string, code?: string) => void;
  previewRetryRequest: AssetModelImportRetryRequest | null;
  onCancelImport: (operationId: string) => void;
  onDismissImportActivity: () => void;
  onRetryImportPreview: (activity: AssetModelImportActivity) => void;
}) {
  const t = (en: string, ru: string) => locale === 'ru' ? ru : en;
  const [sheets, setSheets] = useState<any[]>([]), [sheetId, setSheetId] = useState(''), [sourceId, setSourceId] = useState('');
  const [preview, setPreview] = useState<Entity | null>(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), viewerInstance = useRef(crypto.randomUUID()), operationLock = useRef(false), jobId = ctx.job.id;
  const importActivityRef = useRef(importActivity);
  importActivityRef.current = importActivity;
  const importOperation = useRef<string | null>(null);
  const source = (ctx.workflow.data.sharedSources || []).find((row: any) => row.id === sourceId);
  const selectedSheet = sheets.find((row: any) => row.artifactId === sheetId);
  const statusActivity = importActivity && importActivity.ownerId === jobId && importActivity.phase === 'shared-geometry' && importActivity.itemId === `shared:${sheetId}` ? importActivity : null;

  useEffect(() => {
    let alive = true;
    void rpc({ op: 'asset-production:shared-sheets', id: jobId }).then(rows => {
      if (alive) {
        setSheets(rows);
        setSheetId(previous => rows.some((row: any) => row.artifactId === previous) ? previous : rows.length === 1 ? rows[0].artifactId : '');
      }
    }).catch(e => alive && setError(e.message));
    return () => { alive = false; };
  }, [jobId, ctx.workflow.revision]);

  useEffect(() => {
    const request = previewRetryRequest, current = importActivityRef.current;
    if (!request || current?.operationId !== request.operationId || current.phase !== 'shared-geometry' || !current.artifactId) return;
    const target = (ctx.workflow.data.sharedSources || []).find((row: any) => row.artifactId === current.artifactId);
    if (!target) {
      const message = t('The saved segmented model is missing from this job. Refresh the job before retrying its preview.', 'Сегментированная модель отсутствует в этом задании. Обновите задание перед повтором предпросмотра.'), detail = `Shared source for artifact ${current.artifactId} was not found in the current job.`;
      updateImportActivity(activity => activity?.operationId === request.operationId ? { ...activity, state: 'error', message, detail, code: 'SHARED_SOURCE_MISSING' } : activity);
      onImportFailure(message, detail, 'SHARED_SOURCE_MISSING');
      return;
    }
    setSourceId(target.id);
  }, [previewRetryRequest?.token, importActivity?.operationId]);

  useEffect(() => {
    setPreview(null); setReady(false);
    if (!source) return;
    let alive = true;
    const currentImport = importActivityRef.current;
    const expectedImport = currentImport && currentImport.ownerId === jobId && currentImport.phase === 'shared-geometry' && currentImport.artifactId === source.artifactId ? currentImport : null;
    if (previewRetryRequest?.operationId === expectedImport?.operationId) {
      const retryTarget = (ctx.workflow.data.sharedSources || []).find((row: any) => row.artifactId === expectedImport?.artifactId);
      if (!retryTarget || retryTarget.id !== source.id) return;
    }
    const common = { workspace, workspaceInstanceId, assetJobId: jobId, artifactId: source.artifactId };
    void (async () => {
      let status = await rpc({ op: 'asset-workbench:preview-status', ...common });
      if (!status.previewArtifactId) status = await rpc({ op: 'asset-workbench:preview-retry', ...common, expectedHash: source.hash });
      const result = await rpc({ op: 'get', kind: 'artifact', id: status.previewArtifactId });
      if (alive) setPreview(result);
      else if (expectedImport && importActivityRef.current?.operationId === expectedImport.operationId) updateImportActivity(activity => activity?.operationId === expectedImport.operationId && activity.state === 'preview' ? { ...activity, state: 'complete', message: t('The preview file is ready. Reopen the segmented model to inspect it.', 'Файл предпросмотра готов. Снова откройте сегментированную модель, чтобы проверить её.') } : activity);
    })().catch(e => {
      const current = importActivityRef.current;
      if (expectedImport) {
        if (!current || current.ownerId !== jobId || current.operationId !== expectedImport.operationId || current.phase !== 'shared-geometry' || current.artifactId !== expectedImport.artifactId || !['preview', 'complete'].includes(current.state)) return;
        const diagnostic = assetModelImportDiagnostic(e), message = t('The segmented model is registered, but preview preparation failed. Retry the preview or refresh the job.', 'Сегментированная модель зарегистрирована, но подготовить предпросмотр не удалось. Повторите предпросмотр или обновите задание.');
        updateImportActivity(activity => activity?.operationId === current.operationId && ['preview', 'complete'].includes(activity.state) ? { ...activity, state: 'error', message, detail: diagnostic.detail, code: diagnostic.code || 'MODEL_PREVIEW_FAILED' } : activity);
        onImportFailure(message, diagnostic.detail, diagnostic.code || 'MODEL_PREVIEW_FAILED');
        return;
      }
      if (alive && current && current.ownerId === jobId && current.phase === 'shared-geometry' && current.artifactId === source.artifactId && ['preview', 'complete'].includes(current.state)) return;
      if (alive) setError(assetModelImportError(e, locale));
    });
    return () => { alive = false; };
  }, [source?.id, source?.hash, jobId, workspace, workspaceInstanceId, previewRetryRequest?.token]);

  useEffect(() => {
    if (source?.status === 'pending') onViewerRequest(true);
  }, [source?.id, source?.status]);

  useEffect(() => {
    if (viewerActive || !source) return;
    setReady(false);
    onContext({ screen: 'Assets', mode: 'production', assetJobId: jobId, assetItemId: null, instanceId: null, stage: 'geometry', role: null, artifactId: source.artifactId, viewerArtifactId: null, viewerInstanceId: null, viewerState: null, viewerStateUpdatedAt: null, characterId: null });
  }, [viewerActive, source?.id, source?.artifactId]);

  useEffect(() => {
    const current = importActivity;
    if (viewerActive || !source || !preview || !current || current.ownerId !== jobId || current.phase !== 'shared-geometry' || current.artifactId !== source.artifactId || !['preview', 'complete'].includes(current.state)) return;
    updateImportActivity(activity => activity?.operationId === current.operationId && activity.state === 'preview' ? { ...activity, state: 'complete', message: t('The preview file is ready. Open the viewer to inspect the model.', 'Файл предпросмотра готов. Откройте просмотр, чтобы проверить модель.') } : activity);
  }, [viewerActive, source?.id, source?.artifactId, preview?.id, importActivity?.operationId, importActivity?.state]);

  const run = async (action: () => Promise<void>, importMetadata?: { operationId: string; itemName: string; fileName: string }) => {
    if (operationLock.current || busy) return;
    operationLock.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) {
      const diagnostic = assetModelImportDiagnostic(e), message = assetModelImportError(e, locale);
      if (importMetadata && importActivityRef.current?.operationId === importMetadata.operationId) {
        updateImportActivity(current => current?.operationId === importMetadata.operationId ? { ...current, state: 'error', message, detail: diagnostic.detail, code: diagnostic.code || 'SHARED_MODEL_IMPORT' } : current);
        onImportFailure(message, diagnostic.detail, diagnostic.code || 'SHARED_MODEL_IMPORT');
      } else setError(message);
    }
    finally { if (importMetadata) { clearAssetModelImportCancellation(importMetadata.operationId); if (importOperation.current === importMetadata.operationId) importOperation.current = null; } operationLock.current = false; setBusy(false); }
  };

  const importPreviewMessages = { complete: t('The segmented model preview is ready for review.', 'Предпросмотр сегментированной модели готов к проверке.'), loading: t('Opening the prepared preview for review…', 'Открываем подготовленный предпросмотр для проверки…'), error: t('The model was registered, but its preview could not be opened.', 'Модель зарегистрирована, но открыть её предпросмотр не удалось.') };
  const onViewerLoadStatus = (status: AssetModelViewerLoadStatus) => {
    if (!status.operationId || status.operationId !== importActivity?.operationId) return;
    const current = importActivityRef.current;
    const matching = ['preview', 'complete'].includes(current?.state || '') && current?.artifactId === (status.sourceArtifactId || status.artifactId) && current?.ownerId === status.ownerId && current?.itemId === status.itemId && current?.phase === status.phase && current?.operationId === status.operationId;
    updateImportActivity(current => settleAssetModelImportPreview(current, status, importPreviewMessages));
    if (status.state === 'error' && matching) onImportFailure(importPreviewMessages.error, status.message || importPreviewMessages.error, status.code || 'MODEL_PREVIEW_FAILED');
  };

  const importModel = (files: FileList | null) => {
    const selected = files ? Array.from(files) : [];
    if (!selected.length) return;
    const operationId = crypto.randomUUID(), itemName = t('Shared prop model', 'Общая модель объектов'), fileName = selected.length === 1 ? selected[0].name : t('Selected files', 'Выбранные файлы');
    if (selected.length !== 1) {
      const message = t('Choose or drop exactly one segmented model.', 'Выберите или перетащите ровно одну сегментированную модель.'), detail = `Received ${selected.length} files.`;
      updateImportActivity({ ownerId: jobId, itemId: `shared:${sheetId}`, phase: 'shared-geometry', operationId, stage: 'registering', itemName, fileName, state: 'error', message, startedAt: Date.now(), code: 'MODEL_FILE_COUNT', detail });
      onImportFailure(message, detail, 'MODEL_FILE_COUNT'); return;
    }
    importOperation.current = operationId;
    updateImportActivity({ ownerId: jobId, itemId: `shared:${sheetId}`, phase: 'shared-geometry', operationId, stage: 'registering', itemName, fileName, state: 'importing', message: t('Checking the model package and registering its file…', 'Проверяем пакет модели и регистрируем файл…'), startedAt: Date.now() });
    void run(async () => {
      if (!sheetId) throw Error(t('Choose the accepted sheet first.', 'Сначала выберите принятый лист.'));
      if (isAssetModelImportCancellationRequested(operationId)) { updateImportActivity(current => settleAssetModelImportCancel(current, operationId, false, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') })); return; }
      const sourceInput = await assetModelImportSource(selected[0], window.atelier.pathForFile(selected[0]) || '');
      if (isAssetModelImportCancellationRequested(operationId)) { updateImportActivity(current => settleAssetModelImportCancel(current, operationId, false, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') })); return; }
      const rows: any[] = await rpc({ op: 'asset-model:import', workspace, workspaceInstanceId, assetJobId: jobId, ...sourceInput });
      if (rows.length !== 1 || rows[0].error || !rows[0].source?.id) throw rows[0]?.error ? Object.assign(new Error(String(rows[0].error)), { code: rows[0].code }) : Error(t('The segmented model could not be registered.', 'Не удалось зарегистрировать сегментированную модель.'));
      if (isAssetModelImportCancellationRequested(operationId)) { updateImportActivity(current => settleAssetModelImportCancel(current, operationId, true, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') })); return; }
      updateImportActivity(current => current?.operationId === operationId ? { ...current, stage: 'submitting', message: t('File registered. Checking it against the accepted geometry sheet…', 'Файл зарегистрирован. Сверяем его с принятым листом геометрии…') } : current);
      const current = await rpc({ op: 'asset-production:get', id: jobId });
      if (isAssetModelImportCancellationRequested(operationId)) { updateImportActivity(activity => settleAssetModelImportCancel(activity, operationId, true, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') })); return; }
      const result = await rpc({ op: 'asset-production:shared-submit', input: { id: jobId, expectedRevision: current.workflow.revision, sheetArtifactId: sheetId, artifactId: rows[0].source.id } });
      await refresh(); setSourceId(result.source.id);
      updateImportActivity(activity => activity?.operationId === operationId ? { ...activity, stage: 'preview', state: 'preview', artifactId: result.source.artifactId, itemId: `shared:${sheetId}`, message: t('The segmented model is saved for review. Preparing its preview…', 'Сегментированная модель сохранена для проверки. Готовим предпросмотр…') } : activity);
    }, { operationId, itemName, fileName });
  };

  const review = (decision: 'accept' | 'reject') => void run(async () => {
    const current = await rpc({ op: 'asset-production:get', id: jobId });
    await rpc({ op: 'asset-production:shared-review', input: { id: jobId, expectedRevision: current.workflow.revision, sharedSourceId: source.id, decision } });
    await refresh();
    setReady(false); onViewerRequest(false);
    if (decision === 'reject') setSourceId('');
  });

  if (!ctx.items.some((item: any) => item.data.route === 'shared-prop')) return null;
  const mappedNames = selectedSheet?.members.map((member: any) => {
    const item = ctx.items.find((row: any) => row.id === member.itemId);
    const sourceLabel = member.sourceType === 'depth' ? t('depth', 'глубина') : t('color', 'цвет');
    return `${item?.name || member.itemId} · ${sourceLabel}`;
  }).join(' · ');
  const sharedViewerImportIdentity = importActivity && ['preview', 'complete'].includes(importActivity.state) && importActivity.ownerId === jobId && importActivity.phase === 'shared-geometry' && importActivity.artifactId === source?.artifactId
    ? { ownerId: importActivity.ownerId, itemId: importActivity.itemId, phase: importActivity.phase, operationId: importActivity.operationId }
    : undefined;

  return <section className="asset-shared-return" data-testid="asset-shared-return">
    <h3>{t('Shared prop model', 'Общая модель объектов')}</h3>
    <ol className="asset-shared-steps">
      <li>{t('Use the grouped sheet in Tripo to make one combined, textureless mesh and segment its props.', 'Создайте в Tripo одну общую модель без текстур по общему листу и разделите её на отдельные объекты.')}</li>
      <li>{t('Return that segmented model here. Codex will map components to props for your review.', 'Верните сюда сегментированную модель. Codex сопоставит детали объектам для вашей проверки.')}</li>
    </ol>
    {sheets.length > 1 && <label>{t('Accepted sheet', 'Принятый лист')}<select value={sheetId} disabled={busy} onChange={e => setSheetId(e.target.value)}><option value="">{t('Choose sheet', 'Выберите лист')}</option>{sheets.map(row => <option key={row.artifactId} value={row.artifactId}>{row.members.map((member: any) => ctx.items.find((item: any) => item.id === member.itemId)?.name).join(', ')}</option>)}</select></label>}
    {selectedSheet && <div className="asset-shared-sheet-preview" data-testid="asset-shared-sheet-preview">
      <Artwork id={sheetId} alt={t('Accepted grouped geometry sheet', 'Принятый общий лист геометрии')} locale={locale} lazy={false} full workspace={workspace}/>
      <small>{t('Source per prop:', 'Источник по объектам:')} {mappedNames}</small>
    </div>}
    {!sheets.length && <p>{t('Accept a current grouped sheet on Images first.', 'Сначала примите актуальный общий лист на этапе «Изображения».')}</p>}
    <input hidden ref={input} type="file" accept=".fbx,.glb,.obj,.zip" onChange={e => { importModel(e.currentTarget.files); e.currentTarget.value = ''; }}/>
    <div className="asset-shared-import-area" data-testid="asset-shared-import-area">
      {statusActivity && <AssetModelImportStatus activity={statusActivity} locale={locale} onDismiss={onDismissImportActivity} onCancel={() => onCancelImport(statusActivity.operationId)} onRetry={statusActivity.state === 'error' && statusActivity.stage === 'preview' ? () => onRetryImportPreview(statusActivity) : undefined}/>}
      <div className={`asset-return-drop asset-shared-model-drop${busy ? ' is-disabled' : ''}`} data-testid="asset-shared-model-drop" aria-disabled={busy} onDragOver={event => { if (!busy) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!busy) importModel(event.dataTransfer.files); }}>
        <Upload size={17} aria-hidden="true"/><div><strong>{t('Return the segmented shared model', 'Верните сегментированную общую модель')}</strong><small>{t('Drop one FBX, GLB, OBJ or ZIP here, or choose a file.', 'Перетащите сюда один файл FBX, GLB, OBJ или ZIP либо выберите его.')}</small>{!sheetId && <small>{t('Accept or select the current geometry sheet first.', 'Сначала примите или выберите актуальный лист геометрии.')}</small>}</div>
        <button type="button" disabled={busy || !sheetId} onClick={() => input.current?.click()}>{t('Import segmented model', 'Импортировать сегментированную модель')}</button>
      </div>
    </div>
    {(ctx.workflow.data.sharedSources || []).filter((row: any) => row.status !== 'rejected').map((row: any) => <button key={row.id} disabled={busy} onClick={() => setSourceId(row.id)}>{t('Segmentation input', 'Исходная сегментированная модель')} · {row.status === 'pending' ? t('Awaiting review', 'Ожидает проверки') : t('Accepted', 'Принята')} · {row.id.slice(0, 8)}</button>)}
    {error && <p role="alert">{error}</p>}
    {source && <>
      <button type="button" className="subtle-button" aria-pressed={viewerActive} onClick={() => { setReady(false); onViewerRequest(!viewerActive); }}>{viewerActive ? t('Close segmented model preview', 'Закрыть просмотр сегментированной модели') : t('View segmented model', 'Посмотреть сегментированную модель')}</button>
      {viewerActive ? <div className="asset-canvas">{preview ? <ThreeViewer assetOwner={ctx.job} files={[preview]} locale={locale} theme={theme} hideModelPicker modelLoadIdentity={sharedViewerImportIdentity} onModelLoadStatus={onViewerLoadStatus} onModelReady={state => setReady(state.ready)} onAssetViewerState={state => void window.atelier.call({ op: 'ui:publish', context: { workspace, screen: 'Assets', mode: 'production', entrySurface: 'studio', assetJobId: jobId, assetItemId: null, instanceId: null, stage: 'geometry', role: null, artifactId: source.artifactId, viewerArtifactId: preview.id, viewerInstanceId: viewerInstance.current, viewerState: state, viewerStateUpdatedAt: Date.now(), characterId: null } })}/>:<p>{t('Preparing checked preview…', 'Подготовка проверенного предпросмотра…')}</p>}</div> : <p className="asset-viewer-paused" role="status">{t('Preview is closed. The accepted source stays available to reopen.', 'Просмотр закрыт. Принятый источник можно открыть повторно.')}</p>}
      {source.status === 'pending' && <><button disabled={!ready || busy} onClick={() => review('accept')}>{t('Accept segmentation input', 'Принять сегментированную модель')}</button><button disabled={busy} onClick={() => review('reject')}>{t('Reject input', 'Отклонить модель')}</button></>}
      {source.status === 'accepted' && <>
        <p>{t('Prepare the component inventory and assign one accepted component to each shared prop. Review every resulting model.', 'Подготовьте список компонентов и назначьте каждому общему объекту принятую деталь. Проверьте каждую модель.')}</p>
        <button onClick={() => openPrompt({ stage: 'geometry', sharedSourceId: source.id, sheetArtifactId: source.sheetArtifactId, intent: 'shared-separation' })}>{t('Prepare component mapping', 'Подготовить сопоставление деталей')}</button>
        <button onClick={runCodex}>{t('Open Codex terminal', 'Открыть терминал Codex')}</button>
      </>}
    </>}
  </section>;
}
