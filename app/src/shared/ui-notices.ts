import type { Locale } from './i18n';

export type NoticeSeverity = 'success' | 'error' | 'info';
export type NoticeId =
  | 'gallery.imported' | 'gallery.importFailed' | 'gallery.deleted'
  | 'record.saved' | 'record.saveFailed'
  | 'workflow.started' | 'workflow.submitted' | 'workflow.blockerResolved' | 'workflow.checksCompleted' | 'workflow.actionFailed'
  | 'prompt.copied' | 'prompt.actionFailed'
  | 'workspace.restored' | 'workspace.restoreFailed'
  | 'workspace.backupCreated' | 'workflow.slotAdded' | 'notification.none'
  | 'file.actionFailed' | 'action.failed'
  | 'form.nameRequired' | 'form.dateInvalid'
  | 'form.dateIncomplete' | 'form.calendarDateInvalid' | 'workflow.loading'
  | 'prompt.originalCopied' | 'workflow.reviewAccepted' | 'workflow.reviewReturned'
  | 'record.archived' | 'record.restored' | 'codex.opened'
  | 'operation.cancelRequested' | 'operation.cancelUnavailable'
  | 'media.previewUnavailable' | 'integration.diagnostics'
  | 'error.revisionConflict' | 'error.fileMissing' | 'error.invalidImage' | 'error.fileTooLarge'
  | 'error.fileReadDenied' | 'error.importFileRequired' | 'error.importFolderRequired' | 'error.localPathRequired'
  | 'error.unsafePath' | 'error.validatorMissing' | 'error.stageLocked' | 'error.cliUnavailable'
  | 'picker.folderRequired' | 'picker.imageRequired'
  | 'plan.nameRequired' | 'plan.milestoneNeedsPlan' | 'plan.taskNeedsPlan'
  | 'milestone.prerequisiteIncomplete' | 'milestone.dateInvalid' | 'character.missing';

export type UiNotice = { id: NoticeId; severity: NoticeSeverity; detail?: string; code?: string };

