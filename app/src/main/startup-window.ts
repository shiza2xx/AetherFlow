export type StartupLocale = 'en'|'ru';
export type StartupTheme = 'dark'|'light';

export function startupWindowDocument(locale:StartupLocale,theme:StartupTheme='dark',logoDataUrl=''){
 const copy=locale==='ru'?{
  title:'Запуск AetherFlow',
  heading:'Подготовка студии',
  message:'Подготавливаем рабочее пространство и локальные службы.',
  status:'Запуск AetherFlow'
 }:{
  title:'Starting AetherFlow',
  heading:'Preparing your studio',
  message:'Preparing the workspace and local services.',
  status:'Starting AetherFlow'
 };
 const mark=logoDataUrl?`<img class="mark" src="${logoDataUrl}" alt="">`:'<div class="mark" aria-hidden="true">✦</div>';
 return `<!doctype html>
<html lang="${locale}" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${theme}">
<title>${copy.title}</title>
<style>
:root{font-family:"Segoe UI",Arial,sans-serif;color:#eeeeee;background:#0d0d0d;font-synthesis:none;text-rendering:optimizeLegibility}
*{box-sizing:border-box}
html[data-theme="light"]{color:#172a42;background:#f4f7fb}
body{margin:0;min-height:100vh;overflow:hidden;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 18%,#222 0%,#0d0d0d 64%)}
html[data-theme="light"] body{background:radial-gradient(ellipse at 50% 18%,#fff 0%,#edf3f9 64%)}
main{width:min(100%,520px);padding:22px 36px;text-align:center}
.mark{display:block;width:64px;height:64px;margin:0 auto 12px;object-fit:contain}
.brand{margin:0;color:#f3f6fc;font-family:Georgia,serif;font-size:34px;letter-spacing:.01em}
html[data-theme="light"] .brand{color:#172a42}
h1{margin:18px 0 6px;font-size:17px;font-weight:600;letter-spacing:.02em}
html[data-theme="light"] h1{color:#172a42}
p{margin:0;color:#b5b5b5;font-size:13px;line-height:1.65}
html[data-theme="light"] p{color:#586e86}
.status{display:flex;align-items:center;justify-content:center;gap:9px;margin-top:16px;color:#8fa4c0;font-size:11px;letter-spacing:.12em;text-transform:uppercase}
html[data-theme="light"] .status{color:#586e86}
.dot{width:6px;height:6px;border-radius:50%;background:#6ca9ff;box-shadow:0 0 12px #6ca9ff80}
</style>
</head>
<body>
<main>
${mark}
<p class="brand">AetherFlow</p>
<h1>${copy.heading}</h1>
<p>${copy.message}</p>
<div class="status" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span>${copy.status}</div>
</main>
</body>
</html>`;
}

export function duplicateInstanceNotice(locale:StartupLocale){
 return locale==='ru'?{
  title:'AetherFlow уже запущен',
  message:'Другой процесс AetherFlow уже запущен. Этот запуск будет закрыт. Если окно AetherFlow не видно, другой процесс может ещё запускаться.'
 }:{
  title:'AetherFlow is already running',
  message:'Another AetherFlow process already holds the single-instance lock. This launch will close. If no AetherFlow window is visible, that process may still be starting.'
 };
}
