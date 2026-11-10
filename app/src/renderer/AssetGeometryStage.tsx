import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FolderOpen, Upload } from 'lucide-react';
import type { Entity } from '../shared/contracts';
import type { AssetPromptSelection } from '../shared/asset-prompt';
import { assetViewsForRoute } from '../shared/asset-production';
import { assetModelImportDiagnostic, assetModelImportError, assetModelImportSource } from './asset-model-import-copy';
import AssetModelImportStatus from './AssetModelImportStatus';
import { call } from './api';
import { Artwork } from './Artwork';
import AssetValidationMessage from './AssetValidationMessage';
import SharedReturnPanel from './SharedReturnPanel';
import ThreeViewer from './ThreeViewer';
import { assetGeometryStages, assetGeometryStep, assetTextureStep, currentAssetPhoto, type AssetGeometryStep } from './asset-geometry-flow';
import { assetGeometryProgressSteps, assetPhotoRoleLabel, assetPhotoWaitingReason, assetStage4ReturnSections, assetTexturingHandoffGroups, assetTexturingHandoffWaitingReason, hasAssetPhotoFiles, shouldShowAssetReturnWorkflow, type AssetGeometryProgressStep } from './asset-stage4-presentation';
import { assetModelImportProgressStep, clearAssetModelImportCancellation, isAssetModelImportCancellationRequested, requestAssetModelImportCancel, requestAssetModelImportCancellation, settleAssetModelImportCancel, settleAssetModelImportPreview, type AssetModelImportActivity, type AssetModelImportRetryRequest, type AssetModelViewerLoadStatus } from './asset-model-import-status';

type Phase = 'geometry' | 'material';
type Props = {
  ctx: any;
  workspace: string;
  workspaceInstanceId: string;
  locale: 'en' | 'ru';
  theme: 'dark' | 'light';
  busy: boolean;
  refresh: () => Promise<unknown>;
  openPrompt: (selection: AssetPromptSelection) => void;
  runCodex: () => void;
  onFocusCandidate: (itemId: string, role: string, candidateId: string) => Promise<void>;
  onSelectReturnItem: (itemId: string, role: 'geometry' | 'material') => Promise<void> | void;
  onContext: (value: any) => void;
  selectedArtifact: string | null;
  preview: Entity | null;
  modelReady: boolean;
  onModelReady: (ready: boolean) => void;
  onReview: (decision: 'accept' | 'reject') => Promise<void>;
  onWorkbench: () => void;
  buildGuidesForAll: () => void;
  focusRequest?: { id: string; target: string } | null;
  onFocusHandled?: () => void;
  selectedCandidate: any;
  selectedRole: string;
  selectedItemId: string;
  importActivity: AssetModelImportActivity | null;
  updateImportActivity: (next: AssetModelImportActivity | null | ((current: AssetModelImportActivity | null) => AssetModelImportActivity | null)) => void;
  dismissImportActivity: () => void;
  onImportFailure: (message: string, detail: string, code?: string) => void;
  sharedPreviewRetryRequest: AssetModelImportRetryRequest | null;
  onRetryImportPreview: (activity: AssetModelImportActivity) => void;
};

async function rpc(value: any) {
  const result = await call(value);
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data;
}

function GeometryProgressSection({ step, label, summary, doneLabel, active, onOpen, children }: { step: AssetGeometryProgressStep; label: string; summary: string; doneLabel: string; active: boolean; onOpen: () => void; children: React.ReactNode }) {
  return <section className={`asset-stage4-step${active ? ' is-active' : ''}${step.done ? ' is-complete' : ''}`} data-testid="asset-stage4-step" data-step-id={step.id} data-step-state={step.done ? 'complete' : 'current'}>
    <button type="button" className="asset-stage4-step-toggle" aria-expanded={active} onClick={onOpen}>
      <span className="asset-stage4-step-marker" aria-hidden="true">{step.done ? <Check size={15}/> : <span/>}</span>
      <span className="asset-stage4-step-title"><strong>{label}</strong><small>{summary}</small></span>
      <span className="asset-stage4-step-state">{step.done ? doneLabel : ''}</span>
    </button>
    {active && <div className="asset-stage4-step-content">{children}</div>}
  </section>;
}

