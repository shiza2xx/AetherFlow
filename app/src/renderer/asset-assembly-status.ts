export type AssetAssemblyOperation = 'validate' | 'assemble' | 'preview' | 'review' | 'export' | 'open-export';
export type AssetAssemblyActivityState = 'running' | 'complete' | 'error' | 'cancelled';

export type AssetAssemblyActivity = {
  ownerId: string;
  operationId: string;
  action: AssetAssemblyOperation;
  state: AssetAssemblyActivityState;
  startedAt: number;
  message: string;
  subject?: string;
  subjectId?: string;
  artifactId?: string;
  code?: string;
  detail?: string;
};

export type AssetAssemblyStatuses = Partial<Record<AssetAssemblyOperation, AssetAssemblyActivity>>;

export function assetAssemblyStatusStorageKey(workspace: string, ownerId: string): string {
  return `atelier.asset-assembly-status:${encodeURIComponent(workspace)}:${encodeURIComponent(ownerId)}`;
}

export function assetAssemblyStatusesForOwner(statuses: AssetAssemblyStatuses, ownerId: string | undefined): AssetAssemblyStatuses {
  if (!ownerId) return {};
  return Object.fromEntries(Object.entries(statuses).filter(([, activity]) => activity?.ownerId === ownerId)) as AssetAssemblyStatuses;
}

export function restoreAssetAssemblyStatuses(value: string | null, ownerId: string, locale: 'en' | 'ru'): AssetAssemblyStatuses {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as AssetAssemblyStatuses;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const restored: AssetAssemblyStatuses = {};
    for (const action of ['validate', 'assemble', 'preview', 'review', 'export', 'open-export'] as const) {
      const activity = parsed[action];
      if (!activity || activity.ownerId !== ownerId || activity.action !== action
        || typeof activity.operationId !== 'string' || !Number.isFinite(activity.startedAt)
        || !['running', 'complete', 'error', 'cancelled'].includes(activity.state)
        || typeof activity.message !== 'string') continue;
      restored[action] = activity.state === 'running'
        ? {
          ...activity,
          state: 'error',
          message: locale === 'ru'
            ? 'Ожидание операции прервалось при обновлении окна. Обновите проверку и повторите действие, если оно остаётся доступным.'
            : 'The window refreshed before this operation was confirmed. Refresh the check and retry the action if it is still available.',
          code: 'ASSET_OPERATION_INTERRUPTED',
          detail: activity.detail || (locale === 'ru'
            ? `Состояние шага «${action}» неизвестно. Результат не подтверждён.`
            : `The ${action} step has an unknown outcome. No result was confirmed.`),
        }
        : activity;
    }
    return restored;
  } catch {
    return {};
  }
}

export function assetAssemblyDiagnostic(error: unknown): { code: string; detail: string } {
  const read = (value: unknown): string => {
    if (value instanceof Error) return value.message;
    if (value && typeof value === 'object' && 'message' in value) return String((value as { message?: unknown }).message || '');
    return String(value ?? '');
  };
  const seen = new Set<unknown>();
  const details: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null && !seen.has(current); depth += 1) {
    seen.add(current);
    const message = read(current).trim();
    if (message && details[details.length - 1] !== message) details.push(message);
    current = current && typeof current === 'object' && 'cause' in current ? (current as { cause?: unknown }).cause : undefined;
  }
  const suppliedCode = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const code = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(suppliedCode) ? suppliedCode : 'ASSET_STAGE_FAILED';
  return { code, detail: (details.join('\nCaused by: ') || 'No additional diagnostics were returned.').slice(0, 1200) };
}

export function isAssetAssemblyFreshnessFailure(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
  const message = assetAssemblyDiagnostic(error).detail;
  return ['REVISION_CONFLICT', 'STALE_SCENE_CANDIDATE', 'STALE_ASSET_INPUT'].includes(code)
    || /workflow changed|inputs changed|stale|revision conflict/i.test(message);
}

