import * as THREE from 'three';
import { clone as cloneSkinnedHierarchy } from 'three/addons/utils/SkeletonUtils.js';

export const PREPARED_MODEL_CACHE_RECIPE_VERSION = 1;
export const PREPARED_MODEL_CACHE_MAX_BYTES = 160 * 1024 * 1024;
export const PREPARED_MODEL_CACHE_MAX_ENTRY_BYTES = 96 * 1024 * 1024;
export const PREPARED_MODEL_CACHE_MAX_ENTRIES = 3;

export type PreparedModelCacheDependency = {
  logicalPath: string;
  hash?: string | null;
  role?: string | null;
};

export type PreparedModelCacheIdentity = {
  workspace: string;
  workspaceInstanceId: string;
  ownerKind: string;
  ownerId: string;
  artifactId: string;
  artifactHash: string;
  artifactRevision: number;
  artifactUpdatedAt: string;
  artifactName: string;
  sourceInputHash: string;
  versionOf: string;
  parentId: string;
  resolvedId: string;
  resolvedHash: string;
  resolvedName: string;
  resolvedSourceInputHash: string;
  resolvedVersionOf: string;
  resolvedParentId: string;
  dependencies: PreparedModelCacheDependency[];
  materialGraphRecipes: unknown;
  loaderRevision: string;
  texturePolicy: string;
};

export function createPreparedModelCacheScope(workspace: string, workspaceInstanceId: string) {
  return JSON.stringify([workspace, workspaceInstanceId]);
}

export function createPreparedModelCacheNamespace(identity: PreparedModelCacheIdentity) {
  return JSON.stringify([
    identity.workspace,
    identity.workspaceInstanceId,
    identity.ownerKind,
    identity.ownerId,
    identity.artifactId,
  ]);
}

function canonicalLogicalPath(value: string) {
  return value.normalize('NFC').replaceAll('\\', '/');
}

export function createPreparedModelCacheKey(identity: PreparedModelCacheIdentity) {
  const dependencies = identity.dependencies
    .map((dependency) => ({
      path: canonicalLogicalPath(dependency.logicalPath),
      hash: String(dependency.hash || ''),
      role: String(dependency.role || ''),
    }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : left.hash < right.hash ? -1 : left.hash > right.hash ? 1 : left.role < right.role ? -1 : left.role > right.role ? 1 : 0);

  return JSON.stringify([
    PREPARED_MODEL_CACHE_RECIPE_VERSION,
    identity.loaderRevision,
    identity.texturePolicy,
    identity.workspace,
    identity.workspaceInstanceId,
    identity.ownerKind,
    identity.ownerId,
    identity.artifactId,
    identity.artifactHash,
    identity.artifactRevision,
    identity.artifactUpdatedAt,
    identity.artifactName,
    identity.sourceInputHash,
    identity.versionOf,
    identity.parentId,
    identity.resolvedId,
    identity.resolvedHash,
    identity.resolvedName,
    identity.resolvedSourceInputHash,
    identity.resolvedVersionOf,
    identity.resolvedParentId,
    dependencies,
    identity.materialGraphRecipes,
  ]);
}

export type PreparedModelCacheStats = {
  entries: number;
  bytes: number;
  maxBytes: number;
  maxEntryBytes: number;
  maxEntries: number;
  pending: number;
  hits: number;
  misses: number;
  coalescedRequests: number;
  evictions: number;
  oversizedBypasses: number;
  invalidations: number;
  workspaceClears: number;
  contextLossClears: number;
  cancelledRequests: number;
  failedLoads: number;
  cloneFailures: number;
  disposalFailures: number;
  activeScope: string | null;
};

type Waiter<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  settled: boolean;
};

type CacheEntry<T> = {
  key: string;
  namespace: string;
  bytes: number;
  value: T;
  dispose: (value: T) => void;
};

type PendingLoad<T> = {
  key: string;
  namespace: string;
  controller: AbortController;
  waiters: Set<Waiter<T>>;
  load: (signal: AbortSignal) => Promise<T>;
  clone: (value: T) => T;
  estimateBytes: (value: T) => number;
  dispose: (value: T) => void;
  cancelled: boolean;
};

export type PreparedModelCacheRequest<T> = {
  key: string;
  namespace: string;
  signal?: AbortSignal;
  load: (signal: AbortSignal) => Promise<T>;
  clone: (value: T) => T;
  estimateBytes: (value: T) => number;
  dispose: (value: T) => void;
};

