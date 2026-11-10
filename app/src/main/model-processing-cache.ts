import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AtelierStore } from './store';
import { ownerForArtifact } from './workspace-layout';

export type ModelProcessingIdentity = {
  schemaVersion: 2;
  key: string;
  workspace: string;
  owner: { kind: string; id: string };
  scope: string;
  profile: Record<string, unknown>;
  source: { logicalPath: string; hash: string };
  dependencies: Array<{ logicalPath: string; hash: string }>;
  recipe: { id: string; version: string; baselineHash: string | null; baselineDependencies: Array<{ logicalPath: string; hash: string }>; scripts: Array<{ path: string; hash: string }> };
  blender: { path: string; hash: string };
};

export type ModelProcessingHashTiming = {
  phase: 'source' | 'dependency' | 'baseline' | 'baseline-dependency' | 'script' | 'blender';
  durationMs: number;
  bytesHashed: number;
  reusedTrustedHash: boolean;
  verifiedDuringStaging: boolean;
};

type IdentityInput = {
  owner: { kind: string; id: string };
  scope?: string;
  profile?: Record<string, unknown>;
  artifactId: string;
  blenderPath: string;
  scripts: string[];
  recipeId: string;
  recipeVersion: string;
  baselineHash?: string | null;
  baselineArtifactId?: string;
  verifiedFiles?: Array<{ path: string; hash: string }>;
  onHashTiming?: (timing: ModelProcessingHashTiming) => void;
};

const inFlight = new WeakMap<AtelierStore, Map<string, Promise<unknown>>>();
const trustedProcessorHashes = new Map<string, { signature: string; hash: string }>();

function signature(stat: fs.BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(':');
}

function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function shaFile(file: string): Promise<string> {
  const absolute = path.resolve(file), lstat = await fs.promises.lstat(absolute);
  if (!lstat.isFile() || lstat.isSymbolicLink()) throw new Error('A model processing input must be a regular non-symlink file.');
  const real = await fs.promises.realpath(absolute);
  if (real !== absolute) throw new Error('A model processing input resolves through an alias.');
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(absolute);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  const after = await fs.promises.stat(absolute);
  if (!after.isFile() || after.size !== lstat.size) throw new Error('A model processing input changed while it was being hashed.');
  return hash.digest('hex');
}

async function trustedToolHash(file: string, phase: 'script' | 'blender', onTiming?: IdentityInput['onHashTiming']): Promise<string> {
  const absolute = path.resolve(file), before = await fs.promises.stat(absolute, { bigint: true });
  if (!before.isFile()) throw new Error('A trusted model processor must be a regular file.');
  const beforeSignature = signature(before), cached = trustedProcessorHashes.get(absolute), startedAt = process.hrtime.bigint();
  if (cached?.signature === beforeSignature) {
    onTiming?.({ phase, durationMs: elapsedMs(startedAt), bytesHashed: 0, reusedTrustedHash: true, verifiedDuringStaging: false });
    return cached.hash;
  }
  const hash = await shaFile(absolute), after = await fs.promises.stat(absolute, { bigint: true });
  if (signature(after) !== beforeSignature) throw new Error('A trusted model processor changed while its identity was being verified.');
  trustedProcessorHashes.set(absolute, { signature: beforeSignature, hash });
  if (trustedProcessorHashes.size > 256) trustedProcessorHashes.delete(trustedProcessorHashes.keys().next().value!);
  onTiming?.({ phase, durationMs: elapsedMs(startedAt), bytesHashed: Number(before.size), reusedTrustedHash: false, verifiedDuringStaging: false });
  return hash;
}

