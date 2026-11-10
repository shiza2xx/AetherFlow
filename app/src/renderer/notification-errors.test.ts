import {describe,expect,it} from 'vitest';
import {closeFailureDetail,notificationDiagnostic,redactNotificationDetail} from './notification-errors';

describe('notification error details',()=>{
 it('retains a source error while removing local paths and credential-like values',()=>{
  const error=Object.assign(new Error('EACCES: cannot read C:\\Users\\Ada\\private\\depth.png; api_key=sk-test-123'),{code:'EACCES'});
  const diagnostic=notificationDiagnostic(error,'en');
  expect(diagnostic.code).toBe('EACCES');
  expect(diagnostic.detail).toContain('EACCES: cannot read [local path]');
  expect(diagnostic.detail).toContain('api_key=[redacted]');
  expect(diagnostic.detail).not.toContain('Ada');
  expect(diagnostic.detail).not.toContain('sk-test-123');
 });

 it('provides an expandable diagnostic for empty failures in both supported locales',()=>{
  const english=notificationDiagnostic(new Error(''),'en'),russian=notificationDiagnostic(new Error(''),'ru');
  expect(english).toMatchObject({code:'APP_ERROR'});
  expect(english.detail).toMatch(/did not provide additional diagnostics/i);
  expect(russian).toMatchObject({code:'APP_ERROR'});
  expect(russian.detail).toMatch(/не передало дополнительные сведения/i);
 });

 it('does not treat whitespace-only or fully redacted details as useful diagnostics',()=>{
  expect(notificationDiagnostic('  ','en').detail).toMatch(/did not provide additional diagnostics/i);
  expect(redactNotificationDetail('Bearer token-value')).toBe('Bearer [redacted]');
  expect(redactNotificationDetail('https://user:secret@example.invalid/path')).toBe('https://[redacted]@example.invalid/path');
 });

 it('localizes known close failures with a concrete reason',()=>{
  expect(closeFailureDetail('timeout','en')).toMatch(/did not confirm closing before the timeout/i);
  expect(closeFailureDetail('save-failed','ru')).toMatch(/не удалось сохранить/i);
 });
});
