import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateReferenceManifest(manifest) {
  const required = manifest?.requiredRoles;
  const supplied = manifest?.suppliedRoles;
  if (!Array.isArray(required) || !Array.isArray(supplied) || [...required, ...supplied].some(role => typeof role !== 'string' || !role.trim())) {
    throw new Error('requiredRoles and suppliedRoles must be arrays of nonempty role names.');
  }
  const missing = [...new Set(required.filter(role => !supplied.includes(role)))].sort();
  const duplicates = [...new Set(supplied.filter((role, index) => supplied.indexOf(role) !== index))].sort();
  return { ok: missing.length === 0 && duplicates.length === 0, missing, duplicates };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
    const result = validateReferenceManifest(manifest);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
