import { parentPort, workerData } from 'node:worker_threads';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function normalized(file) { const value = path.resolve(file); return process.platform === 'win32' ? value.toLowerCase() : value; }
function sameFile(left, right) {
  return left.isFile() && right.isFile() && !left.isSymbolicLink() && !right.isSymbolicLink()
    && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
    && left.ino === right.ino && left.dev === right.dev;
}
function check(entry) {
  const file = path.resolve(entry.file);
  let fd;
  try {
    const before = fs.lstatSync(file);
    if (!before.isFile() || before.isSymbolicLink() || normalized(fs.realpathSync.native(file)) !== normalized(file)) throw new Error('file is missing, unsafe, or not canonical');
    fd = fs.openSync(file, 'r');
    const opened = fs.fstatSync(fd);
    if (!sameFile(before, opened)) throw new Error('file changed before hashing');
    const hash = crypto.createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0, count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0, count)); bytes += count; }
    const actual = hash.digest('hex'), afterHandle = fs.fstatSync(fd), afterPath = fs.lstatSync(file);
    if (!sameFile(before, afterHandle) || !sameFile(before, afterPath) || normalized(fs.realpathSync.native(file)) !== normalized(file) || bytes !== before.size) throw new Error('file changed while hashing');
    if (actual !== entry.expectedHash) throw new Error('SHA-256 does not match the expected hash');
    return { file, expectedHash: entry.expectedHash, fingerprint: { size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, ino: before.ino, dev: before.dev } };
  } catch (error) {
    return { error: `${String(entry.label || path.basename(file))}: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

try {
  if (!parentPort || !Array.isArray(workerData?.files) || workerData.files.length > 10000) throw new Error('Hash validation request is invalid or exceeds its file bound.');
  const results = [];
  for (const entry of workerData.files) {
    if (!entry || typeof entry.file !== 'string' || !entry.file || typeof entry.expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.expectedHash)) throw new Error('Hash validation entry is malformed.');
    const result = check(entry);
    if (result?.error) throw new Error(result.error);
    results.push(result);
  }
  parentPort.postMessage({ ok: true, results });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