const catalog: Record<Locale, Record<NoticeId, string>> = {
  en: {
    'gallery.imported': 'Artwork imported into one concept.',
    'gallery.deleted': 'Gallery record deleted. Any bytes that could not be reclaimed remain queued for a safe retry.',
    'gallery.importFailed': 'Artwork could not be imported. Review the import details.',
    'record.saved': 'Changes saved.',
    'record.saveFailed': 'The record could not be saved. Review the error details.',
    'workflow.started': 'Production started with the concept artwork linked.',
    'workflow.submitted': 'The managed output was submitted for human review.',
    'workflow.blockerResolved': 'The blocker was resolved through the required review workflow.',
    'workflow.checksCompleted': 'Independent checks completed. Missing validators remain blocked.',
    'workflow.actionFailed': 'The production step could not be completed. Review the workflow details.',
    'prompt.copied': 'The localized stage request was saved and copied. No generation was started.',
    'prompt.actionFailed': 'The stage request could not be prepared. Review the request details.',
    'workspace.restored': 'The verified backup was restored and activated.',
    'workspace.backupCreated': 'A verified workspace backup was created.',
    'workflow.slotAdded': 'The typed model drop slot was added.',
    'notification.none': 'There are no unread workspace notifications.',
    'workspace.restoreFailed': 'The backup could not be restored or activated. Review the recovery details.',
    'file.actionFailed': 'The local file action could not be completed. Review the file details.',
    'action.failed': 'This action could not be completed. Review the details for this action.',
    'form.nameRequired': 'Add a name before saving.',
    'form.dateInvalid': 'Enter a valid due date as YYYY-MM-DD.',
    'form.dateIncomplete': 'Enter a complete date as YYYY-MM-DD.',
    'form.calendarDateInvalid': 'That calendar date does not exist.',
    'workflow.loading': 'Production status is still loading.',
    'prompt.originalCopied': 'The saved original request was copied byte for byte.',
    'workflow.reviewAccepted': 'Human review was recorded.',
    'workflow.reviewReturned': 'The candidate was returned for revision.',
    'record.archived': 'The record was archived with its history.',
    'record.restored': 'The record was restored to active production.',
    'codex.opened': 'Codex opened in a separate terminal.',
    'operation.cancelRequested': 'Cancellation was requested; the candidate remains unpublished.',
    'operation.cancelUnavailable': 'This operation can no longer be cancelled.',
    'media.previewUnavailable': 'The media preview is unavailable.',
    'integration.diagnostics': 'Integration diagnostics are ready. Details are available below.',
    'error.revisionConflict': 'This record changed since you opened it. Your draft is still here; reload to review the latest version.',
    'error.fileMissing': 'The selected file or folder is no longer available. Choose an existing local path and try again.',
    'error.invalidImage': 'The file is not a supported, complete image. Choose a valid PNG, JPEG, WebP, or GIF.',
    'error.fileTooLarge': 'The image exceeds the safe decode or import limit. Choose a smaller image.',
    'error.fileReadDenied': 'Windows did not allow AetherFlow to read this file or folder. Check its access permissions and try again.',
    'error.importFileRequired': 'Choose a file to import, rather than a folder. You can import a model package as a ZIP file.',
    'error.importFolderRequired': 'Choose an existing folder to browse.',
    'error.localPathRequired': 'Choose an absolute file or folder path on a local drive.',
    'error.unsafePath': 'This path escapes the folder selected for this operation. Choose a path inside that folder.',
    'error.validatorMissing': 'A required local validator is unavailable. Configure the dependency before continuing.',
    'error.stageLocked': 'This production stage is locked or its review lease expired. Reopen the stage and claim a current lease.',
    'error.cliUnavailable': 'The Codex command is unavailable. Set a valid local executable path in Settings.',
    'picker.folderRequired': 'Choose a folder with the navigation control above.',
    'picker.imageRequired': 'Choose a PNG, JPEG, WebP, or GIF image.',
    'plan.nameRequired': 'Enter a plan name first.',
    'plan.milestoneNeedsPlan': 'Choose a plan and enter a milestone name.',
    'plan.taskNeedsPlan': 'Choose a plan and enter a task name.',
    'milestone.prerequisiteIncomplete': 'Complete the prerequisite milestones before finishing this one.',
    'milestone.dateInvalid': 'Enter a valid milestone date as YYYY-MM-DD.',
    'character.missing': 'That character is no longer available. The character list is open.'
  },
  ru: {
    'gallery.imported': 'Изображения добавлены в один концепт.',
    'gallery.deleted': 'Запись удалена из галереи. Неосвобождённые байты поставлены в очередь безопасного повтора.',
    'gallery.importFailed': 'Не удалось импортировать изображения. Откройте сведения об импорте.',
    'record.saved': 'Изменения сохранены.',
    'record.saveFailed': 'Не удалось сохранить запись. Откройте сведения об ошибке.',
    'workflow.started': 'Производство начато, изображения концепта связаны с персонажем.',
    'workflow.submitted': 'Управляемый результат отправлен на проверку человеком.',
    'workflow.blockerResolved': 'Блокировка снята через обязательный процесс проверки.',
    'workflow.checksCompleted': 'Независимые проверки завершены. При отсутствии валидаторов этап остаётся заблокированным.',
    'workflow.actionFailed': 'Не удалось выполнить этап производства. Откройте сведения о процессе.',
    'prompt.copied': 'Локализованный запрос этапа сохранён и скопирован. Генерация не запускалась.',
    'prompt.actionFailed': 'Не удалось подготовить запрос этапа. Откройте сведения о запросе.',
    'workspace.restored': 'Проверенная резервная копия восстановлена и активирована.',
    'workspace.backupCreated': 'Проверенная резервная копия рабочего пространства создана.',
    'workflow.slotAdded': 'Добавлен слот для типизированного результата модели.',
    'notification.none': 'Непрочитанных уведомлений рабочего пространства нет.',
    'workspace.restoreFailed': 'Не удалось восстановить или активировать копию. Откройте сведения о восстановлении.',
    'file.actionFailed': 'Не удалось выполнить действие с локальным файлом. Откройте сведения о файле.',
    'action.failed': 'Не удалось выполнить это действие. Откройте сведения об ошибке.',
    'form.nameRequired': 'Укажите название перед сохранением.',
    'form.dateInvalid': 'Укажите корректную дату в формате ГГГГ-ММ-ДД.',
    'form.dateIncomplete': 'Введите полную дату в формате ГГГГ-ММ-ДД.',
    'form.calendarDateInvalid': 'Такой календарной даты не существует.',
    'workflow.loading': 'Состояние производства ещё загружается.',
    'prompt.originalCopied': 'Сохранённый исходный запрос скопирован без изменения байтов.',
    'workflow.reviewAccepted': 'Решение проверки человеком сохранено.',
    'workflow.reviewReturned': 'Результат возвращён на доработку.',
    'record.archived': 'Запись помещена в архив вместе с историей.',
    'record.restored': 'Запись возвращена в активное производство.',
    'codex.opened': 'Codex открыт в отдельном терминале.',
    'operation.cancelRequested': 'Отмена запрошена; вариант остаётся неопубликованным.',
    'operation.cancelUnavailable': 'Эту операцию уже нельзя отменить.',
    'media.previewUnavailable': 'Предпросмотр медиафайла недоступен.',
    'integration.diagnostics': 'Диагностика интеграций завершена. Сведения доступны ниже.',
    'error.revisionConflict': 'Запись изменилась после открытия. Черновик сохранён; перезагрузите запись, чтобы увидеть актуальную версию.',
    'error.fileMissing': 'Выбранный файл или папка больше недоступны. Выберите существующий локальный путь и повторите действие.',
    'error.invalidImage': 'Файл не является поддерживаемым целым изображением. Выберите корректный PNG, JPEG, WebP или GIF.',
    'error.fileTooLarge': 'Размер изображения превышает безопасный предел обработки или импорта. Выберите файл поменьше.',
    'error.fileReadDenied': 'Windows не разрешает прочитать этот файл или папку. Проверьте права доступа к ним и повторите попытку.',
    'error.importFileRequired': 'Выберите файл, а не папку. Пакет модели можно импортировать как ZIP-файл.',
    'error.importFolderRequired': 'Выберите существующую папку для просмотра.',
    'error.localPathRequired': 'Укажите полный путь к файлу или папке на локальном диске.',
    'error.unsafePath': 'Этот путь выходит за пределы папки, выбранной для операции. Выберите путь внутри неё.',
    'error.validatorMissing': 'Необходимый локальный проверяющий инструмент недоступен. Настройте зависимость перед продолжением.',
    'error.stageLocked': 'Этап производства заблокирован или срок аренды проверки истёк. Откройте этап и получите новую аренду.',
    'error.cliUnavailable': 'Команда Codex недоступна. Укажите корректный локальный путь к программе в настройках.',
    'picker.folderRequired': 'Выберите папку с помощью навигации выше.',
    'picker.imageRequired': 'Выберите изображение PNG, JPEG, WebP или GIF.',
    'plan.nameRequired': 'Сначала укажите название плана.',
    'plan.milestoneNeedsPlan': 'Выберите план и укажите название этапа.',
    'plan.taskNeedsPlan': 'Выберите план и введите название задачи.',
    'milestone.prerequisiteIncomplete': 'Сначала завершите предварительные этапы.',
    'milestone.dateInvalid': 'Введите корректную дату этапа в формате ГГГГ-ММ-ДД.',
    'character.missing': 'Персонаж больше недоступен. Открыт список персонажей.'
  }
};

