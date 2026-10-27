/** Private Notebook rich-text contract. This data is deliberately separate from Entity. */
export type NotebookMark = 'strong' | 'em';
export type NotebookNode = { type: 'doc'; content: NotebookBlock[] };
export type NotebookBlock = { type: 'paragraph'; content?: NotebookInline[] };
export type NotebookInline = { type: 'text'; text: string; marks?: Array<{ type: NotebookMark }> } | { type: 'hard_break' };
export const EMPTY_NOTE: NotebookNode = { type: 'doc', content: [{ type: 'paragraph' }] };
export const NOTE_MAX_BYTES = 1024 * 1024;
export const NOTE_MAX_NODES = 20000;
export const NOTE_MAX_DEPTH = 32;

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const only = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
/** Throws a deliberately generic error so invalid/private text is never reflected to a caller. */
export function validateNotebookDocument(value: unknown): NotebookNode {
  try {
    const encoded = JSON.stringify(value);
    if (!encoded || new TextEncoder().encode(encoded).byteLength > NOTE_MAX_BYTES) throw new Error();
    let nodes = 0;
    const visit = (node: unknown, depth: number): void => {
      if (!plain(node) || depth > NOTE_MAX_DEPTH || ++nodes > NOTE_MAX_NODES || typeof node.type !== 'string') throw new Error();
      if (node.type === 'doc') {
        if (depth !== 0 || !only(node, ['type', 'content']) || !Array.isArray(node.content) || node.content.length < 1 || node.content.length > 10000) throw new Error();
        for (const block of node.content) visit(block, depth + 1);
      } else if (node.type === 'paragraph') {
        if (depth !== 1 || !only(node, ['type', 'content']) || node.content !== undefined && !Array.isArray(node.content)) throw new Error();
        for (const inline of (node.content || []) as unknown[]) visit(inline, depth + 1);
      } else if (node.type === 'hard_break') {
        if (depth !== 2 || !only(node, ['type'])) throw new Error();
      } else if (node.type === 'text') {
        if (depth !== 2 || !only(node, ['type', 'text', 'marks']) || typeof node.text !== 'string' || !node.text.length) throw new Error();
        if (node.marks !== undefined) {
          if (!Array.isArray(node.marks) || node.marks.length > 2) throw new Error();
          const seen = new Set<string>();
          for (const mark of node.marks) {
            if (!plain(mark) || !only(mark, ['type']) || !['strong', 'em'].includes(String(mark.type)) || seen.has(String(mark.type))) throw new Error();
            seen.add(String(mark.type));
          }
        }
      } else throw new Error();
    };
    visit(value, 0);
    return value as NotebookNode;
  } catch {
    throw Object.assign(new Error('Notebook content is invalid or exceeds its limit.'), { code: 'NOTE_INVALID' });
  }
}

export function validateNotebookTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 240) throw Object.assign(new Error('Notebook title is invalid.'), { code: 'NOTE_INVALID' });
  return value.trim();
}
