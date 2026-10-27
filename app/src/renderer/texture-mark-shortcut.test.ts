import { describe, expect, it } from 'vitest';
import { resolveTextureMarkShortcut } from './texture-mark-shortcut';

const shortcut = (overrides: Partial<Parameters<typeof resolveTextureMarkShortcut>[0]> = {}) => resolveTextureMarkShortcut({
  markMode: true, withinViewer: true, editableTarget: false, key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, ...overrides,
});

describe('texture markup keyboard scope', () => {
  it('undoes and redoes only inside an active viewer session', () => {
    expect(shortcut()).toBe('undo');
    expect(shortcut({ shiftKey: true })).toBe('redo');
    expect(shortcut({ key: 'y' })).toBe('redo');
    expect(shortcut({ withinViewer: false })).toBeNull();
    expect(shortcut({ markMode: false })).toBeNull();
    expect(shortcut({ ctrlKey: false })).toBeNull();
  });

  it('leaves native text editing shortcuts alone', () => {
    expect(shortcut({ editableTarget: true })).toBeNull();
  });

  it('recognizes physical Z and Y keys on a Russian keyboard layout',()=>{
    expect(shortcut({key:'я',code:'KeyZ'})).toBe('undo');
    expect(shortcut({key:'я',code:'KeyZ',shiftKey:true})).toBe('redo');
    expect(shortcut({key:'н',code:'KeyY'})).toBe('redo');
  });
});
