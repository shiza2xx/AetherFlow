import { parentPort, workerData } from 'node:worker_threads';
import { validateModelFile } from './model-file-validation.mjs';

parentPort?.unref();

try {
  if (!parentPort) throw new Error('Model validation worker has no parent port.');
  const result = await validateModelFile(workerData);
  parentPort.postMessage({ result });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
