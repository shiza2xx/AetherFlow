import React, { useEffect, useState } from 'react';
import { assetAssemblyStatusDetail, assetAssemblyStatusMessage, type AssetAssemblyActivity } from './asset-assembly-status';

type Props = {
  activity?: AssetAssemblyActivity;
  locale: 'en' | 'ru';
  onDismiss?: () => void;
  onRetry?: () => void;
};

const copy = (locale: 'en' | 'ru', english: string, russian: string) => locale === 'ru' ? russian : english;
const elapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

export default function AssetAssemblyOperationStatus({ activity, locale, onDismiss, onRetry }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (activity?.state !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activity?.operationId, activity?.state]);
  if (!activity) return null;

  const duration = elapsed(now - activity.startedAt);
  const longRunning = activity.state === 'running' && now - activity.startedAt >= 15_000;
  const title = activity.state === 'running'
    ? copy(locale, 'In progress', 'Выполняется')
    : activity.state === 'complete'
      ? copy(locale, 'Completed', 'Завершено')
      : activity.state === 'cancelled'
        ? copy(locale, 'Paused', 'Приостановлено')
        : copy(locale, 'Could not finish', 'Не удалось завершить');
  const message = assetAssemblyStatusMessage(activity, locale);
  const detail = assetAssemblyStatusDetail(activity, locale);

  return <section className={`asset-assembly-operation is-${activity.state}`} data-testid={`asset-assembly-status-${activity.action}`} data-operation-id={activity.operationId} role={activity.state === 'running' || activity.state === 'complete' ? 'status' : 'group'} aria-label={title} aria-live={activity.state === 'running' || activity.state === 'complete' ? 'polite' : undefined}>
    <div className="asset-assembly-operation-copy">
      <strong>{title}{activity.state === 'running' ? ` · ${duration}` : ''}</strong>
      <span>{message}</span>
      {longRunning && <small>{copy(locale, 'This step is taking longer than usual. Keep this window open and wait for its result.', 'Этот этап выполняется дольше обычного. Оставьте окно открытым и дождитесь результата.')}</small>}
      {activity.state === 'error' && <>
        {activity.code && <code className="asset-assembly-operation-code">{activity.code}</code>}
        {detail && <details><summary>{copy(locale, 'Technical details', 'Технические сведения')}</summary><pre>{detail}</pre></details>}
      </>}
    </div>
    <div className="asset-assembly-operation-actions">
      {activity.state === 'error' && onRetry && <button type="button" className="subtle-button" onClick={onRetry}>{copy(locale, 'Retry', 'Повторить')}</button>}
      {(activity.state === 'error' || activity.state === 'complete' || activity.state === 'cancelled') && onDismiss && <button type="button" className="icon-button" aria-label={copy(locale, 'Dismiss status', 'Скрыть статус')} onClick={onDismiss}>×</button>}
    </div>
  </section>;
}
