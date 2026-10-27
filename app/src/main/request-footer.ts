import path from 'node:path';
import type {Locale} from '../shared/i18n';
import {isLocale} from '../shared/i18n';

export function parseWorkspaceFooter(markdown:string):{locale:Locale;workspace:string}|null{
  const marker=/^(Workspace|Рабочее пространство):\s*(.*?)\s*$/gm,rows=[...markdown.matchAll(marker)];
  if(rows.length!==1||!rows[0][2])return null;
  const workspace=rows[0][2],locale:Locale=rows[0][1]==='Рабочее пространство'?'ru':'en';
  if(!path.isAbsolute(workspace)&&!/^([A-Za-z]:[\\/]|\\\\)/.test(workspace))return null;
  return {locale,workspace};
}
export function verifyWorkspaceFooter(markdown:string,work:string,locale?:Locale){
  const parsed=parseWorkspaceFooter(markdown);if(!parsed)return false;
  const expectedLocale=isLocale(locale)?locale:'en';if(parsed.locale!==expectedLocale)return false;
  const expected=path.resolve(work),claimed=path.resolve(parsed.workspace);
  return process.platform==='win32'?claimed.toLowerCase()===expected.toLowerCase():claimed===expected;
}
