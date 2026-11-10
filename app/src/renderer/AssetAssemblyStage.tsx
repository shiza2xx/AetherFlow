import React from 'react';
import type { Entity } from '../shared/contracts';
import AssetValidationMessage from './AssetValidationMessage';
import AssetAssemblyOperationStatus from './AssetAssemblyOperationStatus';
import type { AssetAssemblyOperation, AssetAssemblyStatuses } from './asset-assembly-status';
import ThreeViewer from './ThreeViewer';

type Filter = 'all' | 'trunk' | 'foliage';
type SceneRow = { candidate: any; current: boolean };
type Props = {
  job: Entity;
  items: Entity[];
  current: any[];
  workflow: any;
  instances: any[];
  sceneCandidates: SceneRow[];
  selectedItemId: string;
  selectedArtifact: string | null;
  selectedInstanceId: string;
  selectedRole: string;
  selectedSceneCandidateId: string;
  preview: Entity | null;
  locale: 'en' | 'ru';
  theme: 'dark' | 'light';
  validation: any;
  validationIsCurrent: boolean;
  pendingSceneCandidate: any;
  modelReady: boolean;
  busy: boolean;
  exported: any;
  exportRecovery: 'checking' | 'ready' | 'stale' | 'missing' | 'error';
  activities: AssetAssemblyStatuses;
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  onModelReady: (ready: boolean) => void;
  onViewerState: (state: any) => void;
  onViewerLoadStatus: (state: any) => void;
  onDismissActivity: (action: AssetAssemblyOperation) => void;
  onRetryPreview: () => void;
  onValidate: () => void;
  onBuildScene: () => void;
  onSelectInstance: (instance: any) => void;
  onSelectAllInstances: () => void;
  onMakeUnique: () => void;
  onSelectScene: (candidate: any) => void;
  onReviewScene: (candidateId: string, decision: 'accept' | 'reject') => void;
  onReviewCatalog: (decision: 'accept' | 'reject') => void;
  onPrepareInstanceRepair: () => void;
  onPrepareAssemblyCorrection: (issue: string) => void;
  onWorkOnModel: () => void;
  onExport: () => void;
  onOpenExport: (mode: 'folder' | 'terminal') => void;
};

const copy = (locale: 'en' | 'ru', english: string, russian: string) => locale === 'ru' ? russian : english;

export function effectiveAssemblyPreviewFilter(filter: Filter, items: Entity[]): Filter {
  return items.some(item => item.data.route === 'foliage') ? filter : 'all';
}

