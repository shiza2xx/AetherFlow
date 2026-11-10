import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { extractZipArchive } from './zip-extraction.mjs';

parentPort?.unref();

try {
  if (!parentPort) throw new Error('ZIP extraction worker has no parent port.');
  const file = workerData.file;
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || fs.realpathSync.native(file) !== path.resolve(file) || before.size > 128 * 1024 * 1024) {
    throw new Error('ZIP files over 128 MB cannot be expanded or are unsafe.');
  }
  const hash = crypto.createHash('sha256'), chunks = [];
  let bytes = 0;
  for await (const chunk of fs.createReadStream(file)) {
    bytes += chunk.length;
    if (bytes > 128 * 1024 * 1024) throw new Error('ZIP files over 128 MB cannot be expanded.');
    hash.update(chunk);
    chunks.push(chunk);
  }
  const after = fs.lstatSync(file);
  if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.ino !== before.ino || after.dev !== before.dev || hash.digest('hex') !== workerData.expectedHash) {
    throw new Error('Managed ZIP changed or failed its exact SHA-256 check during extraction.');
  }
  const entries = extractZipArchive(Buffer.concat(chunks, bytes)), transfer = new Set();
  const payload = entries.map(entry => {
    const source = entry.data;
    const data = source.byteOffset === 0 && source.byteLength === source.buffer.byteLength && source.buffer instanceof ArrayBuffer
      ? new Uint8Array(source.buffer)
      : Uint8Array.from(source);
    if (data.byteLength) transfer.add(data.buffer);
    return { name: entry.name, directory: entry.directory, data };
  });
  parentPort.postMessage({ entries: payload }, [...transfer]);
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
