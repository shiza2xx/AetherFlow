import type { AssetModelImportActivity } from './asset-model-import-status';

export async function assetModelImportSource(file: File, localPath: string) {
  if (localPath) return { paths: [localPath], files: [] as Array<{name: string; bytes: Uint8Array}> };
  if (/\.zip$/i.test(file.name)) {
    if (file.size > 128 * 1024 * 1024) throw new Error('ZIP files over 128 MB cannot be imported.');
    return { paths: [] as string[], files: [{ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }] };
  }
  throw new Error('The file path is unavailable. Select the model again.');
}

export function assetModelImportError(value: unknown, locale: 'en' | 'ru') {
  const message = value instanceof Error ? value.message : String(value);
  const found = message.match(/ZIP must contain exactly one FBX, GLB or OBJ model; found (\d+)/i);
  if (found) return locale === 'ru'
    ? `В ZIP найдено моделей: ${found[1]}. В архиве должна быть ровно одна модель FBX, GLB или OBJ.`
    : `This ZIP contains ${found[1]} supported models. It must contain exactly one FBX, GLB or OBJ.`;
  if (/unsafe path|duplicate alias|unsafe component/i.test(message)) return locale === 'ru'
    ? 'В ZIP найдены небезопасные или повторяющиеся пути. Пересоберите архив с уникальными относительными путями.'
    : 'The ZIP contains unsafe or duplicate paths. Rebuild it with unique relative paths.';
  if (/links and special file|symlink/i.test(message)) return locale === 'ru'
    ? 'В ZIP есть ссылки или специальные файлы. Упакуйте модель и текстуры как обычные файлы.'
    : 'The ZIP contains links or special files. Repack the model and textures as regular files.';
  if (/expansion limit|over 128 MB|exceeds four levels|entry limit/i.test(message)) return locale === 'ru'
    ? 'Архив ZIP превышает допустимый размер, число файлов или глубину вложенности.'
    : 'The ZIP exceeds the supported size, file-count or nesting limits.';
  if (/central directory|local header|CRC|ZIP64|ZIP directory|ZIP compressed|ZIP output|ZIP file/i.test(message)) return locale === 'ru'
    ? 'Архив ZIP повреждён или имеет неподдерживаемый формат. Создайте архив заново.'
    : 'The ZIP is damaged or uses an unsupported format. Create the archive again.';
  if (/Required sidecar file is missing|External dependency/i.test(message)) return locale === 'ru'
    ? 'В архиве отсутствует текстура или другой файл, на который ссылается модель.'
    : 'The ZIP is missing a texture or another file referenced by the model.';
  if (/File type .* is not supported/i.test(message)) return locale === 'ru'
    ? 'В архиве есть неподдерживаемый тип файла. Оставьте модель FBX, GLB или OBJ и её поддерживаемые текстуры.'
    : 'The ZIP contains an unsupported file type. Keep the FBX, GLB or OBJ model and its supported textures.';
  if (/Convert glTF to GLB/i.test(message)) return locale === 'ru' ? 'Преобразуйте glTF в GLB перед импортом.' : message;
  if (/Choose or drop exactly one model/i.test(message)) return locale === 'ru' ? 'Выберите или перетащите ровно одну модель для этой детали.' : message;
  if (/Choose FBX, GLB, OBJ or ZIP/i.test(message)) return locale === 'ru' ? 'Выберите файл FBX, GLB, OBJ или ZIP.' : message;
  if (/file path is unavailable/i.test(message)) return locale === 'ru' ? 'Не удалось определить путь к файлу. Повторно выберите модель; для ZIP можно также перетащить архив.' : message;
  return locale === 'ru'
    ? 'Не удалось обработать модель. Проверьте файл и его зависимости, затем повторите импорт.'
    : 'The model could not be processed. Check the file and its dependencies, then retry the import.';
}