export default function AssetGeometryStage({ ctx, workspace, workspaceInstanceId, locale, theme, busy: parentBusy, refresh, openPrompt, runCodex, onFocusCandidate, onSelectReturnItem, onContext, selectedArtifact, preview, modelReady, onModelReady, onReview, onWorkbench, buildGuidesForAll, focusRequest, onFocusHandled, selectedCandidate, selectedRole, selectedItemId, importActivity, updateImportActivity, dismissImportActivity, onImportFailure, sharedPreviewRetryRequest, onRetryImportPreview }: Props) {
  const t = (en: string, ru: string) => locale === 'ru' ? ru : en;
  const stages = useMemo(() => assetGeometryStages(ctx), [ctx]);
  const [geometryIndex, setGeometryIndex] = useState(0), [textureIndex, setTextureIndex] = useState(0), [foliageIndex, setFoliageIndex] = useState(0), [activeProgressStep, setActiveProgressStep] = useState<string | null>(null);
  const [exported, setExported] = useState<any>(null), [loadingExport, setLoadingExport] = useState(false);
  const [texturingHandoff, setTexturingHandoff] = useState<any>(null), [loadingTexturingHandoff, setLoadingTexturingHandoff] = useState(false);
  const [viewerOwner, setViewerOwner] = useState<'item' | 'shared' | null>(selectedCandidate?.status === 'pending' && ['geometry', 'material'].includes(selectedRole) ? 'item' : null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null), target = useRef<{ itemId: string; phase: Phase } | null>(null), operationLock = useRef(false), cancelledImports = useRef(new Set<string>()), retainedViewerPreview = useRef<Entity | null>(null);
  const viewerLoadStatus = useRef<AssetModelViewerLoadStatus | null>(null);
  const jobId = ctx.job.id, activeGeometry: AssetGeometryStep | undefined = stages.geometry[geometryIndex], activeTexture: AssetGeometryStep | undefined = stages.texturing[textureIndex];
  const viewerInstance = useRef(crypto.randomUUID()), manuallyOpenedStep = useRef(false);
  const resumedImportStep = useRef<string | null>(null), resumedImportScroll = useRef<string | null>(null);
  const syncingReturnSelection = useRef(false);
  const progressSteps = assetGeometryProgressSteps(ctx, exported), initialProgressStep = progressSteps.find(step => !step.done)?.id || null;
  const activeStepId = progressSteps.some(step => step.id === activeProgressStep) ? activeProgressStep : initialProgressStep;
  const stepLabel = (step: AssetGeometryProgressStep) => ({ photos: t('Photo export', 'Экспорт фотографий'), individual: t('Individual models', 'Отдельные модели'), 'shared-geometry': t('Shared partitions', 'Разделённые общие объекты'), 'shared-textures': t('Shared textured returns', 'Текстурированные общие объекты'), foliage: t('Foliage cards', 'Карточки листвы'), 'additional-review': t('Additional reviews', 'Дополнительная проверка') }[step.id]);
  const stepSummary = (step: AssetGeometryProgressStep) => step.done ? t('Completed · reopen to review', 'Завершено · откройте для проверки') : step.id === activeStepId ? t('Current step', 'Текущий шаг') : step.optional ? t('Optional review', 'Необязательная проверка') : t('Waiting for this step', 'Ожидает своего шага');
  const advanceProgress = (stepId: string, nextRows = progressSteps) => {
    if (manuallyOpenedStep.current || activeStepId !== stepId) return;
    if (!nextRows.find(step => step.id === stepId)?.done) return;
    const index = nextRows.findIndex(step => step.id === stepId), next = nextRows.slice(index + 1).find(step => !step.done);
    setActiveProgressStep(next?.id || null);
  };
  useEffect(() => { setActiveProgressStep(progressSteps.find(step => !step.done)?.id || null); setGeometryIndex(0); setTextureIndex(0); setFoliageIndex(0); manuallyOpenedStep.current = false; }, [jobId]);
  useEffect(() => {
    if (!importActivity?.resumeStepOnMount || importActivity.ownerId !== jobId || resumedImportStep.current === importActivity.operationId) return;
    const id = assetModelImportProgressStep(importActivity, ctx.items);
    if (!progressSteps.some(step => step.id === id)) return;
    resumedImportStep.current = importActivity.operationId;
    setActiveProgressStep(id);
    if (importActivity.phase === 'geometry') {
      const index = stages.geometry.findIndex((value: AssetGeometryStep) => value.item.id === importActivity.itemId);
      if (index >= 0) setGeometryIndex(index);
    } else if (importActivity.phase === 'material') {
      const index = stages.texturing.findIndex((value: AssetGeometryStep) => value.item.id === importActivity.itemId);
      if (index >= 0) setTextureIndex(index);
    }
    // Reopen the affected progress block after a refresh; preview remains user-controlled.
  }, [importActivity?.operationId, importActivity?.resumeStepOnMount, importActivity?.phase, importActivity?.itemId, jobId, ctx.items, progressSteps, stages.geometry, stages.texturing]);
  useEffect(() => {
    const activity = importActivity;
    if (!activity?.resumeStepOnMount || activity.ownerId !== jobId || resumedImportScroll.current === activity.operationId) return;
    const id = assetModelImportProgressStep(activity, ctx.items);
    if (activeStepId !== id) return;
    const selector = activity.phase === 'shared-geometry'
      ? '[data-testid="asset-shared-import-area"]'
      : activity.phase === 'material'
        ? `[data-testid="asset-texture-slider"][data-item-id="${activity.itemId}"] .asset-return-action-area`
        : `[data-testid="asset-geometry-slider"][data-item-id="${activity.itemId}"] .asset-return-action-area`;
    const timer = window.setTimeout(() => {
      const active = document.querySelector(`.asset-stage4-step.is-active[data-step-id="${id}"]`);
      const area = active?.querySelector(selector);
      if (!area || activity.operationId !== importActivity?.operationId) return;
      area.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
      resumedImportScroll.current = activity.operationId;
    }, 50);
    return () => window.clearTimeout(timer);
  }, [importActivity?.operationId, importActivity?.resumeStepOnMount, importActivity?.phase, importActivity?.itemId, jobId, ctx.items, activeStepId, geometryIndex, textureIndex]);
  useEffect(() => {
    const selection = activeStepId === 'individual' && activeGeometry
      ? { itemId: activeGeometry.item.id, role: 'geometry' as const }
      : activeStepId === 'shared-textures' && activeTexture
        ? { itemId: activeTexture.item.id, role: 'material' as const }
        : null;
    if (!selection || (selection.itemId === selectedItemId && selection.role === selectedRole) || syncingReturnSelection.current) return;
    syncingReturnSelection.current = true;
    void Promise.resolve(onSelectReturnItem(selection.itemId, selection.role)).finally(() => { syncingReturnSelection.current = false; });
  }, [activeStepId, activeGeometry?.item.id, activeTexture?.item.id, selectedItemId, selectedRole, onSelectReturnItem]);
  const foliagePhotos = ctx.items.filter((item: any) => item.data.route === 'foliage').some((item: any) => assetViewsForRoute(item.data.route, item.data.views, item.data.viewType).some(view => !!currentAssetPhoto(item, ctx.current.find((value: any) => value.itemId === item.id), view, 'color')));
  const foliageItems = ctx.items.filter((item: any) => item.data.route === 'foliage'), activeFoliage = foliageItems[foliageIndex];
  const activeFoliageState = activeFoliage && ctx.current.find((value: any) => value.itemId === activeFoliage.id);
  const activeFoliageViewsReady = !!activeFoliage && ['front', 'back', 'side', 'top'].every(view => !!currentAssetPhoto(activeFoliage, activeFoliageState, view, 'color'));
  const allCurrentPhotos = [...stages.geometry, ...stages.sharedGeometry, ...stages.texturing].some((step: any) => !!step.photo) || stages.sharedSheetReady || foliagePhotos;
  const exportHasFiles = hasAssetPhotoFiles(exported);
  const returnWorkflowVisible = shouldShowAssetReturnWorkflow(exported, ctx.workflow), returnSections = assetStage4ReturnSections(ctx.items, returnWorkflowVisible);
  const handoffGroups = assetTexturingHandoffGroups(texturingHandoff?.receipt?.entries);
  const texturingHandoffHasFiles = handoffGroups.some(group => group.model || group.colorReferences.length > 0);
  const canPrepareTexturingHandoff = stages.texturing.some((step: any) => step.geometryReady && step.photo && (!step.accepted || step.item.data.route === 'shared-prop'));

  const clearItemViewerContext = () => onContext({ workspace, screen: 'Assets', mode: 'production', entrySurface: 'studio', assetJobId: jobId, assetItemId: selectedItemId || null, instanceId: null, stage: 'geometry', role: selectedRole || null, artifactId: selectedArtifact || null, viewerArtifactId: null, viewerInstanceId: null, viewerState: null, viewerStateUpdatedAt: null, characterId: null });
  const requestViewer = (owner: 'item' | 'shared' | null) => {
    if (viewerOwner === 'item' && owner !== 'item') clearItemViewerContext();
    onModelReady(false);
    setViewerOwner(owner);
  };

  useEffect(() => {
    if (selectedCandidate?.status === 'pending' && ['geometry', 'material'].includes(selectedRole)) requestViewer('item');
    else if (viewerOwner === 'item') requestViewer(null);
  }, [selectedCandidate?.id, selectedCandidate?.status, selectedArtifact, selectedRole]);

  useEffect(() => {
    let active = true;
    setExported(null);
    void (async () => {
      const operations = await rpc({ op: 'list', query: { kind: 'operation', limit: 500, offset: 0 } });
      const latest = operations.filter((value: Entity) => value.data.assetJobId === jobId && value.data.status === 'complete' && value.data.parameters?.mode === 'photos-export').sort((a: Entity, b: Entity) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!latest) return;
      const saved = await rpc({ op: 'asset-production:photos-read', workspace, workspaceInstanceId, id: jobId, operationId: latest.id });
      if (active) setExported({ operationId: latest.id, directory: saved.directory, status: saved.status, receipt: { ...saved.receipt, waiting: saved.current ? saved.receipt.waiting : saved.waiting }, current: saved.current, previous: true });
    })().catch(value => active && setError(value instanceof Error ? value.message : String(value)));
    return () => { active = false; };
  }, [jobId, workspace, workspaceInstanceId, ctx.workflow.revision]);

  useEffect(() => {
    let active = true;
    setTexturingHandoff(null);
    void (async () => {
      const operations = await rpc({ op: 'list', query: { kind: 'operation', limit: 500, offset: 0 } });
      const latest = operations.filter((value: Entity) => value.data.assetJobId === jobId && value.data.status === 'complete' && value.data.parameters?.mode === 'handoff' && value.data.parameters?.kind === 'texture' && value.data.parameters?.scope === 'separated-shared-props-v1').sort((a: Entity, b: Entity) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!latest) return;
      const saved = await rpc({ op: 'asset-production:handoff-read', id: jobId, operationId: latest.id });
      if (active) setTexturingHandoff({ operationId: latest.id, directory: saved.directory, receipt: saved.receipt, previous: true });
    })().catch(value => active && setError(value instanceof Error ? value.message : String(value)));
    return () => { active = false; };
  }, [jobId, ctx.workflow.revision]);

  const exportPhotos = async () => {
    if (operationLock.current || busy || parentBusy) return;
    operationLock.current = true; setBusy(true); setLoadingExport(true); setError(''); setNotice('');
    try {
      const latest = await rpc({ op: 'asset-production:get', id: jobId });
      const result = await rpc({ op: 'asset-production:photos-export', workspace, workspaceInstanceId, input: { id: jobId, expectedRevision: latest.workflow.revision } });
      setExported({ ...result, receipt: { entries: result.entries, waiting: result.waiting }, current: true, previous: false });
      if (result.entries.length > 0 && result.operationId) {
        setNotice(result.status === 'ready' ? t('All current photos are ready.', 'Все актуальные фотографии готовы.') : t(`Exported ${new Set(result.entries.map((entry: any) => entry.path)).size} files; ${result.waiting.length} item/view needs attention.`, `Экспортировано файлов: ${new Set(result.entries.map((entry: any) => entry.path)).size}; требуется проверить деталей или ракурсов: ${result.waiting.length}.`));
        await rpc({ op: 'asset-production:photos-open', workspace, workspaceInstanceId, id: jobId, operationId: result.operationId });
      }
      const refreshed: any = await refresh();
      advanceProgress('photos', assetGeometryProgressSteps(refreshed, { ...result, receipt: { entries: result.entries, waiting: result.waiting }, current: true, previous: false }));
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { operationLock.current = false; setBusy(false); setLoadingExport(false); }
  };

  const openFolder = async () => {
    if (!exported?.operationId || !exportHasFiles) return;
    try { await rpc({ op: 'asset-production:photos-open', workspace, workspaceInstanceId, id: jobId, operationId: exported.operationId }); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  };

  const exportTexturingHandoff = async () => {
    if (operationLock.current || busy || parentBusy || loadingTexturingHandoff) return;
    operationLock.current = true; setBusy(true); setLoadingTexturingHandoff(true); setError(''); setNotice('');
    try {
      const latest = await rpc({ op: 'asset-production:get', id: jobId });
      const result = await rpc({ op: 'asset-production:handoff', input: { id: jobId, expectedRevision: latest.workflow.revision, kind: 'texture' } });
      const handoff = { ...result, receipt: { entries: result.entries, waiting: result.waiting }, previous: false };
      setTexturingHandoff(handoff);
      const modelCount = result.entries.filter((entry: any) => entry.role === 'geometry').length;
      const colorCount = result.entries.filter((entry: any) => entry.role.startsWith('image:')).length;
      setNotice(t(`Prepared ${modelCount} separated shared props with ${colorCount} matching color references.`, `Подготовлено разделённых общих объектов: ${modelCount}; соответствующих цветных референсов: ${colorCount}.`));
      if (result.entries.length > 0 && result.operationId) await rpc({ op: 'asset-production:handoff-open', id: jobId, operationId: result.operationId, mode: 'folder' });
      await refresh();
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { operationLock.current = false; setBusy(false); setLoadingTexturingHandoff(false); }
  };

  const openTexturingHandoff = async () => {
    if (!texturingHandoff?.operationId || !texturingHandoffHasFiles) return;
    try { await rpc({ op: 'asset-production:handoff-open', id: jobId, operationId: texturingHandoff.operationId, mode: 'folder' }); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); }
  };

  const buildFoliageCards = async (item: Entity) => {
    if (operationLock.current || busy || parentBusy) return;
    operationLock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const latest = await rpc({ op: 'asset-production:get', id: jobId }), current = latest.current.find((value: any) => value.itemId === item.id);
      if (!current || !['front', 'back', 'side', 'top'].every(view => !!currentAssetPhoto(item, current, view, 'color'))) throw new Error(t('Accept all four current foliage views first.', 'Сначала примите все четыре актуальных вида листвы.'));
      const result = await rpc({ op: 'asset-production:surface', input: { id: jobId, expectedRevision: latest.workflow.revision, mode: 'foliage', itemId: item.id } });
      const refreshed = await rpc({ op: 'asset-production:get', id: jobId }), slot = refreshed.workflow.data.slots.find((value: any) => value.itemId === item.id && value.role === 'foliage:atlas'), candidate = slot?.candidates.find((value: any) => value.artifactId === result.atlasArtifactId && value.status === 'pending');
      if (!candidate) throw new Error(t('Foliage cards were built, but the review entry is missing. Refresh this job.', 'Карточки листвы созданы, но запись для проверки недоступна. Обновите задание.'));
      await rpc({ op: 'asset-production:update', input: { id: jobId, expectedRevision: refreshed.job.revision, stage: 'geometry', selectedItemId: item.id, selectedInstanceId: null, selectedRole: 'foliage:atlas', selectedCandidateId: candidate.id, selectedCandidateExplicit: true, selectedSceneCandidateId: null } });
      await refresh(); await onFocusCandidate(item.id, 'foliage:atlas', candidate.id);
      setNotice(t('Foliage cards are ready for your review. The atlas and model remain pending until you accept them.', 'Карточки листвы готовы к проверке. Атлас и модель останутся ожидающими, пока вы их не примете.'));
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { operationLock.current = false; setBusy(false); }
  };

  const importPreviewMessages = { complete: t('Preview is ready for your review.', 'Предпросмотр готов к проверке.'), loading: t('Opening the prepared preview for review…', 'Открываем подготовленный предпросмотр для проверки…'), error: t('The model was imported, but its preview could not be opened. The model remains saved for review.', 'Модель импортирована, но не открылась в предпросмотре. Она сохранена для проверки.') };
  const onViewerLoadStatus = (status: AssetModelViewerLoadStatus) => {
    if (!status.operationId || status.operationId !== importActivity?.operationId) return;
    viewerLoadStatus.current = status;
    if (status.state === 'ready') retainedViewerPreview.current = null;
    const matching = ['preview', 'complete'].includes(importActivity?.state || '') && importActivity?.artifactId === (status.sourceArtifactId || status.artifactId) && importActivity?.ownerId === status.ownerId && importActivity?.itemId === status.itemId && importActivity?.phase === status.phase && importActivity?.operationId === status.operationId;
    updateImportActivity(current => settleAssetModelImportPreview(current, status, importPreviewMessages));
    if (status.state === 'error' && matching) onImportFailure(importPreviewMessages.error, status.message || importPreviewMessages.error, status.code || 'MODEL_PREVIEW_FAILED');
  };
  const setImportOutcome = (state: 'complete' | 'error', ownerId: string, itemId: string, phase: Phase, itemName: string, fileName: string, operationId: string, message: string, detail?: string, code?: string) => {
    updateImportActivity(current => current && current.operationId !== operationId && ['importing', 'cancelling', 'preview'].includes(current.state) ? current : ({ ownerId, itemId, phase, itemName, fileName, operationId, stage: state === 'error' ? 'registering' : 'submitting', state, message, startedAt: current?.operationId === operationId ? current.startedAt : Date.now(), ...(detail ? { detail } : {}), ...(code ? { code } : {}) }));
  };
  const cancelImport = (operationId: string) => {
    cancelledImports.current.add(operationId);
    requestAssetModelImportCancellation(operationId);
    updateImportActivity(current => requestAssetModelImportCancel(current, operationId, t('Cancellation requested. Waiting for registration to finish…', 'Запрошена отмена. Ждём завершения регистрации…')));
  };
  useEffect(() => {
    if (importActivity?.state !== 'preview' || !importActivity.artifactId || !preview) return;
    const previewSourceId = String(preview.data.versionOf || preview.data.sourceParentId || preview.data.parentArtifactId || preview.id);
    if (previewSourceId !== importActivity.artifactId) return;
    const observed = viewerLoadStatus.current;
    if (observed) updateImportActivity(current => settleAssetModelImportPreview(current, observed, importPreviewMessages));
  }, [importActivity, preview?.id, locale]);
  const previewSourceId = preview ? String(preview.data.versionOf || preview.data.sourceParentId || preview.data.parentArtifactId || preview.id) : '';
  const viewerImportIdentity = ['preview', 'complete'].includes(importActivity?.state || '') && importActivity?.artifactId && preview && importActivity.ownerId === jobId && importActivity.artifactId === previewSourceId
    ? { ownerId: importActivity.ownerId, itemId: importActivity.itemId, phase: importActivity.phase, operationId: importActivity.operationId }
    : undefined;
  const viewerPreview = importActivity?.state === 'preview' && !preview
    ? retainedViewerPreview.current
    : importActivity?.state === 'error' && importActivity.artifactId && retainedViewerPreview.current
      ? retainedViewerPreview.current
      : preview;
  const itemViewerPreview = viewerOwner === 'item' ? viewerPreview : null;

  const retryPreview = (activity: AssetModelImportActivity) => {
    manuallyOpenedStep.current = true;
    if (activity.phase === 'shared-geometry') { setActiveProgressStep('shared-geometry'); requestViewer('shared'); }
    else {
      const item = ctx.items.find((value: Entity) => value.id === activity.itemId);
      setActiveProgressStep(activity.phase === 'material' ? 'shared-textures' : item?.data.route === 'shared-prop' ? 'shared-geometry' : 'individual');
      requestViewer('item');
    }
    onRetryImportPreview(activity);
  };

  const importModel = async (itemId: string, phase: Phase, files: FileList | File[]) => {
    if (operationLock.current || busy || parentBusy) return;
    const itemName = ctx.items.find((value: Entity) => value.id === itemId)?.name || t('This item', 'Эта деталь');
    const operationId = crypto.randomUUID();
    const file = files.length === 1 ? Array.from(files)[0] : undefined, fileName = file?.name || t('Selected files', 'Выбранные файлы');
    if (!file) { const message = t('Choose or drop exactly one model for this item.', 'Выберите или перетащите ровно одну модель для этой детали.'); setImportOutcome('error', jobId, itemId, phase, itemName, fileName, operationId, message, message, 'MODEL_FILE_COUNT'); onImportFailure(message, message, 'MODEL_FILE_COUNT'); return; }
    operationLock.current = true;
    setBusy(true); setError(''); setNotice('');
    retainedViewerPreview.current = preview;
    viewerLoadStatus.current = null;
    updateImportActivity({ ownerId: jobId, itemId, phase, itemName, fileName, operationId, stage: 'registering', state: 'importing', message: t('Checking and registering the model…', 'Проверяем и регистрируем модель…'), startedAt: Date.now() });
    try {
      const before = await rpc({ op: 'asset-production:get', id: jobId });
      if (cancelledImports.current.has(operationId) || isAssetModelImportCancellationRequested(operationId)) {
        updateImportActivity(current => settleAssetModelImportCancel(current, operationId, false, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') }));
        return;
      }
      const item = before.items.find((value: Entity) => value.id === itemId), state = before.current.find((value: any) => value.itemId === itemId);
      if (!item || item.data.route === 'foliage') throw new Error(t('This item is no longer an active solid model.', 'Эта деталь больше не входит в список активной твёрдой геометрии.'));
      const step = phase === 'geometry' ? assetGeometryStep(item, state, before.workflow) : assetTextureStep(item, state, before.workflow);
      if (!step.canImport) throw new Error(phase === 'geometry' ? t('Resolve the current source and review state before importing this model.', 'Перед импортом проверьте актуальный исходник и статус проверки.') : t('Accept the current partitioned prop and resolve its color review before importing.', 'Примите актуальную разделённую модель объекта и проверьте её цветные референсы перед импортом.'));
      const photo = step.photo;
      const expectedPhoto = photo?.candidate && { artifactId: photo.candidate.artifactId, hash: photo.candidate.hash };
      const referenceRole = phase === 'geometry' ? item.data.depthEnabled ? 'depth:front' : 'image:front' : 'image:front';
      if (!expectedPhoto) throw new Error(t('The current accepted source photo is unavailable. Refresh and review the photo first.', 'Актуальная принятая фотография недоступна. Обновите данные и проверьте изображение.'));
      if (phase === 'geometry' && !state?.geometryInputFingerprint) throw new Error(t('The current geometry source fingerprint is unavailable. Refresh the item before importing a return.', 'Отпечаток актуального источника геометрии недоступен. Обновите деталь перед импортом модели.'));
      if (phase === 'material' && (!state?.sharedPartitionReady || !state?.geometry || state.geometryNeedsReview || !state?.materialInputFingerprint)) throw new Error(t('Accept the current partitioned shared prop before importing its textured return.', 'Примите актуальную разделённую общую модель перед импортом текстурированной версии.'));
      const pinned = phase === 'geometry' ? { referenceRole, photo: expectedPhoto, fingerprint: state.geometryInputFingerprint } : { referenceRole, photo: expectedPhoto, fingerprint: state.materialInputFingerprint, geometryHash: state.geometry.hash };
      if (cancelledImports.current.has(operationId) || isAssetModelImportCancellationRequested(operationId)) {
        updateImportActivity(current => settleAssetModelImportCancel(current, operationId, false, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') }));
        return;
      }
      const sourceInput = await assetModelImportSource(file, window.atelier.pathForFile(file) || '');
      if (cancelledImports.current.has(operationId) || isAssetModelImportCancellationRequested(operationId)) {
        updateImportActivity(current => settleAssetModelImportCancel(current, operationId, false, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') }));
        return;
      }
      const result = await rpc({ op: 'asset-model:import', workspace, workspaceInstanceId, assetJobId: jobId, assetItemId: itemId, ...sourceInput });
      if (result.length !== 1 || result[0].error || !result[0].source?.id) throw new Error(result[0]?.error || t('The model could not be registered for this item.', 'Не удалось зарегистрировать модель для этой детали.'));
      if (cancelledImports.current.has(operationId) || isAssetModelImportCancellationRequested(operationId)) {
        updateImportActivity(current => settleAssetModelImportCancel(current, operationId, true, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') }));
        return;
      }
      updateImportActivity(current => current?.operationId === operationId ? { ...current, stage: 'submitting', message: t('Model registered. Preparing its review entry…', 'Модель зарегистрирована. Готовим её к проверке…') } : current);
      const latest = await rpc({ op: 'asset-production:get', id: jobId }), latestItem = latest.items.find((value: Entity) => value.id === itemId), latestState = latest.current.find((value: any) => value.itemId === itemId);
      if (cancelledImports.current.has(operationId) || isAssetModelImportCancellationRequested(operationId)) {
        updateImportActivity(current => settleAssetModelImportCancel(current, operationId, true, { registered: t('Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') }));
        return;
      }
      const latestPhoto = phase === 'geometry' ? assetGeometryStep(latestItem, latestState, latest.workflow).photo : assetTextureStep(latestItem, latestState, latest.workflow).photo;
      const latestRole = phase === 'geometry' ? latestItem?.data.depthEnabled ? 'depth:front' : 'image:front' : 'image:front';
      const fresh = latest.workflow.revision === before.workflow.revision && latestRole === pinned.referenceRole && latestPhoto?.candidate?.artifactId === pinned.photo.artifactId && latestPhoto?.candidate?.hash === pinned.photo.hash && (phase === 'geometry' ? latestState?.geometryInputFingerprint === pinned.fingerprint : latestState?.sharedPartitionReady === true && latestState?.materialInputFingerprint === pinned.fingerprint && latestState?.geometry?.hash === pinned.geometryHash);
      if (!fresh) throw new Error(t('The item or source changed during import. The file is kept, but was not submitted; refresh before retrying.', 'Деталь или исходник изменились во время импорта. Файл сохранён, но не отправлен; обновите данные перед повтором.'));
      const role = phase === 'geometry' ? 'geometry' : 'material';
      const submitted = await rpc({ op: 'asset-production:return-submit', input: { id: jobId, expectedRevision: latest.workflow.revision, stage: phase, assignments: [{ artifactId: result[0].source.id, itemId }] } });
      const refreshed: any = await refresh();
      if (cancelledImports.current.has(operationId) || isAssetModelImportCancellationRequested(operationId)) {
        updateImportActivity(current => settleAssetModelImportCancel(current, operationId, true, { registered: t('The review request finished while cancellation was requested. Refresh the job to confirm its status.', 'Запрос проверки завершился во время отмены. Обновите задание, чтобы проверить его состояние.'), stopped: t('Cancelled before registration began.', 'Отменено до начала регистрации.') }));
        return;
      }
      const candidate = refreshed.workflow.data.slots.find((slot: any) => slot.itemId === itemId && slot.role === role)?.candidates.find((value: any) => value.artifactId === result[0].source.id) || submitted.workflow?.data?.slots?.find((slot: any) => slot.itemId === itemId && slot.role === role)?.candidates?.find((value: any) => value.artifactId === result[0].source.id);
      if (candidate) {
        updateImportActivity(current => current?.operationId === operationId ? { ...current, ownerId: jobId, itemId, phase, itemName: item.name, fileName, stage: 'preview', state: 'preview', artifactId: result[0].source.id, message: t('The model is saved and submitted. Preparing its preview…', 'Модель сохранена и отправлена на проверку. Подготавливаем предпросмотр…') } : current);
        await onFocusCandidate(itemId, role, candidate.id);
      }
      else {
        const duplicateId = submitted.duplicates?.find((value: any) => value.itemId === itemId)?.candidateId;
        const duplicate = duplicateId && refreshed.workflow.data.slots.find((slot: any) => slot.itemId === itemId && slot.role === role)?.candidates.find((value: any) => value.id === duplicateId);
        if (duplicate?.status === 'pending') { setImportOutcome('complete', jobId, itemId, phase, item.name, fileName, operationId, t('This same model is already waiting for review.', 'Эта модель уже ожидает проверки.')); return; }
        if (duplicate?.status === 'accepted') { setImportOutcome('complete', jobId, itemId, phase, item.name, fileName, operationId, t('This model is already accepted for the current sources.', 'Эта модель уже принята для текущих исходников.')); return; }
        throw new Error(t('The model was not added for review. Refresh the item and try again.', 'Модель не добавлена на проверку. Обновите деталь и повторите попытку.'));
      }
    } catch (value) { const diagnostic = assetModelImportDiagnostic(value), message = assetModelImportError(value, locale); setImportOutcome('error', jobId, itemId, phase, itemName, fileName, operationId, message, diagnostic.detail, diagnostic.code || 'ASSET_MODEL_IMPORT'); onImportFailure(message, diagnostic.detail, diagnostic.code || 'ASSET_MODEL_IMPORT'); }
    finally { cancelledImports.current.delete(operationId); clearAssetModelImportCancellation(operationId); operationLock.current = false; setBusy(false); }
  };

  const chooseFiles = (itemId: string, phase: Phase) => {
    target.current = { itemId, phase };
    input.current?.click();
  };

  const status = (step: any, phase: Phase) => {
    if (step.pending) return t('Awaiting review', 'Ожидает проверки');
    if (step.accepted) return phase === 'geometry' ? t('Geometry accepted', 'Геометрия принята') : t('Textured model accepted', 'Текстурированная модель принята');
    if (phase === 'material' && !step.geometryReady) return t('Accept geometry first', 'Сначала примите геометрию');
    if (!step.photo) return step.item.data.depthEnabled && phase === 'geometry' ? t('Current depth front needed', 'Нужна актуальная карта глубины спереди') : t('Current color front needed', 'Нужен актуальный цветной вид спереди');
    if (phase === 'geometry' && step.state?.geometry) return t('Geometry needs updating', 'Геометрию нужно обновить');
    if (phase === 'material' && step.state?.material) return t('Material needs updating', 'Материал нужно обновить');
    return t('Ready for return', 'Можно импортировать');
  };
  const slider = (phase: Phase, rows: AssetGeometryStep[], selectedIndex: number, setIndex: (value: number) => void, step: AssetGeometryStep | undefined) => {
    if (!step) return <p className="asset-geometry-empty">{t('No items in this step.', 'В этом этапе нет деталей.')}</p>;
    const isGeometry = phase === 'geometry', busyNow = busy || parentBusy, canImport = isGeometry ? step.canImport : step.canImport;
    const selectIndex = (index: number) => {
      if (busyNow || index === selectedIndex) return;
      setIndex(index);
    };
    const statusStep = phase === 'material' ? 'shared-textures' : step.item.data.route === 'shared-prop' ? 'shared-geometry' : 'individual';
    const statusActivity = importActivity && importActivity.ownerId === jobId && importActivity.itemId === step.item.id && importActivity.phase === phase && assetModelImportProgressStep(importActivity, ctx.items) === statusStep ? importActivity : null;
    return <section className="asset-return-slider" data-testid={isGeometry ? 'asset-geometry-slider' : 'asset-texture-slider'} data-item-id={step.item.id} data-status={step.pending ? 'pending' : step.accepted ? 'accepted' : canImport ? 'ready' : 'blocked'}>
      <header className="asset-return-slider-header">
        <div><span className="asset-return-step-count">{selectedIndex + 1} / {rows.length}</span><h3>{step.item.name}</h3><p className="asset-return-status" role="status">{step.accepted && <Check size={14}/>} {status(step, phase)}</p></div>
        <div className="asset-return-slider-nav">
          <button type="button" className="subtle-button" aria-label={t('Previous item', 'Предыдущая деталь')} disabled={busyNow || selectedIndex === 0} onClick={() => selectIndex(Math.max(0, selectedIndex - 1))}><ArrowLeft size={16}/></button>
          <button type="button" className="subtle-button" aria-label={t('Next item', 'Следующая деталь')} disabled={busyNow || selectedIndex >= rows.length - 1} onClick={() => selectIndex(Math.min(rows.length - 1, selectedIndex + 1))}><ArrowRight size={16}/></button>
        </div>
      </header>
      <div className="asset-return-reference">
        <div data-testid="asset-return-display-photo" data-source-role={step.displayPhoto?.role || 'missing'} data-artifact-id={step.displayPhoto?.candidate.artifactId || ''}>
          {step.displayPhoto ? <Artwork id={step.displayPhoto.candidate.artifactId} alt={`${step.item.name} · image:front`} locale={locale} workspace={workspace} lazy={false} full/> : <div className="asset-return-missing">{t('Current color reference is unavailable.', 'Цветной референс недоступен.')}</div>}
        </div>
        <p>{isGeometry ? t('Current color reference', 'Текущий цветной референс') : t('Original color reference', 'Исходный цветной референс')}</p>
      </div>
      <div className="asset-return-action-area">
        {statusActivity && <AssetModelImportStatus activity={statusActivity} locale={locale} onDismiss={dismissImportActivity} onCancel={() => cancelImport(statusActivity.operationId)} onRetry={statusActivity.state === 'error' && statusActivity.stage === 'preview' ? () => retryPreview(statusActivity) : undefined}/>}
        {step.pending ? <div className="asset-return-review-row"><span>{t('Review this item’s model in the preview panel.', 'Проверьте модель детали в окне предпросмотра.')}</span><button type="button" className="subtle-button" disabled={busyNow} onClick={() => void onFocusCandidate(step.item.id, isGeometry ? 'geometry' : 'material', step.pending.id)}>{t('Review model', 'Проверить модель')}</button></div> : <div className={`asset-return-drop ${busyNow || !canImport ? 'is-disabled' : ''}`} data-testid={isGeometry ? 'asset-geometry-drop' : 'asset-texture-drop'} aria-disabled={busyNow || !canImport} onDragOver={event => { if (!busyNow && canImport) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!busyNow && canImport) void importModel(step.item.id, phase, event.dataTransfer.files); }}>
          <Upload size={17}/><div><strong>{isGeometry ? t('Return this item’s model', 'Верните модель этой детали') : t('Return this item’s textured model', 'Верните текстурированную модель этой детали')}</strong><small>{t('Drop one FBX, GLB, OBJ or ZIP here, or choose a file.', 'Перетащите один файл FBX, GLB, OBJ или ZIP сюда либо выберите его.')}</small></div>
          <button type="button" className={isGeometry ? 'primary-button' : 'subtle-button'} data-testid={isGeometry ? 'asset-geometry-import' : 'asset-texture-import'} disabled={busyNow || !canImport} onClick={() => chooseFiles(step.item.id, phase)}>{isGeometry ? t('Choose model', 'Выбрать модель') : t('Choose textured model', 'Выбрать текстурированную модель')}</button>
          {!canImport && !step.pending && <small>{step.item.data.depthEnabled && isGeometry && !step.photo ? t('Accept the matching depth front first.', 'Сначала примите соответствующую глубину спереди.') : !isGeometry && !step.geometryReady ? t('The item needs current accepted geometry.', 'Нужна актуальная принятая геометрия.') : t('Resolve the status above before importing.', 'Перед импортом устраните указанную выше проблему.')}</small>}
        </div>}
      </div>
    </section>;
  };

  const progressSection = (id: string, content: React.ReactNode) => {
    const step = progressSteps.find(value => value.id === id);
    if (!step) return null;
    const active = activeStepId === id;
    return <GeometryProgressSection key={id} step={step} label={stepLabel(step)} summary={stepSummary(step)} doneLabel={t('Done', 'Готово')} active={active} onOpen={() => { if (activeStepId !== id) { manuallyOpenedStep.current = true; requestViewer(null); setActiveProgressStep(id); } }}>{content}</GeometryProgressSection>;
  };
  const selectedItem = ctx.items.find((item: Entity) => item.id === selectedItemId), imageReviewRole = ['material-reference:front', 'guide:front', 'foliage:atlas'].includes(selectedRole);
  const selectedIsShared = selectedItem?.data.route === 'shared-prop';
  const reviewProgressId = selectedRole === 'geometry' ? selectedItem?.data.route === 'foliage' ? 'foliage' : selectedIsShared ? 'shared-geometry' : 'individual' : selectedRole === 'material' && selectedIsShared ? 'shared-textures' : imageReviewRole ? selectedRole === 'foliage:atlas' ? 'foliage' : 'additional-review' : 'additional-review';
  useEffect(() => {
    if (!selectedCandidate || !progressSteps.some(step => step.id === reviewProgressId)) return;
    if (activeStepId && activeStepId !== reviewProgressId) manuallyOpenedStep.current = true;
    setActiveProgressStep(reviewProgressId);
  }, [selectedCandidate?.id, selectedRole, selectedItemId, jobId]);
  useEffect(() => {
    if (!focusRequest) return;
    const target = focusRequest.target, incomplete = ctx.items.find((item: Entity) => {
      const state = ctx.current.find((value: any) => value.itemId === item.id);
      return !state?.geometry || state.geometryNeedsReview;
    });
    const focusStep = target === 'photos' ? 'photos' : target === 'material-import' ? 'shared-textures' : target === 'material-review' || target === 'materials-guide-review' ? 'additional-review' : target === 'geometry-import' ? incomplete?.data.route === 'foliage' ? 'foliage' : incomplete?.data.route === 'shared-prop' ? 'shared-geometry' : 'individual' : null;
    const step = progressSteps.find(value => value.id === focusStep) || progressSteps.find(value => !value.done);
    if (step) {
      setActiveProgressStep(step.id);
      requestAnimationFrame(() => {
        const destination = document.querySelector<HTMLElement>(`[data-asset-focus="${target}"]`);
        if (!destination) return;
        destination.scrollIntoView({ behavior: document.documentElement.dataset.motion === 'reduced' ? 'instant' : 'smooth', block: 'center' });
        (destination.matches('button,input,textarea,summary') ? destination : destination.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary'))?.focus({ preventScroll: true });
      });
    }
    onFocusHandled?.();
  }, [focusRequest?.id, jobId]);
  const reviewCandidate = async (decision: 'accept' | 'reject') => {
    const refreshed: any = await onReview(decision);
    requestViewer(null);
    if (decision !== 'accept' || !refreshed?.current) return;
    const nextSteps = assetGeometryProgressSteps(refreshed, exported);
    if (reviewProgressId === 'individual') {
      const next = assetGeometryStages(refreshed).geometry.findIndex((step: any) => !step.accepted);
      if (next >= 0) setGeometryIndex(next);
    }
    if (reviewProgressId === 'shared-textures') {
      const next = assetGeometryStages(refreshed).texturing.findIndex((step: any) => !step.accepted);
      if (next >= 0) setTextureIndex(next);
    }
    advanceProgress(reviewProgressId, nextSteps);
  };
  const modelReviewPanel = selectedCandidate && selectedArtifact ? <section className="asset-return-model-review" data-testid="asset-return-model-review" data-asset-focus={selectedRole === 'material' ? 'material-review' : imageReviewRole ? selectedRole === 'guide:front' ? 'materials-guide-review' : 'material-review' : 'geometry-import'}>
    <header><div><h2>{t('Model and reference review', 'Проверка модели и референса')}</h2><p>{selectedItem?.name || t('Selected item', 'Выбранная деталь')} · {selectedRole === 'material' ? t('Textured return', 'Текстурированная модель') : selectedRole === 'guide:front' ? t('Projection guide', 'Проекционный референс') : selectedRole === 'material-reference:front' ? t('Material color reference', 'Цветовой референс материала') : selectedRole === 'foliage:atlas' ? t('Foliage atlas', 'Атлас листвы') : t('Geometry return', 'Модель геометрии')}</p></div>
      {!imageReviewRole && <div className="asset-return-model-actions"><button type="button" className="subtle-button" disabled={!selectedArtifact} aria-pressed={viewerOwner === 'item'} onClick={() => viewerOwner === 'item' ? requestViewer(null) : requestViewer('item')}>{viewerOwner === 'item' ? t('Close preview', 'Закрыть просмотр') : t('View model', 'Посмотреть модель')}</button><button type="button" className="subtle-button" disabled={!ctx.current.find((value: any) => value.itemId === selectedItemId)?.geometry} onClick={onWorkbench}>{t('Work on model', 'Работа с моделью')}</button></div>}
    </header>
    {imageReviewRole ? <div className="asset-reference-review-preview"><Artwork id={selectedArtifact} alt={`${selectedItem?.name || ''} · ${selectedRole}`} locale={locale} workspace={workspace} lazy={false} full/></div> : <div className="asset-canvas" data-role={selectedRole || undefined}>{itemViewerPreview ? <ThreeViewer assetOwner={ctx.job} files={[itemViewerPreview]} locale={locale} theme={theme} hideModelPicker modelLoadIdentity={itemViewerPreview.id === preview?.id ? viewerImportIdentity : undefined} onModelReady={state => { if (itemViewerPreview.id === preview?.id) onModelReady(state.ready); }} onModelLoadStatus={onViewerLoadStatus} onAssetViewerState={state => { if (!selectedArtifact || !state.loaded || itemViewerPreview.id !== preview?.id) return; void window.atelier.call({ op: 'ui:publish', context: { workspace, screen: 'Assets', mode: 'production', entrySurface: 'studio', assetJobId: jobId, assetItemId: selectedItemId || null, instanceId: null, stage: 'geometry', role: selectedRole || null, artifactId: selectedArtifact, viewerArtifactId: itemViewerPreview.id, viewerInstanceId: viewerInstance.current, viewerState: state, viewerStateUpdatedAt: Date.now(), characterId: null } }); }}/>:<p>{selectedArtifact ? viewerOwner === 'item' ? t('Preparing checked preview…', 'Подготовка проверенного предпросмотра…') : t('Preview is closed to keep the other model responsive.', 'Просмотр закрыт, чтобы не нагружать второй объект.') : t('Select a returned model to inspect.', 'Выберите возвращённую модель для проверки.')}</p>}</div>}
    {selectedCandidate.status === 'pending' && <div className="asset-return-review-row"><span>{t('This candidate is pending. Your review is required.', 'Кандидат ожидает. Требуется ваша проверка.')}</span><button type="button" className="primary-button" disabled={busy || parentBusy || (!imageReviewRole && !modelReady)} onClick={() => void reviewCandidate('accept')}>{t('Accept candidate', 'Принять кандидат')}</button><button type="button" className="subtle-button" disabled={busy || parentBusy} onClick={() => void reviewCandidate('reject')}>{t('Reject', 'Отклонить')}</button></div>}
    {selectedCandidate.warnings?.map((warning: string) => <AssetValidationMessage key={warning} message={warning} locale={locale} severity="warning"/>)}
  </section> : null;

  return <section className="asset-geometry-workflow" data-testid="asset-geometry-workflow">
    <input ref={input} hidden type="file" accept=".fbx,.glb,.obj,.zip" onChange={event => { const files = event.currentTarget.files ? Array.from(event.currentTarget.files) : []; event.currentTarget.value = ''; const current = target.current; target.current = null; if (files.length && current) void importModel(current.itemId, current.phase, files); }}/>
    {progressSection('photos', <section className="asset-photo-export" data-testid="asset-photo-export">
      <div className="asset-photo-export-heading"><h2>{t('Photo handoff', 'Передача фотографий')}</h2><p>{t('Export current accepted photos for geometry and texturing.', 'Экспортируйте актуальные принятые фотографии для геометрии и текстурирования.')}</p></div>
      <div className="asset-photo-export-actions"><button type="button" className="primary-button" data-testid="asset-export-all-photos" disabled={busy || parentBusy || loadingExport || !ctx.items.length} onClick={() => void exportPhotos()}>{t('Export all photos', 'Экспортировать все фотографии')}</button></div>
      {!allCurrentPhotos && !exported && <small>{t('No current accepted photos yet. Export to see the missing item views.', 'Пока нет актуальных принятых фотографий. Экспорт покажет недостающие ракурсы по деталям.')}</small>}
      {exported && <div className={`asset-photo-export-result ${exported.current ? '' : 'is-outdated'}`} data-testid="asset-photo-export-result" data-export-state={exportHasFiles ? exported.current ? exported.status : 'outdated' : 'empty'} role="status">
        <div><strong>{!exportHasFiles ? exported.current ? t('No photos were exported. Accept the listed views, then try again.', 'Фотографии не экспортированы. Примите указанные ракурсы и повторите экспорт.') : t('No photos were exported. Sources changed; export again to refresh the missing views.', 'Фотографии не экспортированы. Источники изменились; повторите экспорт, чтобы обновить список ракурсов.') : !exported.current ? t('Sources changed since this export', 'После экспорта источники изменились') : exported.status === 'ready' ? t('Photos ready', 'Фотографии готовы') : t('Photos exported · some views need attention', 'Фотографии экспортированы · проверьте недостающие ракурсы')}</strong>
          {exportHasFiles && <details><summary>{t('Export location', 'Папка экспорта')}</summary><code>{exported.directory}</code></details>}
          <small>{exportHasFiles ? `${new Set(exported.receipt?.entries?.map((entry: any) => entry.path) || []).size} ${t('files', 'файлов')}` : t('No export files yet', 'Файлов для экспорта пока нет')} · {exported.receipt?.waiting?.length || 0} {t('waiting', 'требуют внимания')}</small></div>
        {exportHasFiles && exported.operationId && <button type="button" className="subtle-button" onClick={() => void openFolder()}><FolderOpen size={15}/>{t('Open folder', 'Открыть папку')}</button>}
        {exported.receipt?.waiting?.length > 0 && <details open={!exportHasFiles}><summary>{exported.receipt.waiting.length} {t('item views need action','ракурсов требуют внимания')}</summary><ul className="asset-photo-export-waiting-list">{exported.receipt.waiting.map((row: any, index: number) => <li key={`${row.itemId}:${row.role}:${index}`}><span>{row.itemName} · {assetPhotoRoleLabel(row.role, locale)}: {assetPhotoWaitingReason(row.reason, locale)}</span><details className="asset-photo-export-waiting-detail"><summary>{t('Technical detail', 'Технические сведения')}</summary><code>{row.role}: {row.reason}</code></details></li>)}</ul></details>}
      </div>}
    </section>)}
    {progressSection('individual', <>
    {returnSections.individualGeometry ? <section className="asset-geometry-sequence" data-testid="asset-geometry-sequence" data-asset-focus="geometry-import">
      <header><div><h2>{t('Individual geometry', 'Геометрия деталей')}</h2><p>{t('Import and review each solid item.', 'Импортируйте и проверьте каждую отдельную деталь.')}</p></div><span>{stages.geometry.filter((step: any) => step.accepted).length} / {stages.geometry.length}</span></header>
      {slider('geometry', stages.geometry, geometryIndex, setGeometryIndex, activeGeometry)}
    </section> : <p className="asset-geometry-blocker">{t('Export current photos first to open individual model returns.', 'Сначала экспортируйте актуальные фотографии, чтобы открыть возвраты отдельных моделей.')}</p>}
    {!selectedIsShared && !imageReviewRole && selectedRole !== 'foliage:atlas' && modelReviewPanel}
    </>)}
    {progressSection('shared-geometry', <>
    {returnSections.sharedGeometry ? <section className={`asset-shared-sequence ${!stages.individualReady ? 'is-locked' : ''}`} data-testid="asset-shared-sequence" data-ready={stages.individualReady}>
      <header><div><h2>{t('Shared geometry sheet', 'Общий лист геометрии')}</h2><p>{stages.individualReady ? t('After individual models, return one segmented textureless model.', 'После отдельных моделей верните одну сегментированную модель без текстур.') : t('Available after every individual model is accepted.', 'Станет доступно после принятия всех отдельных моделей.')}</p></div><span>{stages.sharedSheetReady ? t('Sheet accepted', 'Лист принят') : t('Sheet needed', 'Нужен лист')}</span></header>
      {stages.individualReady ? <>
        {!stages.sharedSheetReady && <p className="asset-return-missing">{t('Accept the current grouped sheet on Images before sending it to Tripo.', 'Примите актуальный общий лист на этапе «Изображения» перед передачей в Tripo.')}</p>}
        <SharedReturnPanel ctx={ctx} workspace={workspace} workspaceInstanceId={workspaceInstanceId} locale={locale} theme={theme} refresh={refresh} openPrompt={openPrompt} runCodex={runCodex} onContext={onContext} viewerActive={viewerOwner === 'shared'} onViewerRequest={open => requestViewer(open ? 'shared' : null)} importActivity={importActivity} updateImportActivity={updateImportActivity} onImportFailure={onImportFailure} previewRetryRequest={sharedPreviewRetryRequest} onCancelImport={cancelImport} onDismissImportActivity={dismissImportActivity} onRetryImportPreview={retryPreview}/>
        <div className="asset-shared-item-review" aria-label={t('Separated prop models', 'Модели разделённых объектов')}>
          {stages.sharedGeometry.map((step: any) => <div key={step.item.id}><span>{step.item.name}</span><strong>{step.pending ? t('Awaiting review', 'Ожидает проверки') : step.accepted ? t('Accepted', 'Принято') : t('Waiting for Codex assignment', 'Ожидает назначения Codex')}</strong>{step.pending && <button type="button" className="subtle-button" disabled={busy || parentBusy} onClick={() => void onFocusCandidate(step.item.id, 'geometry', step.pending.id)}>{t('Review', 'Проверить')}</button>}</div>)}
        </div>
      </> : <p className="asset-geometry-blocker">{stages.geometry.filter((step: any) => !step.accepted).map((step: any) => step.item.name).join(', ')}</p>}
    </section> : <p className="asset-geometry-blocker">{t('Export current photos to open the shared model return.', 'Экспортируйте актуальные фотографии, чтобы открыть возврат общей модели.')}</p>}
    {selectedIsShared && selectedRole === 'geometry' && modelReviewPanel}
    </>)}
    {progressSection('shared-textures', <>
    {returnWorkflowVisible && returnSections.textureReturns && stages.texturing.length > 0 ? <section className="asset-texture-sequence" data-asset-focus="material-import">
      <header><div><h2>{t('Shared object texturing', 'Текстурирование общих объектов')}</h2><p>{t('Export separated shared props for Tripo using their original color references. Individual modules keep their imported textures.', 'Экспортируйте разделённые общие объекты с исходными цветными референсами. Модули сохраняют уже импортированные текстуры.')}</p></div><span>{stages.texturing.filter((step: any) => step.accepted).length} / {stages.texturing.length} {t('shared props complete', 'объектов готово')}</span></header>
      <section className="asset-texturing-handoff" data-testid="asset-texturing-handoff">
        <div className="asset-texturing-handoff-heading"><h3>{t('Separated shared props and original color references', 'Разделённые общие объекты и исходные цветные референсы')}</h3><p>{t('Export every eligible accepted partitioned prop into its own folder, paired with its current accepted original color views. Return each textured result to that prop’s slider below.', 'Экспортируйте каждый подходящий принятый разделённый объект в отдельную папку вместе с его актуальными принятыми цветовыми видами. Возвращайте результат текстурирования в слайдер этого объекта.')}</p></div>
        <div className="asset-texturing-handoff-actions"><button type="button" className="primary-button" data-testid="asset-export-texturing-handoff" disabled={busy || parentBusy || loadingTexturingHandoff || !canPrepareTexturingHandoff} onClick={() => void exportTexturingHandoff()}><FolderOpen size={15}/>{loadingTexturingHandoff ? t('Preparing export…', 'Готовим экспорт…') : t('Export shared props and references', 'Экспортировать общие объекты и референсы')}</button></div>
        {!canPrepareTexturingHandoff && <small>{t('Accept current partitioned shared props and their original color references first.', 'Сначала примите актуальные разделённые общие объекты и их исходные цветные референсы.')}</small>}
        {texturingHandoff && <div className={`asset-texturing-handoff-result${texturingHandoff.previous ? ' is-previous' : ''}`} data-testid="asset-texturing-handoff-result" data-handoff-state={texturingHandoff.previous ? 'previous' : texturingHandoffHasFiles ? 'ready' : 'empty'} role="status">
          <div><strong>{texturingHandoff.previous ? t('Saved shared-object handoff', 'Сохранена передача общих объектов') : t('Shared-object handoff ready', 'Передача общих объектов готова')}</strong><small>{handoffGroups.length} {t('shared props', 'общих объектов')} · {handoffGroups.filter(group => group.model).length} {t('models', 'моделей')} · {handoffGroups.reduce((count, group) => count + group.colorReferences.length, 0)} {t('color references', 'цветных референсов')} · {texturingHandoff.receipt?.waiting?.length || 0} {t('waiting shared props', 'объектов требуют внимания')}</small></div>
          {texturingHandoffHasFiles && texturingHandoff.operationId && <button type="button" className="subtle-button" onClick={() => void openTexturingHandoff()}><FolderOpen size={15}/>{t('Open folder', 'Открыть папку')}</button>}
          {texturingHandoff.directory && <details><summary>{t('Export location and item mapping', 'Папка экспорта и привязка деталей')}</summary><code>{texturingHandoff.directory}</code><ul className="asset-texturing-handoff-list">{handoffGroups.map(group => <li key={group.itemId}><strong>{group.itemName}</strong><small>{group.model ? `${t('Model', 'Модель')}: ${group.model.path}` : t('Model file missing', 'Файл модели отсутствует')}{group.colorReferences.map(reference => ` · ${assetPhotoRoleLabel(reference.role, locale)}: ${reference.path}`).join('')}</small></li>)}</ul></details>}
          {texturingHandoff.receipt?.waiting?.length > 0 && <details open={!texturingHandoffHasFiles}><summary>{texturingHandoff.receipt.waiting.length} {t('shared props need attention', 'общих объектов требуют проверки')}</summary><ul className="asset-texturing-handoff-list">{texturingHandoff.receipt.waiting.map((row: any) => <li key={row.itemId}><strong>{row.name}</strong><small>{assetTexturingHandoffWaitingReason(row.reason, locale)}</small></li>)}</ul></details>}
        </div>}
      </section>
      {slider('material', stages.texturing, textureIndex, setTextureIndex, activeTexture)}
    </section> : <p className="asset-geometry-blocker">{t('Accept each shared partition before importing its textured return.', 'Примите каждую разделённую модель перед импортом текстурированной версии.')}</p>}
    {selectedIsShared && selectedRole === 'material' && modelReviewPanel}
    </>)}
    {progressSection('foliage', <>
      <section className="asset-foliage-sequence" data-testid="asset-foliage-sequence">
        <header><div><h2>{t('Local foliage cards', 'Локальные карточки листвы')}</h2><p>{t('Build checked cards from the four current accepted color views. Foliage is not sent to Tripo.', 'Создайте проверенные карточки из четырёх актуальных принятых цветных видов. Листва не отправляется в Tripo.')}</p></div><span>{foliageItems.filter((item: Entity) => { const state = ctx.current.find((value: any) => value.itemId === item.id); return !!state?.geometry && !state.geometryNeedsReview; }).length} / {foliageItems.length}</span></header>
        {activeFoliage ? <><div className="asset-foliage-item-nav"><button type="button" className="subtle-button" disabled={foliageIndex === 0} onClick={() => setFoliageIndex(value => Math.max(0, value - 1))}>{t('Previous item', 'Предыдущая деталь')}</button><strong>{activeFoliage.name} · {foliageIndex + 1} / {foliageItems.length}</strong><button type="button" className="subtle-button" disabled={foliageIndex >= foliageItems.length - 1} onClick={() => setFoliageIndex(value => Math.min(foliageItems.length - 1, value + 1))}>{t('Next item', 'Следующая деталь')}</button></div>
          <ul className="asset-foliage-view-status">{(['front', 'back', 'side', 'top'] as const).map(view => <li key={view}><span>{assetPhotoRoleLabel(`foliage:${view}`, locale)}</span><strong>{currentAssetPhoto(activeFoliage, activeFoliageState, view, 'color') ? t('Accepted', 'Принято') : t('Needs review', 'Нужна проверка')}</strong></li>)}</ul>
          <button type="button" className="primary-button" data-testid="asset-build-foliage-cards" disabled={busy || parentBusy || !activeFoliageViewsReady} onClick={() => void buildFoliageCards(activeFoliage)}>{t('Build local foliage cards', 'Создать локальные карточки листвы')}</button>
          {!activeFoliageViewsReady && <small>{t('Accept front, back, side and top color views before building cards.', 'Примите цветные виды спереди, сзади, сбоку и сверху перед созданием карточек.')}</small>}
        </> : <p>{t('No foliage items are in this catalog.', 'В этом каталоге нет деталей листвы.')}</p>}
      </section>
      {selectedItem?.data.route === 'foliage' && modelReviewPanel}
    </>)}
    {progressSection('additional-review', <>
      <section className="asset-additional-review" data-testid="asset-additional-review">
        <h2>{t('Optional references and existing candidates', 'Дополнительные референсы и сохранённые кандидаты')}</h2>
        <p>{t('Use these actions only when a model needs them. Pending material, color-reference and guide candidates stay available here and in the item list.', 'Используйте эти действия только когда они нужны модели. Ожидающие материалы, цветовые референсы и проекционные гайды доступны здесь и в списке деталей.')}</p>
        {modelReviewPanel && (imageReviewRole || selectedRole === 'material' && !selectedIsShared) && modelReviewPanel}
        {!modelReviewPanel && <small>{t('No additional candidates need review.', 'Нет дополнительных кандидатов для проверки.')}</small>}
      </section>
    </>)}
    <details className="asset-stage4-additional-actions" data-testid="asset-stage4-additional-actions">
      <summary>{t('Additional actions · Work on model', 'Дополнительно · Работа с моделью')}</summary>
      <p>{t('Projection guides and material color references are optional. They do not add a production stage.', 'Проекционные гайды и цветовые референсы материалов необязательны и не добавляют этап производства.')}</p>
      <div className="asset-generation-buttons"><button type="button" className="subtle-button" disabled={busy || parentBusy} onClick={buildGuidesForAll}>{t('Build projection guides for current models', 'Создать проекционные гайды для актуальных моделей')}</button>{selectedItem && selectedItem.data.route !== 'foliage' && <button type="button" className="subtle-button" disabled={busy || parentBusy} onClick={() => openPrompt({ stage: 'geometry', intent: 'generate-material-references', itemId: selectedItem.id, role: 'material-reference:front' })}>{t('Prepare material color references', 'Подготовить цветовые референсы материалов')}</button>}{selectedItem && !!ctx.current.find((value: any) => value.itemId === selectedItem.id)?.geometry && <button type="button" className="subtle-button" disabled={busy || parentBusy} onClick={onWorkbench}>{t('Work on selected model', 'Работа с выбранной моделью')}</button>}</div>
    </details>
    {error && <p className="asset-geometry-error" role="alert">{error}</p>}
    {notice && <p className="asset-geometry-notice" role="status">{notice}</p>}
  </section>;
}
