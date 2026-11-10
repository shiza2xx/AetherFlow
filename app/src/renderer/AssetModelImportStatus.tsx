import React, { useEffect, useState } from 'react';
import { AlertCircle, Check, LoaderCircle, X, XCircle } from 'lucide-react';
import type { AssetModelImportActivity } from './asset-model-import-status';
import { assetModelImportStageLabel, assetModelImportStatusDetail, assetModelImportStatusMessage } from './asset-model-import-copy';

export default function AssetModelImportStatus({ activity, locale, onDismiss, onCancel, onRetry }: {
  activity: AssetModelImportActivity;
  locale: 'en' | 'ru';
  onDismiss?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
}) {
  const t = (en: string, ru: string) => locale === 'ru' ? ru : en;
  const [now, setNow] = useState(Date.now());
  const running = activity.state === 'importing' || activity.state === 'cancelling' || activity.state === 'preview';
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, activity.operationId]);
  const elapsed = Math.max(0, Math.floor((now - activity.startedAt) / 1000));
  const showLongRunning = running && elapsed >= 15;
  const message = assetModelImportStatusMessage(activity, locale);
  const detail = assetModelImportStatusDetail(activity, locale);
  const stageLabel = assetModelImportStageLabel(activity, locale);

  return <div className={`asset-model-import-activity is-${activity.state}`} data-testid="asset-model-import-status" data-import-state={activity.state} data-owner-id={activity.ownerId} data-item-id={activity.itemId} data-phase={activity.phase} data-operation-id={activity.operationId} data-operation-stage={activity.stage} role={activity.state === 'error' ? 'alert' : 'status'} aria-live={activity.state === 'error' ? 'assertive' : 'polite'} aria-busy={running}>
    {running ? <LoaderCircle size={17} aria-hidden="true"/> : activity.state === 'complete' ? <Check size={17} aria-hidden="true"/> : activity.state === 'cancelled' ? <XCircle size={17} aria-hidden="true"/> : <AlertCircle size={17} aria-hidden="true"/>}
    <span className="asset-model-import-copy"><strong>{activity.itemName} · {activity.fileName} · {activity.phase === 'geometry' ? t('Geometry', 'Геометрия') : activity.phase === 'material' ? t('Textured return', 'Текстурированная модель') : t('Shared segmentation input', 'Общий сегментированный исходник')}</strong><small>{stageLabel} · {message}</small>
      {showLongRunning && <small className="asset-model-import-long-running">{t(`Still working · ${elapsed}s elapsed`, `Выполняется · прошло ${elapsed} с`)}</small>}
      {activity.state === 'cancelling' && <small>{t('Registration has already started and may finish. The file will not be submitted for review.', 'Регистрация уже началась и может завершиться. Файл не будет отправлен на проверку.')}</small>}
      {detail && <details className="asset-model-import-technical"><summary>{t('Technical details', 'Технические сведения')}</summary><pre>{activity.code ? `${activity.code}: ` : ''}{detail}</pre></details>}
    </span>
    {activity.state === 'importing' && activity.stage === 'registering' && onCancel && <button type="button" className="asset-model-import-cancel" onClick={onCancel}>{t('Cancel', 'Отменить')}</button>}
    {activity.state === 'error' && activity.stage === 'preview' && onRetry && <button type="button" className="asset-model-import-retry" onClick={onRetry}>{t('Retry preview', 'Повторить предпросмотр')}</button>}
    {(activity.state === 'complete' || activity.state === 'error' || activity.state === 'cancelled') && onDismiss && <button type="button" className="asset-model-import-dismiss" aria-label={t('Dismiss import status', 'Скрыть статус импорта')} onClick={onDismiss}><X size={15}/></button>}
  </div>;
}
