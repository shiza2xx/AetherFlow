export type NotificationLocale='en'|'ru';
export type NotificationDiagnostic={code:string;detail:string};

const missingDetail:Record<NotificationLocale,string>={
 en:'The action did not provide additional diagnostics. Retry it; if the error repeats, include code APP_ERROR when reporting it.',
 ru:'Действие не передало дополнительные сведения. Повторите его; если ошибка повторится, укажите при сообщении код APP_ERROR.',
};

function messageOf(error:unknown):string{
 if(error&&typeof error==='object'&&'message'in error)return String((error as {message?:unknown}).message||'');
 return String(error??'');
}

function codeOf(error:unknown):string{
 if(!error||typeof error!=='object'||!('code'in error))return 'APP_ERROR';
 const code=String((error as {code?:unknown}).code||'').trim();
 return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(code)?code:'APP_ERROR';
}

export function redactNotificationDetail(value:string):string{
 return value
  .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,'$1 [redacted]')
  .replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/gi,'$1[redacted]@')
  .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|token|password)\b\s*[:=]\s*[^\s,;]+/gi,'$1=[redacted]')
  .replace(/([?&](?:token|key|secret|code)=)[^&\s]+/gi,'$1[redacted]')
  .replace(/\\\\[^\\/\s]+\\[^\\/\s]+(?:\\[^\s]*)?/g,'[network path]')
  .replace(/"[A-Za-z]:[\\/][^"\r\n]*"|'[A-Za-z]:[\\/][^'\r\n]*'|(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s<>:"|?*\r\n]*/g,'[local path]')
  .replace(/(^|[\s("'=])(?:\/Users\/[^/\s]+(?:\/[^\s'"]*)?|\/home\/[^/\s]+(?:\/[^\s'"]*)?)/g,'$1[local path]')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ')
  .replace(/[ \t]+/g,' ')
  .trim()
  .slice(0,1200);
}

export function notificationDiagnostic(error:unknown,locale:NotificationLocale):NotificationDiagnostic{
 const detail=redactNotificationDetail(messageOf(error));
 return {code:codeOf(error),detail:detail||missingDetail[locale]};
}

export function closeFailureDetail(reason:unknown,locale:NotificationLocale):string{
 if(reason==='timeout')return locale==='ru'
  ?'Окно не подтвердило закрытие за отведённое время. Изменения могли не сохраниться.'
  :'The window did not confirm closing before the timeout. Some changes may not have been saved.';
 if(reason==='save-failed')return locale==='ru'
  ?'Одно или несколько открытых изменений не удалось сохранить, поэтому окно осталось открытым.'
  :'One or more open changes could not be saved, so the window stayed open.';
 return locale==='ru'
  ?'Закрытие окна не завершилось. Дополнительный код причины не получен.'
  :'The window did not finish closing. No additional failure reason was provided.';
}