export async function createModelProcessingIdentity(store: AtelierStore, input: IdentityInput): Promise<ModelProcessingIdentity> {
  const verifiedFiles = new Map((input.verifiedFiles || []).map(entry => [path.resolve(entry.path), entry.hash]));
  const verify = async (file: string, expected: string, phase: Exclude<ModelProcessingHashTiming['phase'], 'script' | 'blender'>) => {
    const startedAt = process.hrtime.bigint();
    if (verifiedFiles.get(path.resolve(file)) === expected) {
      input.onHashTiming?.({ phase, durationMs: elapsedMs(startedAt), bytesHashed: 0, reusedTrustedHash: false, verifiedDuringStaging: true });
      return expected;
    }
    const size = (await fs.promises.stat(file)).size;
    const actual = await shaFile(file);
    input.onHashTiming?.({ phase, durationMs: elapsedMs(startedAt), bytesHashed: size, reusedTrustedHash: false, verifiedDuringStaging: false });
    return actual;
  };
  const artifact = store.get('artifact', input.artifactId);
  if (!artifact || typeof artifact.data.hash !== 'string') throw new Error('The model processing source is not a hashed managed artifact.');
  const actualOwner = ownerForArtifact(store, artifact);
  if (!actualOwner || actualOwner.kind !== input.owner.kind || actualOwner.id !== input.owner.id) throw new Error('The model processing source does not belong to its requested owner.');
  const logicalPath = String(artifact.data.logicalPath || artifact.data.sourceName || artifact.name).replace(/\\/g, '/');
  const sourcePath = store.object(artifact.data.hash);
  if (!sourcePath || await verify(sourcePath, artifact.data.hash, 'source') !== artifact.data.hash) throw new Error('The model processing source failed its current content hash.');

  const dependencies = store.dependencies(artifact.id).map(entry => ({ logicalPath: String(entry.logicalPath).replace(/\\/g, '/'), hash: String(entry.hash) })).sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
  for (const dependency of dependencies) {
    const file = store.object(dependency.hash);
    if (!file || await verify(file, dependency.hash, 'dependency') !== dependency.hash) throw new Error(`A model processing dependency failed its current content hash: ${dependency.logicalPath}`);
  }

  const baselineDependencies: Array<{ logicalPath: string; hash: string }> = [];
  if (input.baselineArtifactId) {
    const baseline = store.get('artifact', input.baselineArtifactId);
    if (!baseline || typeof baseline.data.hash !== 'string') throw new Error('The model compatibility baseline failed its current content hash.');
    if (input.baselineHash && input.baselineHash !== baseline.data.hash) throw new Error('The model compatibility baseline hash changed.');
    const baselineFile = store.object(baseline.data.hash);
    if (!baselineFile || await verify(baselineFile, baseline.data.hash, 'baseline') !== baseline.data.hash) throw new Error('The model compatibility baseline failed its current content hash.');
    for (const dependency of store.dependencies(baseline.id).map(entry => ({ logicalPath: `baseline/${String(entry.logicalPath).replace(/\\/g, '/')}`, hash: String(entry.hash) })).sort((a, b) => a.logicalPath.localeCompare(b.logicalPath))) {
      const file = store.object(dependency.hash);
      if (!file || await verify(file, dependency.hash, 'baseline-dependency') !== dependency.hash) throw new Error(`A model compatibility dependency failed its current content hash: ${dependency.logicalPath}`);
      baselineDependencies.push(dependency);
    }
  } else if (input.baselineHash) throw new Error('A baseline hash requires its managed baseline artifact identity.');

  const scripts = [];
  for (const script of [...new Set(input.scripts.map(value => path.resolve(value)))].sort()) {
    const canonical = await fs.promises.realpath(script);
    if (canonical !== script) throw new Error('A model processing script resolves through an alias.');
    scripts.push({ path: canonical, hash: await trustedToolHash(canonical, 'script', input.onHashTiming) });
  }
  const blenderPath = path.resolve(input.blenderPath), canonicalBlender = await fs.promises.realpath(blenderPath);
  if (canonicalBlender !== blenderPath) throw new Error('The configured Blender executable resolves through an alias.');
  const blenderHash = await trustedToolHash(canonicalBlender, 'blender', input.onHashTiming);
  const workspace = path.resolve(store.root), identityWithoutKey = {
    schemaVersion: 2 as const,
    workspace,
    owner: { kind: input.owner.kind, id: input.owner.id },
    scope: input.scope || '',
    profile: input.profile ? { ...input.profile } : {},
    source: { logicalPath, hash: artifact.data.hash },
    dependencies,
    recipe: { id: input.recipeId, version: input.recipeVersion, baselineHash: input.baselineHash || null, baselineDependencies, scripts },
    blender: { path: canonicalBlender, hash: blenderHash },
  };
  const key = crypto.createHash('sha256').update(stable(identityWithoutKey)).digest('hex');
  return { ...identityWithoutKey, key };
}

/** Re-key an already verified closure for a related recipe without rereading trusted tools or managed assets. */
export function deriveModelProcessingIdentity(identity: ModelProcessingIdentity, recipe: { id: string; version: string; baselineHash?: string | null; baselineDependencies?: ModelProcessingIdentity['recipe']['baselineDependencies'] }): ModelProcessingIdentity {
  const identityWithoutKey = {
    schemaVersion: identity.schemaVersion,
    workspace: identity.workspace,
    owner: identity.owner,
    scope: identity.scope,
    profile: identity.profile,
    source: identity.source,
    dependencies: identity.dependencies,
    recipe: {
      id: recipe.id,
      version: recipe.version,
      baselineHash: recipe.baselineHash ?? null,
      baselineDependencies: recipe.baselineDependencies ?? [],
      scripts: identity.recipe.scripts,
    },
    blender: identity.blender,
  };
  const key = crypto.createHash('sha256').update(stable(identityWithoutKey)).digest('hex');
  return { ...identityWithoutKey, key };
}

/** Share expensive work only inside the exact open store and authorized owner. */
export function coordinateModelProcessing<T>(store: AtelierStore, identity: ModelProcessingIdentity, run: () => Promise<T>): Promise<T> {
  return coordinateModelProcessingRequest(store, identity.owner, `${identity.scope}:${identity.key}`, run);
}

export function modelProcessingRequestKey(store: AtelierStore, owner: { kind: string; id: string }, request: unknown): string {
  return crypto.createHash('sha256').update(stable({ workspace: path.resolve(store.root), owner, request })).digest('hex');
}

/** Request keys only coalesce callers; callers must build and verify a strong identity inside run(). */
export function coordinateModelProcessingRequest<T>(store: AtelierStore, owner: { kind: string; id: string }, requestKey: string, run: () => Promise<T>): Promise<T> {
  let active = inFlight.get(store);
  if (!active) { active = new Map(); inFlight.set(store, active); }
  const key = `${owner.kind}:${owner.id}:${requestKey}`;
  const existing = active.get(key);
  if (existing) return existing as Promise<T>;
  const pending = Promise.resolve().then(run).finally(() => {
    if (active?.get(key) === pending) active.delete(key);
  });
  active.set(key, pending);
  return pending;
}

/** Completed operations are candidates only; callers still validate owner and output bytes. */
export function findCompletedModelProcessing(store: AtelierStore, identity: ModelProcessingIdentity, mode: string) {
  return store.list({ kind: 'operation', limit: 10000 })
    .filter(operation => operation.data.status === 'complete' && operation.data.parameters?.mode === mode && operation.data.modelProcessingIdentity?.key === identity.key && operation.data.modelProcessingIdentity?.owner?.kind === identity.owner.kind && operation.data.modelProcessingIdentity?.owner?.id === identity.owner.id && operation.data.modelProcessingIdentity?.scope === identity.scope)
    .sort((a, b) => String(b.data.finishedAt || b.createdAt).localeCompare(String(a.data.finishedAt || a.createdAt)))[0] || null;
}
