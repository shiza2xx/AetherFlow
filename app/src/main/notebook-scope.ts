import crypto from 'node:crypto';

/** Ephemeral identity for the active store instance; it is intentionally not persisted. */
export class NotebookScope {
  private value=crypto.randomUUID();
  current(){return this.value;}
  rotate(){this.value=crypto.randomUUID();return this.value;}
  accepts(value:unknown){return typeof value==='string'&&value===this.value;}
}
