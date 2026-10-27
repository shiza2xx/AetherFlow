import fs from 'node:fs';
import path from 'node:path';

// This cache contains only derived, disposable PNG previews. A small manifest
// provides LRU accounting without walking the directory on each tile render.
const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 512;
type Entry = { name: string; bytes: number; usedAt: number };
type Manifest = { version: 1; entries: Entry[] };
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
}

function safeName(key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Thumbnail key is invalid.');
  return `${key}.png`;
}

async function readManifest(directory: string): Promise<Manifest> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(path.join(directory, 'manifest.json'), 'utf8')) as Manifest;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return { version: 1, entries: [] };
    const entries = parsed.entries.filter((entry): entry is Entry => !!entry && typeof entry.name === 'string' && /^[a-f0-9]{64}\.png$/.test(entry.name) && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= MAX_ENTRY_BYTES && Number.isFinite(entry.usedAt)).slice(-MAX_ENTRIES);
    return { version: 1, entries };
  } catch {
    // One-time migration of the former hash-named PNG cache. This runs only
    // when no usable manifest exists, never on a normal thumbnail hit.
    const candidates: Entry[] = [];
    try {
      for (const name of await fs.promises.readdir(directory)) {
        if (!/^[a-f0-9]{64}\.png$/.test(name)) continue;
        try {
          const stat = await fs.promises.stat(path.join(directory, name));
          if (stat.isFile() && stat.size > 0 && stat.size <= MAX_ENTRY_BYTES) candidates.push({ name, bytes: stat.size, usedAt: stat.mtimeMs });
        } catch { /* stale cache entries are disposable */ }
      }
    } catch { /* cache directory has not been created */ }
    candidates.sort((a, b) => b.usedAt - a.usedAt);
    const entries: Entry[] = [];
    let total = 0;
    for (const entry of candidates) {
      if (entries.length >= MAX_ENTRIES || total + entry.bytes > MAX_TOTAL_BYTES) {
        await fs.promises.rm(path.join(directory, entry.name), { force: true });
      } else {
        entries.push(entry);
        total += entry.bytes;
      }
    }
    const manifest = { version: 1 as const, entries };
    if (entries.length) await writeManifest(directory, manifest);
    return manifest;
  }
}

async function writeManifest(directory: string, manifest: Manifest): Promise<void> {
  const file = path.join(directory, 'manifest.json');
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.promises.writeFile(temp, JSON.stringify(manifest), { flag: 'w' });
    await fs.promises.rename(temp, file);
  } finally {
    await fs.promises.rm(temp, { force: true });
  }
}

export async function readThumbnail(directory: string, key: string): Promise<Buffer | undefined> {
  return serial(async () => {
    const name = safeName(key);
    const manifest = await readManifest(directory);
    const index = manifest.entries.findIndex(entry => entry.name === name);
    if (index < 0) return undefined;
    const file = path.join(directory, name);
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES || stat.size !== manifest.entries[index].bytes) throw new Error('stale');
      const bytes = await fs.promises.readFile(file);
      // Throttle manifest churn: recency is refreshed at most once per minute.
      if (Date.now() - manifest.entries[index].usedAt > 60_000) {
        manifest.entries[index].usedAt = Date.now();
        await writeManifest(directory, manifest);
      }
      return bytes;
    } catch {
      manifest.entries.splice(index, 1);
      await writeManifest(directory, manifest);
      return undefined;
    }
  });
}

export async function writeThumbnail(directory: string, key: string, bytes: Buffer): Promise<void> {
  if (!bytes.length || bytes.length > MAX_ENTRY_BYTES) throw new Error('Generated image preview exceeds its cache bound.');
  await serial(async () => {
    await fs.promises.mkdir(directory, { recursive: true });
    const name = safeName(key);
    const manifest = await readManifest(directory);
    manifest.entries = manifest.entries.filter(entry => entry.name !== name);
    while (manifest.entries.length >= MAX_ENTRIES || manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0) + bytes.length > MAX_TOTAL_BYTES) {
      const [oldest] = manifest.entries.sort((a, b) => a.usedAt - b.usedAt);
      if (!oldest) break;
      manifest.entries.shift();
      // Only exact, manifest-listed cache names are ever eligible for eviction.
      await fs.promises.rm(path.join(directory, oldest.name), { force: true });
    }
    const file = path.join(directory, name), temp = `${file}.${process.pid}.tmp`;
    manifest.entries.push({ name, bytes: bytes.length, usedAt: Date.now() });
    await writeManifest(directory, manifest);
    try {
      await fs.promises.rm(file, { force: true });
      await fs.promises.writeFile(temp, bytes, { flag: 'w' });
      await fs.promises.rename(temp, file);
    } finally {
      await fs.promises.rm(temp, { force: true });
    }
  });
}