export function assetModelImportDiagnostic(value: unknown) {
  const candidate = value && typeof value === 'object' ? value as { message?: unknown; code?: unknown } : null;
  const detail = String(candidate?.message ?? value ?? 'Unknown model import failure.');
  const code = candidate?.code == null ? undefined : String(candidate.code);
  return { detail, code };
}

const importStatusCopy: ReadonlyArray<readonly [string, string]> = [
  ['Checking and registering the model…', 'Проверяем и регистрируем модель…'],
  ['Checking the model package and registering its file…', 'Проверяем пакет модели и регистрируем файл…'],
  ['Model registered. Preparing its review entry…', 'Модель зарегистрирована. Готовим её к проверке…'],
  ['File registered. Checking it against the accepted geometry sheet…', 'Файл зарегистрирован. Сверяем его с принятым листом геометрии…'],
  ['The model is saved and submitted. Preparing its preview…', 'Модель сохранена и отправлена на проверку. Подготавливаем предпросмотр…'],
  ['The segmented model is saved for review. Preparing its preview…', 'Сегментированная модель сохранена для проверки. Готовим предпросмотр…'],
  ['Retrying model preview…', 'Повторно готовим предпросмотр модели…'],
  ['Cancellation requested. Waiting for registration to finish…', 'Запрошена отмена. Ждём завершения регистрации…'],
  ['Registration finished; the file was kept and not submitted.', 'Регистрация завершена; файл сохранён, но не отправлен.'],
  ['Cancelled before registration began.', 'Отменено до начала регистрации.'],
  ['The review request finished while cancellation was requested. Refresh the job to confirm its status.', 'Запрос проверки завершился во время отмены. Обновите задание, чтобы проверить его состояние.'],
  ['Preview is ready for your review.', 'Предпросмотр готов к проверке.'],
  ['The segmented model preview is ready for review.', 'Предпросмотр сегментированной модели готов к проверке.'],
  ['The preview file is ready. Reopen this item to inspect it.', 'Файл предпросмотра готов. Снова откройте эту деталь, чтобы проверить модель.'],
  ['The preview file is ready. Reopen the segmented model to inspect it.', 'Файл предпросмотра готов. Снова откройте сегментированную модель, чтобы проверить её.'],
  ['The preview file is ready. Open the viewer to inspect the model.', 'Файл предпросмотра готов. Откройте просмотр, чтобы проверить модель.'],
  ['This same model is already waiting for review.', 'Эта же модель уже ожидает проверки.'],
  ['This model is already accepted for the current sources.', 'Эта модель уже принята для актуальных исходников.'],
  ['Opening the prepared preview for review…', 'Открываем подготовленный предпросмотр для проверки…'],
  ['The model was registered, but preview preparation failed. Retry the preview or refresh the job.', 'Модель зарегистрирована, но подготовить предпросмотр не удалось. Повторите предпросмотр или обновите задание.'],
  ['The segmented model is registered, but preview preparation failed. Retry the preview or refresh the job.', 'Сегментированная модель зарегистрирована, но подготовить предпросмотр не удалось. Повторите предпросмотр или обновите задание.'],
  ['The model was imported, but its preview could not be opened. The model remains saved for review.', 'Модель импортирована, но не открылась в предпросмотре. Она сохранена для проверки.'],
  ['The saved model is no longer in this item’s review slot. Refresh the job before retrying.', 'Сохранённая модель больше не находится в слоте проверки этой детали. Обновите задание перед повтором.'],
  ['The saved segmented model is missing from this job. Refresh the job before retrying its preview.', 'Сегментированная модель отсутствует в этом задании. Обновите задание перед повтором предпросмотра.'],
  ['The model is saved, but the preview could not be retried. Refresh the job and try again.', 'Модель сохранена, но повторно подготовить предпросмотр не удалось. Обновите задание и повторите попытку.'],
];

