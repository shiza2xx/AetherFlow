export type TextureMarkStroke = {
  mode: 'paint' | 'erase';
  radiusPx: number;
  points: Array<{ u: number; v: number }>;
};

export type TextureMarkHistoryState = {
  strokes: Map<string, TextureMarkStroke[]>;
  undo: Array<{ before: Map<string, TextureMarkStroke[]>; after: Map<string, TextureMarkStroke[]> }>;
  redo: Array<{ before: Map<string, TextureMarkStroke[]>; after: Map<string, TextureMarkStroke[]> }>;
};

const MAX_HISTORY = 512;

export function createTextureMarkHistory(strokes: Iterable<[string, TextureMarkStroke[]]> = []): TextureMarkHistoryState {
  return { strokes: new Map(strokes), undo: [], redo: [] };
}

export function commitTextureMarkChange(
  state: TextureMarkHistoryState,
  changes: Iterable<[string, TextureMarkStroke[]]>,
): TextureMarkHistoryState {
  const before = new Map<string, TextureMarkStroke[]>();
  const after = new Map<string, TextureMarkStroke[]>();
  const strokes = new Map(state.strokes);
  for (const [key, next] of changes) {
    const current = strokes.get(key) || [];
    if (current === next || (current.length === next.length && current.every((stroke, index) => stroke === next[index]))) continue;
    before.set(key, current);
    after.set(key, next);
    strokes.set(key, next);
  }
  if (!after.size) return state;
  return {
    strokes,
    undo: [...state.undo, { before, after }].slice(-MAX_HISTORY),
    redo: [],
  };
}

function apply(state: TextureMarkHistoryState, direction: 'undo' | 'redo'): TextureMarkHistoryState {
  const source = direction === 'undo' ? state.undo : state.redo;
  if (!source.length) return state;
  const entry = source[source.length - 1];
  const strokes = new Map(state.strokes);
  for (const [key, rows] of (direction === 'undo' ? entry.before : entry.after)) strokes.set(key, rows);
  if (direction === 'undo') {
    return { strokes, undo: source.slice(0, -1), redo: [...state.redo, entry].slice(-MAX_HISTORY) };
  }
  return { strokes, undo: [...state.undo, entry].slice(-MAX_HISTORY), redo: source.slice(0, -1) };
}

export function undoTextureMarkChange(state: TextureMarkHistoryState): TextureMarkHistoryState {
  return apply(state, 'undo');
}

export function redoTextureMarkChange(state: TextureMarkHistoryState): TextureMarkHistoryState {
  return apply(state, 'redo');
}

export function clearTextureMarkChanges(state: TextureMarkHistoryState): TextureMarkHistoryState {
  return commitTextureMarkChange(state, [...state.strokes].filter(([, rows]) => rows.length).map(([key]) => [key, []]));
}