export function formatNotice(locale: Locale, id: NoticeId): string {
  return catalog[locale][id];
}

export function errorNoticeId(context: 'gallery' | 'record' | 'workflow' | 'prompt' | 'restore' | 'file' | 'action'): NoticeId {
  switch (context) {
    case 'gallery': return 'gallery.importFailed';
    case 'record': return 'record.saveFailed';
    case 'workflow': return 'workflow.actionFailed';
    case 'prompt': return 'prompt.actionFailed';
    case 'restore': return 'workspace.restoreFailed';
    case 'file': return 'file.actionFailed';
    default: return 'action.failed';
  }
}

export function classifyErrorNotice(error: unknown, fallback: NoticeId = 'action.failed'): NoticeId {
  const candidate = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : { message: error };
  const code = String(candidate.code || '').toUpperCase();
  const message = String(candidate.message || '').toLowerCase();
  if (code === 'IMPORT_READ_DENIED' || code === 'EACCES' || code === 'EPERM') return 'error.fileReadDenied';
  if (code === 'IMPORT_FILE_REQUIRED') return 'error.importFileRequired';
  if (code === 'IMPORT_FOLDER_REQUIRED') return 'error.importFolderRequired';
  if (code === 'IMPORT_LOCAL_PATH_REQUIRED') return 'error.localPathRequired';
  if (code === 'IMPORT_SOURCE_MISSING') return 'error.fileMissing';
  if (code.includes('REVISION') || /changed since it was opened|revision conflict|expectedrevision/.test(message)) return 'error.revisionConflict';
  if (/TOO_LARGE|SIZE_LIMIT|DECODE_LIMIT/.test(code) || /decoded image exceeds the 64 mb limit|dimensions exceed the supported decode-work limit|gallery image exceeds 128 mb|animation exceeds the bounded frame\/decode limit|compressed image data exceeds its validation bound|exceeds? (the )?(maximum|limit)|too large|dimension limit/.test(message)) return 'error.fileTooLarge';
  if (/IMAGE|DECOD|TRUNCAT/.test(code) || /^(png|jpeg|webp|gif)\b/.test(message) || /\b(png|jpeg|webp|gif)\b.{0,100}\b(structure|incomplete|truncated|malformed|checksum|unsupported|invalid|missing|frame|chunk|data)\b/.test(message) || /not a supported image|invalid image|image header|truncated image|malformed (png|jpeg|webp|gif)|image bytes/.test(message)) return 'error.invalidImage';
  if (/PATH.*(SCOPE|UNSAFE)|SYMLINK|OUTSIDE.*ROOT/.test(code) || /outside (the )?(allowed|registered|workspace|home)|symbolic link|symlink|unsafe path/.test(message)) return 'error.unsafePath';
  if (/VALIDATOR|DEPENDENCY_MISSING|BLENDER_NOT_CONFIGURED/.test(code) || /validator.*(missing|unavailable)|configure blender|dependency is unavailable/.test(message)) return 'error.validatorMissing';
  if (/LEASE|STAGE_LOCKED|WORKFLOW_LOCKED/.test(code) || /stage is locked|lease (has )?(expired|invalid|missing)|claim a current lease/.test(message)) return 'error.stageLocked';
  if (/CLI.*(MISSING|UNAVAILABLE)|CODEX.*(MISSING|UNAVAILABLE)|COMMAND_NOT_FOUND/.test(code) || /codex command is unavailable|codex executable.*not found/.test(message)) return 'error.cliUnavailable';
  if (code === 'ENOENT' || code.includes('NOT_FOUND') || /file or directory not found|folder was not found|file was not found|no such file|path does not exist/.test(message)) return 'error.fileMissing';
  return fallback;
}
