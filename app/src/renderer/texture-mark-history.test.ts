import { describe, expect, it } from 'vitest';
import { clearTextureMarkChanges, commitTextureMarkChange, createTextureMarkHistory, redoTextureMarkChange, undoTextureMarkChange } from './texture-mark-history';

const paint = (u: number) => ({ mode: 'paint' as const, radiusPx: 18, points: [{ u, v: .5 }] });
const erase = (u: number) => ({ mode: 'erase' as const, radiusPx: 18, points: [{ u, v: .5 }] });

describe('texture markup edit history', () => {
  it('undoes and redoes strokes chronologically across different texture targets', () => {
    let history = createTextureMarkHistory();
    history = commitTextureMarkChange(history, [['hair', [paint(.2)]]]);
    history = commitTextureMarkChange(history, [['body', [erase(.7)]]]);
    history = undoTextureMarkChange(history);
    expect(history.strokes.get('hair')).toHaveLength(1);
    expect(history.strokes.get('body')).toEqual([]);
    history = redoTextureMarkChange(history);
    expect(history.strokes.get('body')?.[0].mode).toBe('erase');
  });

  it('fully clears every target and restores the complete clear as one undoable action', () => {
    let history = createTextureMarkHistory([['hair', [paint(.2)]], ['body', [paint(.7), erase(.4)]]]);
    history = clearTextureMarkChanges(history);
    expect([...history.strokes.values()].every(rows => rows.length === 0)).toBe(true);
    history = undoTextureMarkChange(history);
    expect(history.strokes.get('hair')).toHaveLength(1);
    expect(history.strokes.get('body')).toHaveLength(2);
    history = redoTextureMarkChange(history);
    expect([...history.strokes.values()].every(rows => rows.length === 0)).toBe(true);
  });

  it('drops redo when a new edit follows undo and leaves original strokes intact', () => {
    let history = createTextureMarkHistory([['hair', [paint(.2)]]]);
    history = commitTextureMarkChange(history, [['hair', [paint(.2), erase(.4)]]]);
    history = undoTextureMarkChange(history);
    history = commitTextureMarkChange(history, [['body', [paint(.8)]]]);
    expect(history.redo).toHaveLength(0);
    expect(history.strokes.get('hair')).toHaveLength(1);
    expect(history.strokes.get('body')).toHaveLength(1);
  });
});