export function preparedModelAbortError() {
  const error = new Error('Prepared model loading was cancelled.');
  error.name = 'AbortError';
  return error;
}

export class PreparedModelCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pendingLoads = new Map<string, PendingLoad<T>>();
  private activeScope: string | null = null;
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private coalescedRequests = 0;
  private evictions = 0;
  private oversizedBypasses = 0;
  private invalidations = 0;
  private workspaceClears = 0;
  private contextLossClears = 0;
  private cancelledRequests = 0;
  private failedLoads = 0;
  private cloneFailures = 0;
  private disposalFailures = 0;

  constructor(
    private readonly limits: { maxBytes: number; maxEntryBytes: number; maxEntries: number },
  ) {}

  setWorkspaceScope(scope: string) {
    if (this.activeScope === null) {
      this.activeScope = scope;
      return;
    }
    if (this.activeScope === scope) return;
    this.workspaceClears++;
    this.clearEntries();
    this.cancelPendingLoads();
    this.activeScope = scope;
  }

  // A resolved value always belongs to its caller; retained source ownership
  // stays with the cache only while the entry remains admitted.
  load(request: PreparedModelCacheRequest<T>): Promise<T> {
    if (request.signal?.aborted) return Promise.reject(preparedModelAbortError());
    this.invalidateOtherVersions(request.namespace, request.key);

    const cached = this.entries.get(request.key);
    if (cached) {
      this.hits++;
      this.entries.delete(request.key);
      this.entries.set(request.key, cached);
      try {
        return Promise.resolve(request.clone(cached.value));
      } catch {
        this.cloneFailures++;
        this.removeEntry(request.key, false, false);
        // Once the entry is removed, this caller can own the prepared value
        // directly. Recovering the viewer load this way avoids a second parse.
        return Promise.resolve(cached.value);
      }
    }

    let pending = this.pendingLoads.get(request.key);
    if (!pending) {
      this.misses++;
      pending = {
        key: request.key,
        namespace: request.namespace,
        controller: new AbortController(),
        waiters: new Set(),
        load: request.load,
        clone: request.clone,
        estimateBytes: request.estimateBytes,
        dispose: request.dispose,
        cancelled: false,
      };
      this.pendingLoads.set(request.key, pending);
      void this.startLoad(pending);
    } else {
      this.coalescedRequests++;
    }

    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve, reject, signal: request.signal, settled: false };
      const cancel = () => this.cancelWaiter(pending!, waiter);
      waiter.abortListener = cancel;
      if (request.signal) request.signal.addEventListener('abort', cancel, { once: true });
      pending!.waiters.add(waiter);
      if (request.signal?.aborted) cancel();
    });
  }

  clearForContextLoss() {
    this.contextLossClears++;
    this.clear('context-loss');
  }

  clear(_reason = 'manual') {
    this.clearEntries();
    this.cancelPendingLoads();
  }

  getStats(): PreparedModelCacheStats {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      maxBytes: this.limits.maxBytes,
      maxEntryBytes: this.limits.maxEntryBytes,
      maxEntries: this.limits.maxEntries,
      pending: this.pendingLoads.size,
      hits: this.hits,
      misses: this.misses,
      coalescedRequests: this.coalescedRequests,
      evictions: this.evictions,
      oversizedBypasses: this.oversizedBypasses,
      invalidations: this.invalidations,
      workspaceClears: this.workspaceClears,
      contextLossClears: this.contextLossClears,
      cancelledRequests: this.cancelledRequests,
      failedLoads: this.failedLoads,
      cloneFailures: this.cloneFailures,
      disposalFailures: this.disposalFailures,
      activeScope: this.activeScope,
    };
  }

  private async startLoad(pending: PendingLoad<T>) {
    let value: T;
    try {
      value = await pending.load(pending.controller.signal);
    } catch (error) {
      if (this.pendingLoads.get(pending.key) === pending) this.pendingLoads.delete(pending.key);
      if (!pending.cancelled) this.failedLoads++;
      for (const waiter of pending.waiters) this.rejectWaiter(pending, waiter, asError(error));
      pending.waiters.clear();
      return;
    }

    const stillCurrent = this.pendingLoads.get(pending.key) === pending && !pending.cancelled;
    if (!stillCurrent || pending.waiters.size === 0) {
      this.dispose(value, pending.dispose);
      return;
    }
    this.pendingLoads.delete(pending.key);

    let bytes = Number.POSITIVE_INFINITY;
    try {
      const estimate = pending.estimateBytes(value);
      if (Number.isSafeInteger(estimate) && estimate >= 0) bytes = estimate;
    } catch {
      // Estimation must not make a valid preview fail; an unknown size bypasses admission.
    }

    const admitted = this.admit(pending, value, bytes);
    const waiters = [...pending.waiters].filter((waiter) => !waiter.settled);
    if (waiters.length === 0) {
      if (admitted) this.removeEntry(pending.key, false);
      else this.dispose(value, pending.dispose);
      return;
    }

    if (!admitted) {
      // An oversized or unknown-size model must not incur another full model
      // allocation just to avoid retaining it. Transfer the loaded value to
      // exactly one live waiter; coalesced waiters still receive isolated clones.
      const [owner, ...coalesced] = waiters;
      this.resolveWaiter(pending, owner, value);
      for (const waiter of coalesced) {
        if (waiter.settled) continue;
        try {
          const clone = pending.clone(value);
          if (waiter.settled) this.dispose(clone, pending.dispose);
          else this.resolveWaiter(pending, waiter, clone);
        } catch (error) {
          this.cloneFailures++;
          this.rejectWaiter(pending, waiter, asError(error));
        }
      }
      pending.waiters.clear();
      return;
    }

    const cloneFailures: Array<{ waiter: Waiter<T>; error: Error }> = [];
    for (const waiter of waiters) {
      if (waiter.settled) continue;
      try {
        const clone = pending.clone(value);
        if (waiter.settled) this.dispose(clone, pending.dispose);
        else this.resolveWaiter(pending, waiter, clone);
      } catch (error) {
        this.cloneFailures++;
        if (!waiter.settled) cloneFailures.push({ waiter, error: asError(error) });
      }
    }

    const liveCloneFailures = cloneFailures.filter(({ waiter }) => !waiter.settled);
    if (liveCloneFailures.length > 0) {
      // Clones already returned to other waiters remain theirs. The original
      // cache value is removed and transferred to the first live waiter whose
      // clone failed; additional failures stay isolated and receive an error.
      this.removeEntry(pending.key, false, false);
      const [fallback, ...failures] = liveCloneFailures;
      this.resolveWaiter(pending, fallback.waiter, value);
      for (const item of failures) this.rejectWaiter(pending, item.waiter, item.error);
    }
    pending.waiters.clear();
  }

  private admit(pending: PendingLoad<T>, value: T, bytes: number) {
    if (!Number.isFinite(bytes) || bytes > this.limits.maxEntryBytes || bytes > this.limits.maxBytes || this.limits.maxBytes <= 0 || this.limits.maxEntryBytes <= 0 || this.limits.maxEntries <= 0) {
      this.oversizedBypasses++;
      return false;
    }
    while (this.entries.size >= this.limits.maxEntries || this.bytes + bytes > this.limits.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) return false;
      this.removeEntry(oldestKey, true);
    }
    this.entries.set(pending.key, { key: pending.key, namespace: pending.namespace, bytes, value, dispose: pending.dispose });
    this.bytes += bytes;
    return true;
  }

  private invalidateOtherVersions(namespace: string, key: string) {
    for (const [entryKey, entry] of this.entries) {
      if (entry.namespace === namespace && entryKey !== key) {
        this.invalidations++;
        this.removeEntry(entryKey, true);
      }
    }
    for (const pending of [...this.pendingLoads.values()]) {
      if (pending.namespace === namespace && pending.key !== key) {
        this.invalidations++;
        this.cancelPending(pending);
      }
    }
  }

  private cancelWaiter(pending: PendingLoad<T>, waiter: Waiter<T>) {
    if (waiter.settled) return;
    this.cancelledRequests++;
    this.rejectWaiter(pending, waiter, preparedModelAbortError());
    pending.waiters.delete(waiter);
    if (pending.waiters.size === 0) this.cancelPending(pending);
  }

  private cancelPending(pending: PendingLoad<T>) {
    if (pending.cancelled) return;
    pending.cancelled = true;
    if (this.pendingLoads.get(pending.key) === pending) this.pendingLoads.delete(pending.key);
    for (const waiter of [...pending.waiters]) this.rejectWaiter(pending, waiter, preparedModelAbortError());
    pending.waiters.clear();
    try {
      pending.controller.abort();
    } catch {
      // Abort is advisory; startLoad still disposes a late result if a loader ignores it.
    }
  }

  private resolveWaiter(pending: PendingLoad<T>, waiter: Waiter<T>, value: T) {
    if (waiter.settled) return;
    waiter.settled = true;
    waiter.signal?.removeEventListener('abort', waiter.abortListener!);
    pending.waiters.delete(waiter);
    waiter.resolve(value);
  }

  private rejectWaiter(pending: PendingLoad<T>, waiter: Waiter<T>, error: Error) {
    if (waiter.settled) return;
    waiter.settled = true;
    waiter.signal?.removeEventListener('abort', waiter.abortListener!);
    pending.waiters.delete(waiter);
    waiter.reject(error);
  }

  private removeEntry(key: string, countEviction: boolean, disposeResource = true) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
    if (countEviction) this.evictions++;
    if (disposeResource) this.dispose(entry.value, entry.dispose);
  }

  private clearEntries() {
    for (const key of [...this.entries.keys()]) this.removeEntry(key, false);
  }

  private cancelPendingLoads() {
    for (const pending of [...this.pendingLoads.values()]) this.cancelPending(pending);
  }

  private dispose(value: T, callback: (value: T) => void) {
    try {
      // A dispose callback can be reached after cancellation, eviction or context loss.
      // Resource cleanup should remain idempotent even if an upstream loader already failed.
      callback(value);
    } catch {
      this.disposalFailures++;
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export type PreparedModel = {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
};

type PreparedImageReferences = { count: number; closeWhenUnused: boolean };

const preparedImageSourceByTexture = new WeakMap<THREE.Texture, object>();
const preparedImageReferences = new WeakMap<object, PreparedImageReferences>();

function textureImageSource(texture: THREE.Texture) {
  const image = texture.source?.data ?? texture.image;
  return image && (typeof image === 'object' || typeof image === 'function') ? image as object : null;
}

function closePreparedImage(image: object) {
  try {
    (image as { close?: () => void }).close?.();
  } catch {
    // ImageBitmap close can fail after the browser has already released it.
  }
}

function retainPreparedTextureImage(texture: THREE.Texture, image: object, closeWhenUnused: boolean) {
  const currentImage = preparedImageSourceByTexture.get(texture);
  if (currentImage === image) {
    const currentReferences = preparedImageReferences.get(image);
    if (currentReferences) currentReferences.closeWhenUnused ||= closeWhenUnused;
    texture.userData = { ...texture.userData, atelierPreparedSharedImageSource: true };
    return;
  }
  if (currentImage) releasePreparedTextureImage(texture);
  let references = preparedImageReferences.get(image);
  if (!references) {
    references = { count: 0, closeWhenUnused: false };
    preparedImageReferences.set(image, references);
  }
  references.count++;
  references.closeWhenUnused ||= closeWhenUnused;
  preparedImageSourceByTexture.set(texture, image);
  texture.userData = { ...texture.userData, atelierPreparedSharedImageSource: true };
}

function releasePreparedTextureImage(texture: THREE.Texture) {
  const image = preparedImageSourceByTexture.get(texture);
  if (!image) return false;
  preparedImageSourceByTexture.delete(texture);
  const references = preparedImageReferences.get(image);
  if (!references) return true;
  references.count--;
  if (references.count <= 0) {
    preparedImageReferences.delete(image);
    if (references.closeWhenUnused) closePreparedImage(image);
  }
  return true;
}

function retainPreparedTextureImagePair(source: THREE.Texture, clone: THREE.Texture) {
  const image = textureImageSource(source);
  if (!image || textureImageSource(clone) !== image) return;
  const closeWhenUnused = !!(source.userData?.atelierFitPreview || clone.userData?.atelierFitPreview)
    && typeof (image as { close?: unknown }).close === 'function';
  retainPreparedTextureImage(source, image, closeWhenUnused);
  retainPreparedTextureImage(clone, image, closeWhenUnused);
}

export function releasePreparedModelImageSources(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const materials = [mesh.material, object.userData?.atelierSourceMaterials].flat(2);
    for (const material of materials) {
      if (!material) continue;
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
    for (const texture of (object.userData?.atelierPreparedModelOwnedTextures || []) as THREE.Texture[]) textures.add(texture);
  });

  const unsharedFitImages = new Set<object>();
  for (const texture of textures) {
    if (preparedImageSourceByTexture.has(texture)) continue;
    const image = textureImageSource(texture);
    if (image && texture.userData?.atelierFitPreview && !texture.userData?.atelierPreparedSharedImageSource && !preparedImageReferences.has(image)) unsharedFitImages.add(image);
  }
  for (const texture of textures) releasePreparedTextureImage(texture);
  for (const image of unsharedFitImages) closePreparedImage(image);
}

function cloneMaterialAndTextures(material: THREE.Material, textureClones: Map<THREE.Texture, THREE.Texture>) {
  const clone = material.clone();
  for (const [key, value] of Object.entries(material as unknown as Record<string, unknown>)) {
    if (value instanceof THREE.Texture) {
      let texture = textureClones.get(value);
      if (!texture) {
        texture = value.clone();
        textureClones.set(value, texture);
      }
      (clone as unknown as Record<string, unknown>)[key] = texture;
    }
  }
  return clone;
}

export function clonePreparedModel(prepared: PreparedModel): PreparedModel {
  const scene = cloneSkinnedHierarchy(prepared.scene);
  const geometryClones = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materialClones = new Map<THREE.Material, THREE.Material>();
  const textureClones = new Map<THREE.Texture, THREE.Texture>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) {
      let geometry = geometryClones.get(mesh.geometry);
      if (!geometry) {
        geometry = mesh.geometry.clone();
        geometryClones.set(mesh.geometry, geometry);
      }
      mesh.geometry = geometry;
    }
    if (mesh.material) {
      const cloneMaterial = (material: THREE.Material) => {
        let clone = materialClones.get(material);
        if (!clone) {
          clone = cloneMaterialAndTextures(material, textureClones);
          materialClones.set(material, clone);
        }
        return clone;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(cloneMaterial)
        : cloneMaterial(mesh.material);
    }
  });
  const animations = prepared.animations.map((clip) => clip.clone());
  for (const [source, clone] of textureClones) retainPreparedTextureImagePair(source, clone);
  scene.userData.atelierPreparedModelOwnedTextures = [...textureClones.values()];
  return { scene, animations };
}

