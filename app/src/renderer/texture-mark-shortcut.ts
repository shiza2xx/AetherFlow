export type TextureMarkShortcut = 'undo' | 'redo' | null;

export function resolveTextureMarkShortcut(input: {
  markMode: boolean;
  withinViewer: boolean;
  editableTarget: boolean;
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): TextureMarkShortcut {
  if (!input.markMode || !input.withinViewer || input.editableTarget || !(input.ctrlKey || input.metaKey)) return null;
  const key = input.key.toLowerCase();
  const undoKey=key==='z'||input.code==='KeyZ';
  const redoKey=key==='y'||input.code==='KeyY';
  if (undoKey) return input.shiftKey ? 'redo' : 'undo';
  if (redoKey) return 'redo';
  return null;
}