function localizedImportCopy(message: string, locale: 'en' | 'ru'): string | undefined {
  const pair = importStatusCopy.find(([english, russian]) => message === english || message === russian);
  return pair?.[locale === 'ru' ? 1 : 0];
}

function importCopy(english: string, locale: 'en' | 'ru'): string {
  return localizedImportCopy(english, locale) || english;
}

export function assetModelImportStatusMessage(activity: AssetModelImportActivity, locale: 'en' | 'ru'): string {
  if (activity.state === 'error') {
    if (activity.code === 'IMPORT_INTERRUPTED') return locale === 'ru'
      ? 'Окно обновилось до подтверждения результата. Обновите задание и проверьте деталь перед повтором.'
      : 'The window refreshed before this operation was confirmed. Refresh the job and check the item before retrying.';
    if (activity.stage === 'preview') {
      if (activity.code === 'CANDIDATE_MISSING') return importCopy('The saved model is no longer in this item’s review slot. Refresh the job before retrying.', locale);
      if (activity.code === 'SHARED_SOURCE_MISSING') return importCopy('The saved segmented model is missing from this job. Refresh the job before retrying its preview.', locale);
      if (activity.code === 'MODEL_PREVIEW_RETRY_FAILED') return importCopy('The model is saved, but the preview could not be retried. Refresh the job and try again.', locale);
      return activity.phase === 'shared-geometry'
        ? importCopy('The segmented model is registered, but preview preparation failed. Retry the preview or refresh the job.', locale)
        : importCopy('The model was registered, but preview preparation failed. Retry the preview or refresh the job.', locale);
    }
    return assetModelImportError(activity.detail || activity.message, locale);
  }
  const known = localizedImportCopy(activity.message, locale);
  if (known) return known;
  if (activity.state === 'importing') return activity.stage === 'registering'
    ? locale === 'ru' ? 'Проверяем и регистрируем файл…' : 'Checking and registering file…'
    : activity.stage === 'submitting'
      ? locale === 'ru' ? 'Готовим запись для проверки…' : 'Preparing the review entry…'
      : locale === 'ru' ? 'Готовим предпросмотр модели…' : 'Preparing the model preview…';
  if (activity.state === 'cancelling') return locale === 'ru'
    ? 'Запрошена отмена. Ждём завершения регистрации…'
    : 'Cancellation requested. Waiting for registration to finish…';
  return activity.message;
}

export function assetModelImportStageLabel(activity: AssetModelImportActivity, locale: 'en' | 'ru'): string {
  const t = (en: string, ru: string) => locale === 'ru' ? ru : en;
  if (activity.state === 'error') return activity.stage === 'preview'
    ? t('Preview failed', 'Ошибка предпросмотра')
    : t('Import failed', 'Ошибка импорта');
  if (activity.state === 'complete') return t('Import complete', 'Импорт завершён');
  if (activity.state === 'cancelled') return t('Import cancelled', 'Импорт отменён');
  if (activity.state === 'cancelling') return t('Waiting for registration to finish', 'Ждём завершения регистрации');
  if (activity.state === 'preview') return t('Preparing model preview', 'Готовим предпросмотр модели');
  return activity.stage === 'registering'
    ? t('Checking and registering file', 'Проверяем и регистрируем файл')
    : activity.stage === 'submitting'
      ? t('Preparing review entry', 'Готовим запись для проверки')
      : t('Preparing model preview', 'Готовим предпросмотр модели');
}

export function assetModelImportStatusDetail(activity: AssetModelImportActivity, locale: 'en' | 'ru'): string | undefined {
  if (activity.code === 'IMPORT_INTERRUPTED') return locale === 'ru'
    ? 'Ожидание операции остановилось при обновлении интерфейса. Регистрация исходного файла могла завершиться; автоматическая отправка не выполнялась.'
    : 'The UI stopped waiting when it refreshed. Source registration may have completed; no automatic submission was performed.';
  return activity.detail;
}
