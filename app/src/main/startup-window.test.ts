import {describe,expect,it} from 'vitest';
import {duplicateInstanceNotice,startupWindowDocument} from './startup-window';

describe('startup window content',()=>{
 it.each(['en','ru'] as const)('renders a local accessible startup status in %s',locale=>{
  const html=startupWindowDocument(locale);
  expect(html).toContain(`<html lang="${locale}" data-theme="dark">`);
  expect(html).toContain('role="status" aria-live="polite"');
  expect(html).toContain(locale==='ru'?'Подготавливаем':'Preparing');
  expect(html).toContain('overflow:hidden');
  expect(html).not.toMatch(/<script\b|https?:\/\//i);
 });

 it('uses the saved light theme and supplied logo for the initial launcher',()=>{
  const html=startupWindowDocument('en','light','data:image/png;base64,AA==');
  expect(html).toContain('<html lang="en" data-theme="light">');
  expect(html).toContain('src="data:image/png;base64,AA=="');
  expect(html).toContain('html[data-theme="light"] body');
 });

 it('explains a duplicate launch without promising a window is available',()=>{
  const notice=duplicateInstanceNotice('en');
  expect(notice.title).toBe('AetherFlow is already running');
  expect(notice.message).toContain('single-instance lock');
  expect(notice.message).toContain('If no AetherFlow window is visible');
 });

 it('keeps the duplicate-launch explanation localized for Russian profiles',()=>{
  const notice=duplicateInstanceNotice('ru');
  expect(notice.title).toBe('AetherFlow уже запущен');
  expect(notice.message).toContain('Если окно AetherFlow не видно');
  expect(notice.message).toContain('может ещё запускаться');
 });
});
