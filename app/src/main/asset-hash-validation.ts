import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';

export type AssetHashCheck = { file: string; expectedHash: string; label?: string };
const verifiedHashes = new Map<string, string>();

function normalized(file: string) { const value = path.resolve(file); return process.platform === 'win32' ? value.toLowerCase() : value; }

async function fileFingerprint(file: string) {
  const absolute = path.resolve(file), stat = await fs.promises.lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || normalized(await fs.promises.realpath(absolute)) !== normalized(absolute)) throw new Error('Asset file is missing, unsafe, or not canonical.');
  return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}:${stat.dev}`;
}

/** Verify content-addressed files away from Electron's main event loop. */
export async function verifyAssetHashesOffThread(files: AssetHashCheck[], timeoutMs = 15 * 60_000, force = false): Promise<void> {
  if (!Array.isArray(files) || files.length > 10_000 || files.some(value => !value || typeof value.file !== 'string' || !value.file || !/^[a-f0-9]{64}$/.test(value.expectedHash) || value.label !== undefined && (typeof value.label !== 'string' || value.label.length > 500))) throw new Error('Asset hash verification request is malformed or exceeds its file bound.');
  if (!files.length) return;
  const unique = new Map<string, AssetHashCheck>();
  for (const entry of files) unique.set(`${path.resolve(entry.file)}\0${entry.expectedHash}`, { file: path.resolve(entry.file), expectedHash: entry.expectedHash, ...(entry.label ? { label: entry.label } : {}) });
  const pending: AssetHashCheck[] = [];
  for (const entry of unique.values()) {
    const cacheKey = `${normalized(entry.file)}\0${entry.expectedHash}`, fingerprint = await fileFingerprint(entry.file);
    if (force || verifiedHashes.get(cacheKey) !== fingerprint) pending.push(entry);
  }
  if (!pending.length) return;
  const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'asset-hash-validation-worker.mjs');
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(workerFile, { workerData: { files: pending }, resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
    let settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(deadline); void worker.terminate(); error ? reject(error) : resolve(); };
    const deadline = setTimeout(() => finish(new Error('Asset hash verification exceeded its time limit.')), timeoutMs);
    deadline.unref?.();
    worker.once('message', (message: any) => {
      if (message?.ok !== true || !Array.isArray(message.results) || message.results.length !== pending.length) { finish(new Error(String(message?.error || 'Asset hash verification failed.'))); return; }
      for (const result of message.results) if (result && typeof result.file === 'string' && /^[a-f0-9]{64}$/.test(String(result.expectedHash || '')) && result.fingerprint && typeof result.fingerprint === 'object') {
        verifiedHashes.set(`${normalized(result.file)}\0${result.expectedHash}`, `${result.fingerprint.size}:${result.fingerprint.mtimeMs}:${result.fingerprint.ctimeMs}:${result.fingerprint.ino}:${result.fingerprint.dev}`);
      }
      if (verifiedHashes.size > 20_000) verifiedHashes.clear();
      finish();
    });
    worker.once('error', (error: Error) => finish(error));
    worker.once('exit', code => { if (!settled && code !== 0) finish(new Error(`Asset hash verification worker exited with code ${code}.`)); else if (!settled) finish(new Error('Asset hash verification worker exited without a result.')); });
  });
}