export function estimatePreparedModelBytes(prepared: PreparedModel) {
  const geometries = new Set<THREE.BufferGeometry>();
  const textureSources = new Set<object>();
  const textures = new Set<THREE.Texture>();
  let bytes = 128 * 1024;
  prepared.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && !geometries.has(mesh.geometry)) {
      geometries.add(mesh.geometry);
      const geometry = mesh.geometry;
      const attributes = [...Object.values(geometry.attributes), ...Object.values(geometry.morphAttributes).flat()];
      if (geometry.index) attributes.push(geometry.index);
      for (const attribute of attributes) {
        const array = (attribute as THREE.BufferAttribute | THREE.InterleavedBufferAttribute).array as ArrayBufferView;
        bytes += array.byteLength;
      }
    }
    const materials = mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (!(value instanceof THREE.Texture) || textures.has(value)) continue;
        textures.add(value);
        const textureSource = value.source || value;
        if (textureSources.has(textureSource)) continue;
        textureSources.add(textureSource);
        const image = value.image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number } | undefined;
        const width = Math.max(0, Number(image?.width || image?.naturalWidth || 0));
        const height = Math.max(0, Number(image?.height || image?.naturalHeight || 0));
        bytes += width * height * 4;
        if (value.generateMipmaps) bytes += Math.ceil(width * height * 4 / 3);
      }
    }
  });
  for (const clip of prepared.animations) {
    for (const track of clip.tracks) {
      bytes += track.times.byteLength + track.values.byteLength;
    }
  }
  return Math.ceil(bytes);
}

export function disposePreparedModel(prepared: PreparedModel) {
  releasePreparedModelImageSources(prepared.scene);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  prepared.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []) {
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export const preparedModelCache = new PreparedModelCache<PreparedModel>({
  maxBytes: PREPARED_MODEL_CACHE_MAX_BYTES,
  maxEntryBytes: PREPARED_MODEL_CACHE_MAX_ENTRY_BYTES,
  maxEntries: PREPARED_MODEL_CACHE_MAX_ENTRIES,
});