export function assetAssemblyFailureMessage(detail: string, locale: 'en' | 'ru'): string {
  if (/assembly preview|assemble.*preview|preview.*assembly/i.test(detail)) {
    return locale === 'ru'
      ? 'Не удалось проверить предпросмотр текущей сборки. Повторите проверку; если файл повреждён или отсутствует, пересоберите сцену, чтобы создать согласованные файлы сцены и предпросмотра.'
      : 'The current assembly preview could not be verified. Refresh the check; if the file is missing or corrupt, rebuild the scene to create matching scene and preview files.';
  }
  if (/workflow changed|inputs changed|stale|revision conflict/i.test(detail)) {
    return locale === 'ru'
      ? 'Входные данные изменились. Проверка обновлена; проверьте актуальные замечания и повторите действие.'
      : 'The inputs changed. The check was refreshed; review current issues before retrying.';
  }
  if (/configure blender|blender executable|blender.*not found/i.test(detail)) {
    return locale === 'ru'
      ? 'Blender не готов к этой операции. Проверьте путь к установленному приложению Blender в настройках и повторите попытку.'
      : 'Blender is not ready for this operation. Check the configured Blender application path and retry.';
  }
  if (/missing or corrupt|file is missing|dependency is missing/i.test(detail)) {
    return locale === 'ru'
      ? 'Не удалось прочитать один из текущих файлов или его зависимостей. Проверьте детали ошибки, затем восстановите или заново зарегистрируйте этот файл.'
      : 'A current file or one of its dependencies could not be read. Check the error details, then restore or register that file again.';
  }
  if (/webgl|preview|model load|failed to load/i.test(detail)) {
    return locale === 'ru'
      ? 'Предпросмотр не загрузился. Проверьте файл модели и ресурсы Blender, затем повторите предпросмотр.'
      : 'The preview did not load. Check the model file and Blender resources, then retry the preview.';
  }
  return locale === 'ru'
    ? 'Операция не завершилась. Проверьте технические сведения и исправьте указанную причину перед повтором.'
    : 'The operation did not finish. Review the technical details and fix the reported cause before retrying.';
}

const assemblyStatusCopy: ReadonlyArray<readonly [string, string]> = [
  ['Checking the latest accepted models and dependencies…', 'Проверка актуальных принятых моделей и зависимостей…'],
  ['Validation finished. Review the current findings below.', 'Проверка завершена. Ознакомьтесь с текущими замечаниями ниже.'],
  ['Building a scene and preview from current accepted inputs…', 'Сборка сцены и предпросмотра из актуальных принятых данных…'],
  ['Scene candidate created. Inspect it and make the human review decision below.', 'Вариант сцены создан. Осмотрите его и примите решение о проверке ниже.'],
  ['Saving the scene review decision and checking current inputs…', 'Сохранение решения по сцене и проверка актуальных данных…'],
  ['Scene accepted. Validation was refreshed against current inputs.', 'Сцена принята. Проверка обновлена для актуальных данных.'],
  ['Scene rejected. Accepted outputs and previous history were preserved.', 'Сцена отклонена. Принятые результаты и прежняя история сохранены.'],
  ['Preparing the selected model preview…', 'Подготовка предпросмотра выбранной модели…'],
  ['Loading the model into the viewer…', 'Загрузка модели в средство просмотра…'],
  ['Preview loaded. Inspect the selected scene or model.', 'Предпросмотр загружен. Осмотрите выбранную сцену или модель.'],
  ['Preview paused when the selected asset changed. Select it again to continue.', 'Предпросмотр приостановлен после смены выбранного ассета. Выберите его снова, чтобы продолжить.'],
  ['Exporting and verifying current FBX and GLB files…', 'Экспорт и проверка актуальных файлов FBX и GLB…'],
  ['Export completed and the returned manifest was verified against current inputs.', 'Экспорт завершён. Полученный манифест проверен по актуальным данным.'],
  ['Verifying the export receipt before opening it…', 'Проверка квитанции экспорта перед открытием…'],
  ['Export location opened.', 'Папка экспорта открыта.'],
];

function localizedStatusCopy(message: string, locale: 'en' | 'ru'): string | undefined {
  const pair = assemblyStatusCopy.find(([english, russian]) => message === english || message === russian);
  return pair?.[locale === 'ru' ? 1 : 0];
}

const interruptedMessage = (locale: 'en' | 'ru') => locale === 'ru'
  ? 'Ожидание операции прервалось при обновлении окна. Обновите проверку и повторите действие, если оно остаётся доступным.'
  : 'The window refreshed before this operation was confirmed. Refresh the check and retry the action if it is still available.';

export function assetAssemblyStatusMessage(activity: AssetAssemblyActivity, locale: 'en' | 'ru'): string {
  if (activity.state === 'error') {
    if (activity.code === 'ASSET_OPERATION_INTERRUPTED') return interruptedMessage(locale);
    return assetAssemblyFailureMessage(activity.detail || activity.message, locale);
  }
  return localizedStatusCopy(activity.message, locale) || activity.message;
}

export function assetAssemblyStatusDetail(activity: AssetAssemblyActivity, locale: 'en' | 'ru'): string | undefined {
  if (activity.code === 'ASSET_OPERATION_INTERRUPTED') {
    const subject = ({
      validate: locale === 'ru' ? 'проверки' : 'validation',
      assemble: locale === 'ru' ? 'сборки сцены' : 'scene build',
      preview: locale === 'ru' ? 'предпросмотра' : 'preview',
      review: locale === 'ru' ? 'проверки сцены' : 'scene review',
      export: locale === 'ru' ? 'экспорта' : 'export',
      'open-export': locale === 'ru' ? 'открытия экспорта' : 'opening the export',
    })[activity.action];
    return locale === 'ru'
      ? `Результат этапа «${subject}» неизвестен. Операция не подтвердила результат.`
      : `The outcome of ${subject} is unknown. No result was confirmed.`;
  }
  return activity.detail;
}
