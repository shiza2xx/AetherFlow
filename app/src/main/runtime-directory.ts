import fs from 'node:fs';
import path from 'node:path';

function samePath(left: string, right: string) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Creates a runtime directory, rejects redirects, and returns its canonical spelling. */
export function ensureCanonicalRuntimeDirectory(directory: string, label: string) {
  const requested = path.resolve(directory);
  fs.mkdirSync(requested, { recursive: true });
  const stat = fs.lstatSync(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Configured application ${label} directory is unsafe.`);
  }
  const real = fs.realpathSync.native(requested);
  if (!samePath(real, requested)) {
    throw new Error(`Configured application ${label} directory is unsafe.`);
  }
  return real;
}