export default function AssetAssemblyStage(props: Props) {
  const {
    job, items, current, workflow, instances, sceneCandidates, selectedItemId, selectedArtifact, selectedInstanceId,
    selectedSceneCandidateId, preview, locale, theme, validation, validationIsCurrent,
    pendingSceneCandidate, modelReady, busy, exported, exportRecovery, filter, onFilterChange, onModelReady, onViewerState,
    activities, onBuildScene, onSelectInstance, onSelectAllInstances, onMakeUnique, onSelectScene,
    onReviewScene, onReviewCatalog, onPrepareInstanceRepair, onPrepareAssemblyCorrection, onWorkOnModel, onExport, onOpenExport, onViewerLoadStatus, onDismissActivity, onRetryPreview, onValidate,
  } = props;
  const [instanceMasterId, setInstanceMasterId] = React.useState('');
  const [correctionIssue, setCorrectionIssue] = React.useState('');
  const [correctionIssueError, setCorrectionIssueError] = React.useState('');
  const correctionFormRef = React.useRef<HTMLFormElement>(null);
  const correctionIssueRef = React.useRef<HTMLTextAreaElement>(null);
  const composite = job.data.mode === 'composite';
  const instanceGroups = items.map(item => ({ item, instances: instances.filter(instance => instance.masterItemId === item.id) })).filter(group => group.instances.length > 0);
  const selectedInstance = instances.find(instance => instance.id === selectedInstanceId) || null;
  const rememberedMasterId = instanceGroups.some(group => group.item.id === instanceMasterId) ? instanceMasterId : instanceGroups[0]?.item.id || '';
  const activeMasterId = selectedInstance?.masterItemId || rememberedMasterId;
  const activeInstanceGroup = instanceGroups.find(group => group.item.id === activeMasterId);
  const activeGroupSelection = activeInstanceGroup?.instances.some(instance => instance.id === selectedInstanceId) ? selectedInstanceId : '';
  const pendingCatalogProposal = composite && job.data.catalogStatus === 'pending' ? workflow?.catalogProposal : null;
  const currentScene = sceneCandidates.find(row => row.candidate.id === selectedSceneCandidateId && row.current)?.candidate || null;
  const validationIssues: string[] = validation?.issues || [];
  const validationWarnings: string[] = validation?.warnings || [];
  const needsPlacementRepair = composite && validationIsCurrent && validationIssues.includes('Composite has no active instances.');
  const confidenceLabel = (confidence?: string) => confidence === 'source-supported'
    ? copy(locale, 'Source-backed', 'Подтверждено исходником')
    : confidence === 'inferred'
      ? copy(locale, 'Inferred', 'Оценочно')
      : confidence === 'uncertain'
        ? copy(locale, 'Uncertain', 'Неопределённо')
        : copy(locale, 'Confidence not recorded', 'Уверенность не указана');
  const placementNote = (instance: any) => `${confidenceLabel(instance.placementConfidence)}${instance.placementEvidence ? ` · ${instance.placementEvidence}` : ''}`;
  const proposalItemName = (itemId: string) => pendingCatalogProposal?.items?.find((item: any) => item.id === itemId)?.name || items.find(item => item.id === itemId)?.name || itemId;
  const vector = (value: number[] | undefined) => Array.isArray(value) ? value.map(entry => Number(entry).toFixed(2)).join(', ') : '—';
  const readyForAssembly = validationIsCurrent && !!validation?.readyForAssembly;
  const readyForExport = validationIsCurrent && !!validation?.readyForExport;
  const validateActivity = activities.validate;
  const visibleValidateActivity = validateActivity && (
    validateActivity.state === 'running' ||
    !validationIsCurrent && (validateActivity.state === 'error' || validateActivity.state === 'cancelled')
  ) ? validateActivity : undefined;
  const buildDisabled = busy || !readyForAssembly || !!pendingSceneCandidate;
  const exportDisabled = busy || !readyForExport;
  const buildDisabledReason = !validationIsCurrent
    ? copy(locale, 'Checking current files and dependencies automatically.', 'Автоматически проверяются актуальные файлы и зависимости.')
    : !readyForAssembly
      ? copy(locale, 'Resolve the file or dependency issues above before building the scene.', 'Устраните замечания по файлам и зависимостям выше перед сборкой сцены.')
      : pendingSceneCandidate
        ? copy(locale, 'Inspect, accept or reject the current scene before building another.', 'Осмотрите текущую сцену и примите или отклоните её перед новой сборкой.')
        : '';
  const exportDisabledReason = !validationIsCurrent
    ? copy(locale, 'Checking current files and dependencies automatically.', 'Автоматически проверяются актуальные файлы и зависимости.')
    : validationIssues.length > 0
      ? copy(locale, 'Resolve the file or dependency issues above before exporting.', 'Устраните замечания по файлам и зависимостям выше перед экспортом.')
      : composite && pendingSceneCandidate
        ? copy(locale, 'Inspect and accept the current scene before exporting.', 'Осмотрите и примите текущую сцену перед экспортом.')
        : composite && !readyForExport
          ? copy(locale, 'Build and accept a current scene before exporting.', 'Соберите и примите актуальную сцену перед экспортом.')
          : '';
  const hasFoliage = items.some(item => item.data.route === 'foliage');
  const previewFilter = effectiveAssemblyPreviewFilter(filter, items);
  const openCorrectionField = () => {
    correctionIssueRef.current?.focus({ preventScroll: true });
    correctionFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const submitCorrection = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!correctionIssue.trim()) {
      setCorrectionIssueError(copy(locale, 'Describe what is wrong with the scene.', 'Опишите, что не так со сценой.'));
      correctionIssueRef.current?.focus();
      return;
    }
    if (correctionIssue.length > 4000) {
      setCorrectionIssueError(copy(locale, 'Keep the scene correction request to 4,000 characters or fewer.', 'Сократите описание исправления сцены до 4 000 символов.'));
      correctionIssueRef.current?.focus();
      return;
    }
    setCorrectionIssueError('');
    onPrepareAssemblyCorrection(correctionIssue);
  };

  return <div className="asset-assembly-workflow" data-testid="asset-assembly-workflow">
    {!composite && <section className="asset-assembly-section asset-assembly-checks" data-testid="asset-assembly-checks" data-asset-focus="assembly" aria-labelledby="asset-assembly-checks-title">
      <header className="asset-assembly-section-heading">
        <span className="asset-assembly-step-number">01</span>
        <div><h2 id="asset-assembly-checks-title">{copy(locale, 'Automatic checks', 'Автоматические проверки')}</h2><p>{composite
          ? copy(locale, 'AetherFlow checks current accepted models, materials, placements and required files when this stage opens and again before every build or export.', 'AetherFlow проверяет актуальные принятые модели, материалы, размещение и обязательные файлы при открытии этапа и перед каждой сборкой или экспортом.')
          : copy(locale, 'No scene is needed for a prop set. AetherFlow checks current accepted models, materials and required files before export; the models stay independent and need no second approval.', 'Набору отдельных объектов общая сцена не нужна. Перед экспортом AetherFlow проверяет актуальные принятые модели, материалы и обязательные файлы; модели останутся отдельными и не требуют повторного принятия.')}</p></div>
      </header>
      <div className="asset-assembly-section-content">
        {visibleValidateActivity && <AssetAssemblyOperationStatus activity={visibleValidateActivity} locale={locale} onDismiss={() => onDismissActivity('validate')} onRetry={onValidate}/>}
        {!validationIsCurrent && <p className="asset-assembly-readiness is-checking" data-testid="asset-assembly-readiness" role="status">{copy(locale, 'Checking the latest accepted files and dependencies…', 'Проверяем актуальные принятые файлы и зависимости…')}</p>}
        {validationIsCurrent && validationIssues.length > 0 && <div className="asset-validation-panel" id="asset-assembly-validation-issues" data-testid="asset-assembly-validation-issues">{validationIssues.map((message: string) => <AssetValidationMessage key={'issue-' + message} message={message} locale={locale} severity="issue"/>)}</div>}
        {validationIsCurrent && validationIssues.length === 0 && <p className="asset-assembly-readiness is-ready" data-testid="asset-assembly-readiness" role="status">{copy(locale, 'Current accepted files and dependencies passed the automatic check. Models will export separately.', 'Актуальные принятые файлы и зависимости прошли автоматическую проверку. Модели будут экспортированы отдельно.')}</p>}
        {validationIsCurrent && validationWarnings.length > 0 && <details className="asset-assembly-validation-notes"><summary>{copy(locale, 'Non-blocking notes', 'Необязательные замечания')} · {validationWarnings.length}</summary><div className="asset-validation-panel">{validationWarnings.map((message: string) => <AssetValidationMessage key={'warning-' + message} message={message} locale={locale} severity="warning"/>)}</div></details>}
        {needsPlacementRepair && <div className="asset-instance-repair" data-testid="asset-instance-repair" data-asset-focus="assembly-instance-repair">
          <div><strong>{copy(locale, 'Placements need repair', 'Нужно восстановить размещения')}</strong><p>{copy(locale, 'Prepare a repair from the original reference and current accepted models. Codex will propose placements for review; accepted models and source files stay intact.', 'Подготовьте размещения по исходнику и актуальным принятым моделям. Codex предложит вариант для проверки; принятые модели и исходные файлы сохранятся.')}</p></div>
          <button type="button" data-testid="asset-prepare-instance-repair" className="primary-button" disabled={busy || !!pendingCatalogProposal} title={pendingCatalogProposal ? copy(locale, 'Review or reject the existing catalog proposal first.', 'Сначала проверьте или отклоните текущее предложение каталога.') : undefined} onClick={onPrepareInstanceRepair}>{copy(locale, 'Prepare placement repair', 'Подготовить исправление размещения')}</button>
        </div>}
        {selectedItemId && <div className="asset-assembly-correction"><span>{copy(locale, 'Need to correct an accepted model?', 'Нужно исправить принятую модель?')}</span><button type="button" className="subtle-button asset-assembly-work-on-model" disabled={!current.find(row => row.itemId === selectedItemId)?.geometry || busy} title={!current.find(row => row.itemId === selectedItemId)?.geometry ? copy(locale, 'Select a part with a current accepted model first.', 'Сначала выберите деталь с актуальной принятой моделью.') : undefined} onClick={onWorkOnModel}>{copy(locale, 'Work on selected part', 'Исправить выбранную деталь')}</button></div>}
      </div>
    </section>}

    {composite && <section className="asset-assembly-section asset-assembly-review" data-testid="asset-assembly-review" aria-labelledby="asset-assembly-review-title">
      <header className="asset-assembly-section-heading">
        <span className="asset-assembly-step-number">01</span>
        <div className="asset-assembly-scene-heading"><h2 id="asset-assembly-review-title">{copy(locale, 'Build and inspect the scene', 'Соберите и осмотрите сцену')}</h2>
          {currentScene && <div className="asset-assembly-scene-toolbar" role="group" aria-label={copy(locale, 'Scene actions', 'Действия со сценой')}>
            <button type="button" data-testid="asset-open-assembly-correction" className="primary-button" disabled={busy} onClick={openCorrectionField}>{copy(locale, 'Correct assembly', 'Исправить сборку')}</button>
            {pendingSceneCandidate && selectedSceneCandidateId === pendingSceneCandidate.id && <button type="button" data-testid="asset-accept-scene" data-candidate-id={pendingSceneCandidate.id} className="subtle-button" disabled={busy || !validationIsCurrent || !modelReady} title={!modelReady ? copy(locale, 'Wait for the scene preview to finish loading before accepting it.', 'Дождитесь загрузки предпросмотра сцены перед её принятием.') : undefined} onClick={() => onReviewScene(pendingSceneCandidate.id, 'accept')}>{copy(locale, 'Accept inspected scene', 'Принять проверенную сцену')}</button>}
            {currentScene.status === 'accepted' && <span className="asset-assembly-scene-accepted" role="status">{copy(locale, 'Scene accepted', 'Сцена принята')}</span>}
          </div>}
        </div>
      </header>

      <div className="asset-assembly-check-summary" data-testid="asset-assembly-check-summary">
        {visibleValidateActivity && <AssetAssemblyOperationStatus activity={visibleValidateActivity} locale={locale} onDismiss={() => onDismissActivity('validate')} onRetry={onValidate}/>}
        {!validationIsCurrent && <p className="asset-assembly-readiness is-checking" data-testid="asset-assembly-readiness" role="status">{copy(locale, 'Checking current files and placements…', 'Проверяем актуальные файлы и размещение…')}</p>}
        {validationIsCurrent && validationIssues.length > 0 && <div className="asset-validation-panel" id="asset-assembly-validation-issues" data-testid="asset-assembly-validation-issues">{validationIssues.map((message: string) => <AssetValidationMessage key={'issue-' + message} message={message} locale={locale} severity="issue"/>)}</div>}
        {validationIsCurrent && validationIssues.length === 0 && <p className="asset-assembly-readiness is-ready" data-testid="asset-assembly-readiness" role="status">{copy(locale, 'Accepted masters, materials and placements are ready for the scene.', 'Принятые детали, материалы и размещение готовы для сборки сцены.')}</p>}
        {validationIsCurrent && validationWarnings.length > 0 && <details className="asset-assembly-validation-notes"><summary>{copy(locale, 'Non-blocking notes', 'Необязательные замечания')} · {validationWarnings.length}</summary><div className="asset-validation-panel">{validationWarnings.map((message: string) => <AssetValidationMessage key={'warning-' + message} message={message} locale={locale} severity="warning"/>)}</div></details>}
        {needsPlacementRepair && <div className="asset-instance-repair" data-testid="asset-instance-repair" data-asset-focus="assembly-instance-repair">
          <div><strong>{copy(locale, 'Placements need repair', 'Нужно восстановить размещения')}</strong><p>{copy(locale, 'Prepare a repair from the original reference and current accepted models. Codex will propose placements for review; accepted models and source files stay intact.', 'Подготовьте размещения по исходнику и актуальным принятым моделям. Codex предложит вариант для проверки; принятые модели и исходные файлы сохранятся.')}</p></div>
          <button type="button" data-testid="asset-prepare-instance-repair" className="primary-button" disabled={busy || !!pendingCatalogProposal} title={pendingCatalogProposal ? copy(locale, 'Review or reject the existing catalog proposal first.', 'Сначала проверьте или отклоните текущее предложение каталога.') : undefined} onClick={onPrepareInstanceRepair}>{copy(locale, 'Prepare placement repair', 'Подготовить исправление размещения')}</button>
        </div>}
      </div>

      {pendingCatalogProposal && <div className="asset-placement-proposal" data-testid="asset-placement-proposal" data-asset-focus="assembly-instances">
        <div><strong>{copy(locale, 'Review proposed placements', 'Проверьте предложенное размещение')}</strong><p>{copy(locale, 'Accepted models and materials stay unchanged. Inspect placement evidence here before accepting; the scene is built afterward.', 'Принятые модели и материалы не меняются. Проверьте обоснования размещения здесь; сцена будет собрана после принятия.')}</p></div>
        <details className="asset-placement-proposal-details"><summary>{copy(locale, 'Inspect placements', 'Просмотреть размещение')} · {(pendingCatalogProposal.instances || []).length}</summary><ol className="asset-placement-proposal-list">{(pendingCatalogProposal.instances || []).map((instance: any) => <li key={instance.id}><strong>{proposalItemName(instance.masterItemId)} · {instance.id.slice(0, 8)}</strong><span>{copy(locale, 'Position', 'Позиция')}: [{vector(instance.transform?.position)}] · {copy(locale, 'Rotation', 'Вращение')}: [{vector(instance.transform?.rotation)}] · {copy(locale, 'Scale', 'Масштаб')}: [{vector(instance.transform?.scale)}]</span><small>{placementNote(instance)}</small></li>)}</ol></details>
        {!pendingCatalogProposal.instances?.length && <p className="asset-assembly-action-reason" role="status">{copy(locale, 'This proposal has no placements; accepting it will leave stage 5 blocked until you prepare a placement repair.', 'В этом предложении нет размещений; после принятия этап 5 останется заблокированным, пока вы не подготовите исправление.')}</p>}
        <div className="asset-placement-proposal-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => onReviewCatalog('accept')}>{pendingCatalogProposal.instances?.length ? copy(locale, 'Accept catalog and placements', 'Принять состав и размещения') : copy(locale, 'Accept catalog (placements still needed)', 'Принять состав (размещения ещё нужны)')}</button><button type="button" className="subtle-button" disabled={busy} onClick={() => onReviewCatalog('reject')}>{copy(locale, 'Reject proposal', 'Отклонить предложение')}</button></div>
      </div>}
      {!pendingSceneCandidate && <div className="asset-assembly-primary-action">
        <button type="button" data-asset-focus="assembly-build" className="primary-button" onClick={onBuildScene} disabled={buildDisabled} title={buildDisabledReason || undefined}>{validation?.scene && !validation?.sceneStale ? copy(locale, 'Build another scene', 'Собрать ещё одну сцену') : copy(locale, 'Build scene from current placements', 'Собрать сцену по текущему размещению')}</button>
        {buildDisabledReason && <p className="asset-assembly-action-reason" role="status">{buildDisabledReason}</p>}
        {validationIsCurrent && validation?.sceneStale && <p className="asset-assembly-action-reason" role="status">{copy(locale, 'The accepted scene is out of date. Build and inspect a new scene before export.', 'Принятая сцена устарела. Соберите и проверьте новую сцену перед экспортом.')}</p>}
      </div>}
      {pendingSceneCandidate && <p className="asset-assembly-pending-build-note" role="status">{copy(locale, 'Review or correct this scene before building another.', 'Проверьте или исправьте эту сцену перед новой сборкой.')}</p>}
      <AssetAssemblyOperationStatus activity={activities.assemble} locale={locale} onDismiss={() => onDismissActivity('assemble')}/>
      <AssetAssemblyOperationStatus activity={activities.preview} locale={locale} onDismiss={() => onDismissActivity('preview')} onRetry={onRetryPreview}/>
      <div className="asset-canvas" data-testid="asset-assembly-preview" data-scene-candidate-id={currentScene?.id || undefined}>{preview ? <ThreeViewer assetOwner={job} assetFilter={currentScene ? { mode: previewFilter, instanceId: selectedInstanceId || undefined, foliageItemIds: items.filter(item => item.data.route === 'foliage').map(item => item.id) } : undefined} files={[preview]} locale={locale} theme={theme} hideModelPicker onAssetViewerState={onViewerState} onModelReady={state => onModelReady(state.ready)} onModelLoadStatus={onViewerLoadStatus}/>:<p>{selectedArtifact ? activities.preview?.state === 'error' ? copy(locale, 'Preview failed. Retry above to try again.', 'Предпросмотр не удался. Повторите попытку выше.') : activities.preview?.state === 'cancelled' ? copy(locale, 'Preview paused after the selection changed.', 'Предпросмотр приостановлен после смены выбора.') : copy(locale, 'Preparing scene preview…', 'Подготовка предпросмотра сцены…') : copy(locale, 'Build a scene to inspect the assembled parts here.', 'Соберите сцену, чтобы осмотреть здесь объединённые детали.')}</p>}</div>

      {composite && <>
        {currentScene && hasFoliage && <div className="asset-assembly-filters" role="group" aria-label={copy(locale, 'Scene preview filter', 'Фильтр просмотра сцены')}><span>{copy(locale, 'View', 'Вид')}</span><div className="segmented">{(['all', 'trunk', 'foliage'] as Filter[]).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => onFilterChange(value)}>{value === 'all' ? copy(locale, 'All', 'Все') : value === 'trunk' ? copy(locale, 'Trunk', 'Ствол') : copy(locale, 'Foliage', 'Листва')}</button>)}</div></div>}
        {currentScene && <form ref={correctionFormRef} className="asset-assembly-correction-form" data-testid="asset-assembly-correction-form" onSubmit={submitCorrection}>
          <label htmlFor="asset-assembly-issue">{copy(locale, 'What should be corrected in this scene?', 'Что нужно исправить в этой сцене?')}<textarea ref={correctionIssueRef} id="asset-assembly-issue" data-testid="asset-assembly-issue" rows={2} maxLength={4000} aria-invalid={correctionIssueError ? true : undefined} aria-describedby="asset-assembly-issue-count asset-assembly-issue-error" value={correctionIssue} onChange={event => { setCorrectionIssue(event.target.value); setCorrectionIssueError(''); }} placeholder={copy(locale, 'Describe a visible placement, alignment, overlap or scale issue.', 'Опишите заметную проблему размещения, выравнивания, пересечения или масштаба.')}/></label>
          <div className="asset-assembly-correction-meta"><span id="asset-assembly-issue-count" className="asset-assembly-issue-count">{copy(locale, 'Up to 4,000 characters', 'До 4 000 символов')} · {correctionIssue.length}/4000</span>{correctionIssueError && <span id="asset-assembly-issue-error" className="asset-assembly-issue-error" role="alert">{correctionIssueError}</span>}</div>
          <div className="asset-assembly-correction-actions"><p>{copy(locale, 'The request will inspect this whole scene. Accepted models and materials stay as they are; proposed placements and new scenes wait for your review.', 'Запрос проверит всю сцену. Принятые модели и материалы останутся без изменений; размещения и новая сцена будут ждать вашей проверки.')}</p><button type="submit" data-testid="asset-correct-assembly" className="primary-button" disabled={busy || !correctionIssue.trim()}>{copy(locale, 'Prepare correction request', 'Подготовить запрос на исправление')}</button></div>
        </form>}
        <AssetAssemblyOperationStatus activity={activities.review} locale={locale} onDismiss={() => onDismissActivity('review')}/>
        {pendingSceneCandidate && <div data-asset-focus="assembly-scene" className="asset-scene-review" data-testid="asset-assembly-scene-review">
          <div className="asset-scene-review-copy"><strong>{copy(locale, 'Inspect and accept this scene', 'Осмотрите и примите эту сцену')}</strong><small data-testid="asset-selected-scene-version">{copy(locale, 'Selected scene version', 'Выбранная версия сцены')} · {pendingSceneCandidate.id.slice(0, 8)}</small><span>{copy(locale, 'This scene is a new candidate. Individual models remain as previously accepted; only this combined scene needs your decision.', 'Это новый вариант сцены. Отдельные модели остаются принятыми; ваше решение требуется только для общей сцены.')}</span></div>
          {selectedSceneCandidateId !== pendingSceneCandidate.id && <button type="button" className="subtle-button" disabled={busy || !validationIsCurrent || !sceneCandidates.find(row => row.candidate.id === pendingSceneCandidate.id)?.current} onClick={() => onSelectScene(pendingSceneCandidate)}>{copy(locale, 'Inspect scene', 'Осмотреть сцену')}</button>}
          {!modelReady && selectedSceneCandidateId === pendingSceneCandidate.id && <small role="status">{copy(locale, 'Wait for the scene preview to finish loading before accepting it.', 'Дождитесь загрузки сцены перед её принятием.')}</small>}
          <button type="button" data-testid="asset-reject-scene" data-candidate-id={pendingSceneCandidate.id} className="subtle-button" disabled={busy} onClick={() => onReviewScene(pendingSceneCandidate.id, 'reject')}>{copy(locale, 'Reject scene', 'Отклонить сцену')}</button>
        </div>}
        <details className="asset-assembly-advanced">
          <summary>{copy(locale, 'Advanced scene controls', 'Дополнительные настройки сцены')}</summary>
          <div className="asset-assembly-controls">
            <div className="asset-instance-controls" data-asset-focus="assembly-instances" role="group" aria-label={copy(locale, 'Scene instances', 'Экземпляры сцены')}>
              <div className="asset-instance-selectors" data-testid="asset-instance-selectors">
                <label>{copy(locale, 'Part group', 'Группа деталей')}<select data-testid="asset-instance-master-select" value={activeMasterId} disabled={busy || !instanceGroups.length} onChange={event => { const nextGroup = instanceGroups.find(group => group.item.id === event.target.value); setInstanceMasterId(event.target.value); if (nextGroup?.instances[0]) onSelectInstance(nextGroup.instances[0]); }}>
                  {instanceGroups.map(group => <option key={group.item.id} value={group.item.id}>{group.item.name} · {group.instances.length}</option>)}
                </select></label>
                <label>{copy(locale, 'Instance', 'Экземпляр')}<select data-testid="asset-instance-select" value={activeGroupSelection} disabled={busy || !activeInstanceGroup} onChange={event => { const nextInstance = activeInstanceGroup?.instances.find(instance => instance.id === event.target.value); if (nextInstance) onSelectInstance(nextInstance); }}>
                  <option value="">{copy(locale, 'Choose an instance', 'Выберите экземпляр')}</option>
                  {activeInstanceGroup?.instances.map((instance, index) => <option key={instance.id} value={instance.id}>{String(index + 1).padStart(2, '0')} · {instance.id.slice(0, 8)}</option>)}
                </select></label>
                <button type="button" className="subtle-button" disabled={busy} onClick={onSelectAllInstances}>{copy(locale, 'Show all instances', 'Показать все экземпляры')}</button>
              </div>
              {selectedInstance && <div className="asset-instance-placement" data-testid="asset-selected-instance"><strong>{items.find(item => item.id === selectedInstance.masterItemId)?.name} · {selectedInstance.id.slice(0, 8)}</strong><small>{placementNote(selectedInstance)}</small><small>{copy(locale, 'Position', 'Позиция')}: [{vector(selectedInstance.transform?.position)}] · {copy(locale, 'Rotation', 'Вращение')}: [{vector(selectedInstance.transform?.rotation)}] · {copy(locale, 'Scale', 'Масштаб')}: [{vector(selectedInstance.transform?.scale)}]</small></div>}
              <button type="button" className="subtle-button" disabled={!selectedInstanceId || busy} onClick={onMakeUnique}>{copy(locale, 'Make instance unique', 'Сделать экземпляр уникальным')}</button>
            </div>
            {sceneCandidates.length > 0 && <details className="asset-assembly-scene-history">
              <summary>{copy(locale, 'Scene history', 'История сцен')} · {sceneCandidates.length}</summary>
              <div className="asset-assembly-scene-list" role="group" aria-label={copy(locale, 'Available scene versions', 'Доступные версии сцены')}>
                {sceneCandidates.map(({ candidate, current: isCurrent }) => <button type="button" key={candidate.id} data-testid="asset-scene-history-candidate" data-candidate-id={candidate.id} disabled={busy || !validationIsCurrent || !isCurrent} aria-pressed={selectedSceneCandidateId === candidate.id} className={'subtle-button ' + (selectedSceneCandidateId === candidate.id ? 'selected' : '')} onClick={() => onSelectScene(candidate)}>{copy(locale, 'Scene', 'Сцена')} · {candidate.status === 'accepted' ? copy(locale, 'Accepted', 'Принята') : copy(locale, 'Awaiting review', 'Ожидает проверки')} · {candidate.id.slice(0, 8)}{!isCurrent ? ' · ' + copy(locale, 'Stale', 'Устарела') : ''}</button>)}
              </div>
            </details>}
          </div>
        </details>
      </>}
    </section>}

    <section className="asset-assembly-section" data-testid="asset-assembly-export" aria-labelledby="asset-assembly-export-title">
      <header className="asset-assembly-section-heading">
        <span className="asset-assembly-step-number">02</span>
        <div><h2 id="asset-assembly-export-title">{copy(locale, 'Export accepted assets', 'Экспорт принятых ассетов')}</h2><p>{composite
          ? copy(locale, 'Exports the accepted scene and the individual accepted models and textures.', 'Экспортирует принятую сцену, а также отдельные принятые модели и текстуры.')
          : copy(locale, 'Exports each accepted model and its textures independently. No combined scene is created.', 'Экспортирует каждую принятую модель и её текстуры отдельно. Общая сцена не создаётся.')}</p></div>
      </header>
      <div className="asset-assembly-export-actions"><button type="button" data-asset-focus="assembly-export" className="primary-button" onClick={onExport} disabled={exportDisabled} title={exportDisabledReason || undefined}>{composite ? copy(locale, 'Export scene + models + textures', 'Экспортировать сцену, модели и текстуры') : copy(locale, 'Export models + textures separately', 'Экспортировать модели и текстуры отдельно')}</button>{exported && <div className="asset-assembly-export-links"><button type="button" className="subtle-button" disabled={busy} onClick={() => onOpenExport('folder')}>{copy(locale, 'Open export', 'Открыть экспорт')}</button><button type="button" className="subtle-button" disabled={busy} onClick={() => onOpenExport('terminal')}>{copy(locale, 'Open CMD', 'Открыть CMD')}</button></div>}</div>
      {exportDisabledReason && <p className="asset-assembly-action-reason" role="status">{exportDisabledReason}</p>}
      {exportRecovery === 'checking' && <p className="asset-export-recovery-status" role="status">{copy(locale, 'Checking the previous export…', 'Проверяем предыдущий экспорт…')}</p>}
      {exportRecovery === 'stale' && <p className="asset-export-recovery-status" role="status">{copy(locale, 'The previous export is out of date or could not be verified. Export again to create a current copy.', 'Предыдущий экспорт устарел или не прошёл проверку. Выполните экспорт ещё раз, чтобы создать актуальную копию.')}</p>}
      {exportRecovery === 'error' && <p className="asset-export-recovery-status" role="status">{copy(locale, 'The previous export could not be checked. Refresh this job or export again.', 'Не удалось проверить предыдущий экспорт. Обновите задание или выполните экспорт ещё раз.')}</p>}
      <AssetAssemblyOperationStatus activity={activities.export} locale={locale} onDismiss={() => onDismissActivity('export')}/>
      <AssetAssemblyOperationStatus activity={activities['open-export']} locale={locale} onDismiss={() => onDismissActivity('open-export')}/>
    </section>
  </div>;
}
