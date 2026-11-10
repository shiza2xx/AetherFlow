import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  clonePreparedModel,
  createPreparedModelCacheKey,
  disposePreparedModel,
  estimatePreparedModelBytes,
  PREPARED_MODEL_CACHE_RECIPE_VERSION,
  PreparedModelCache,
  releasePreparedModelImageSources,
  type PreparedModelCacheIdentity,
  type PreparedModel,
} from './prepared-model-cache';

function identity(overrides: Partial<PreparedModelCacheIdentity> = {}): PreparedModelCacheIdentity {
  return {
    workspace: 'D:/workspace/project',
    workspaceInstanceId: 'workspace-instance-a',
    ownerKind: 'character',
    ownerId: 'owner-a',
    artifactId: 'model-a',
    artifactHash: 'a'.repeat(64),
    artifactRevision: 2,
    artifactUpdatedAt: '2026-11-07T00:00:00.000Z',
    artifactName: 'character.glb',
    sourceInputHash: 'b'.repeat(64),
    versionOf: 'source-a',
    parentId: 'parent-a',
    resolvedId: 'model-a',
    resolvedHash: 'a'.repeat(64),
    resolvedName: 'character.glb',
    resolvedSourceInputHash: 'b'.repeat(64),
    resolvedVersionOf: 'source-a',
    resolvedParentId: 'parent-a',
    dependencies: [
      { logicalPath: 'Textures/skin.png', hash: 'c'.repeat(64), role: 'baseColor' },
      { logicalPath: 'Textures/normal.png', hash: 'd'.repeat(64), role: 'normal' },
    ],
    materialGraphRecipes: [],
    loaderRevision: '186',
    texturePolicy: 'full',
    ...overrides,
  };
}

function preparedModel(positionX = 0): PreparedModel {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = 'RootBone';
  scene.add(bone);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    positionX, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat);
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.1 });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'SkinnedBody';
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));

  const track = new THREE.NumberKeyframeTrack('.bones[RootBone].position[y]', [0, 1], [0, 0.2]);
  return { scene, animations: [new THREE.AnimationClip('idle', 1, [track])] };
}

function cache<T>(maxBytes = 1024, maxEntryBytes = 1024, maxEntries = 3) {
  return new PreparedModelCache<T>({ maxBytes, maxEntryBytes, maxEntries });
}

function request<T>(options: {
  key: string;
  namespace?: string;
  value: T;
  bytes?: number;
  signal?: AbortSignal;
  load?: (signal: AbortSignal) => Promise<T>;
  clone?: (value: T) => T;
  dispose?: (value: T) => void;
}) {
  return {
    key: options.key,
    namespace: options.namespace || options.key,
    signal: options.signal,
    load: options.load || (async () => options.value),
    clone: options.clone || ((value: T) => value),
    estimateBytes: () => options.bytes ?? 1,
    dispose: options.dispose || (() => {}),
  };
}

describe('prepared viewer model cache identity', () => {
  it('sorts and normalizes dependency paths while binding the result to owner, workspace, version, recipe and loader policy', () => {
    const base = identity();
    const key = createPreparedModelCacheKey(base);
    expect(createPreparedModelCacheKey(identity({ dependencies: [
      { logicalPath: 'Textures/normal.png', hash: 'd'.repeat(64), role: 'normal' },
      { logicalPath: 'Textures\\skin.png', hash: 'c'.repeat(64), role: 'baseColor' },
    ] }))).toBe(key);

    const changes: Array<Partial<PreparedModelCacheIdentity>> = [
      { workspace: 'D:/workspace/other' },
      { workspaceInstanceId: 'workspace-instance-b' },
      { ownerId: 'owner-b' },
      { ownerKind: 'assetJob' },
      { artifactRevision: 3 },
      { artifactUpdatedAt: '2026-11-07T00:01:00.000Z' },
      { artifactHash: 'e'.repeat(64) },
      { sourceInputHash: 'f'.repeat(64) },
      { resolvedHash: '1'.repeat(64) },
      { resolvedVersionOf: 'source-b' },
      { dependencies: [{ logicalPath: 'Textures/skin.png', hash: '2'.repeat(64), role: 'baseColor' }] },
      { materialGraphRecipes: [{ profileVersion: 3 }] },
      { loaderRevision: '187' },
      { texturePolicy: 'head-fit-budget' },
    ];
    for (const change of changes) expect(createPreparedModelCacheKey(identity(change))).not.toBe(key);
    expect(PREPARED_MODEL_CACHE_RECIPE_VERSION).toBeGreaterThan(0);
  });
});

describe('prepared viewer model cache', () => {
  it('coalesces a pending parse and returns independent skinned/PBR/animation clones on the miss and hit', async () => {
    const store = cache<PreparedModel>();
    store.setWorkspaceScope('scope-a');
    const source = preparedModel();
    let loadCount = 0;
    let disposeCount = 0;
    const options = {
      key: 'asset-a-v1',
      namespace: 'workspace-a/owner-a/asset-a',
      value: source,
      bytes: 128,
      load: async () => { loadCount++; await Promise.resolve(); return source; },
      clone: clonePreparedModel,
      dispose: () => { disposeCount++; },
    };

    const [first, coalesced] = await Promise.all([
      store.load(request(options)),
      store.load(request(options)),
    ]);
    expect(loadCount).toBe(1);
    expect(store.getStats()).toMatchObject({ misses: 1, coalescedRequests: 1, entries: 1, hits: 0 });
    expect(first.scene).not.toBe(coalesced.scene);
    expect(first.scene.getObjectByName('SkinnedBody')).not.toBe(coalesced.scene.getObjectByName('SkinnedBody'));

    const firstMesh = first.scene.getObjectByName('SkinnedBody') as THREE.SkinnedMesh;
    const coalescedMesh = coalesced.scene.getObjectByName('SkinnedBody') as THREE.SkinnedMesh;
    const sourceMesh = source.scene.getObjectByName('SkinnedBody') as THREE.SkinnedMesh;
    expect(firstMesh.geometry).not.toBe(sourceMesh.geometry);
    expect(firstMesh.material).not.toBe(sourceMesh.material);
    expect((firstMesh.material as THREE.MeshStandardMaterial).map).not.toBe((sourceMesh.material as THREE.MeshStandardMaterial).map);
    expect((firstMesh.material as THREE.MeshStandardMaterial).map?.source).toBe((sourceMesh.material as THREE.MeshStandardMaterial).map?.source);
    expect(firstMesh.skeleton.bones[0]).not.toBe(sourceMesh.skeleton.bones[0]);
    expect(first.animations[0]).not.toBe(source.animations[0]);

    firstMesh.geometry.getAttribute('position').setX(0, 99);
    (firstMesh.material as THREE.MeshStandardMaterial).roughness = 0.9;
    expect(sourceMesh.geometry.getAttribute('position').getX(0)).toBe(0);
    expect((sourceMesh.material as THREE.MeshStandardMaterial).roughness).toBe(0.45);
    expect(disposeCount).toBe(0);

    const hit = await store.load(request(options));
    expect(loadCount).toBe(1);
    expect(hit.scene).not.toBe(first.scene);
    expect(store.getStats()).toMatchObject({ hits: 1, entries: 1, bytes: 128 });
    for (const model of [first, coalesced, hit]) disposePreparedModel(model);
  });

  it('keeps the byte and entry limits using least-recently-used eviction and bypasses oversized models', async () => {
    const store = cache<{ id: string }>(10, 8, 2);
    const disposed: string[] = [];
    const load = (key: string, bytes: number) => store.load(request({
      key,
      value: { id: key },
      bytes,
      clone: (value) => ({ ...value }),
      dispose: (value) => disposed.push(value.id),
    }));
    await load('a', 6);
    await load('b', 4);
    await load('a', 6);
    await load('c', 5);
    expect(store.getStats()).toMatchObject({ entries: 1, bytes: 5, evictions: 2 });
    expect(disposed).toContain('b');
    expect(disposed).toContain('a');
    const oversizedResult = await load('huge', 11);
    expect(store.getStats()).toMatchObject({ entries: 1, bytes: 5, oversizedBypasses: 1 });
    expect(oversizedResult).toEqual({ id: 'huge' });
    expect(disposed).not.toContain('huge');
  });

  it('transfers an oversized single result without cloning or disposing it before consumer release', async () => {
    const store = cache<{ id: string }>(10, 8, 2);
    const source = { id: 'oversized-source' };
    const disposed: Array<{ id: string }> = [];
    let cloneCalls = 0;
    const options = request({
      key: 'oversized-single',
      value: source,
      bytes: 9,
      clone: (value) => { cloneCalls++; return { ...value }; },
      dispose: (value) => disposed.push(value),
    });

    const result = await store.load(options);
    expect(result).toBe(source);
    expect(cloneCalls).toBe(0);
    expect(disposed).toEqual([]);
    expect(store.getStats()).toMatchObject({ entries: 0, oversizedBypasses: 1, cloneFailures: 0 });

    options.dispose(result);
    expect(disposed).toEqual([source]);
    store.clear();
    expect(disposed).toEqual([source]);

    const unknownStore = cache<{ id: string }>(10, 8, 2);
    const unknownSource = { id: 'unknown-size-source' };
    let unknownCloneCalls = 0;
    const unknownOptions = {
      ...request({ key: 'unknown-size', value: unknownSource }),
      estimateBytes: () => { throw new Error('size unavailable'); },
      clone: (value: { id: string }) => { unknownCloneCalls++; return { ...value }; },
      dispose: (value: { id: string }) => disposed.push(value),
    };
    expect(await unknownStore.load(unknownOptions)).toBe(unknownSource);
    expect(unknownCloneCalls).toBe(0);
    expect(disposed).toEqual([source]);
    expect(unknownStore.getStats()).toMatchObject({ entries: 0, oversizedBypasses: 1 });
  });

  it('gives an oversized coalesced load to one live waiter and clones for the others', async () => {
    const store = cache<{ id: string }>(10, 8, 2);
    const source = { id: 'oversized-source' };
    const firstAbort = new AbortController();
    let resolveLoad!: (value: { id: string }) => void;
    let cloneCalls = 0;
    const disposed: Array<{ id: string }> = [];
    const options = {
      key: 'oversized-coalesced',
      value: source,
      bytes: 9,
      load: () => new Promise<{ id: string }>((resolve) => { resolveLoad = resolve; }),
      clone: (value: { id: string }) => {
        cloneCalls++;
        if (cloneCalls === 1) throw new Error('secondary clone failed');
        return { ...value };
      },
      dispose: (value: { id: string }) => disposed.push(value),
    };
    const cancelled = store.load(request({ ...options, signal: firstAbort.signal }));
    const cancelledExpectation = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const firstLive = store.load(request(options));
    const cloneFailure = store.load(request(options));
    const secondLive = store.load(request(options));
    const cloneFailureExpectation = expect(cloneFailure).rejects.toThrow('secondary clone failed');
    await Promise.resolve();
    firstAbort.abort();
    await cancelledExpectation;

    resolveLoad(source);
    const [owner, clone] = await Promise.all([firstLive, secondLive]);
    await cloneFailureExpectation;
    expect(owner).toBe(source);
    expect(clone).not.toBe(source);
    expect(clone).not.toBe(owner);
    expect(cloneCalls).toBe(2);
    expect(disposed).toEqual([]);
    expect(store.getStats()).toMatchObject({ entries: 0, oversizedBypasses: 1, cancelledRequests: 1, cloneFailures: 1 });
    store.clear();
    expect(disposed).toEqual([]);
  });

  it('falls back to source ownership when a clone fails during an admitted load or cache hit', async () => {
    const store = cache<{ id: string }>();
    const source = { id: 'prepared-source' };
    const disposed: Array<{ id: string }> = [];
    const admittedFallback = await store.load(request({
      key: 'admitted-clone-failure',
      value: source,
      bytes: 1,
      clone: () => { throw new Error('clone failed'); },
      dispose: (value) => disposed.push(value),
    }));
    expect(admittedFallback).toBe(source);
    expect(store.getStats()).toMatchObject({ entries: 0, cloneFailures: 1 });
    expect(disposed).toEqual([]);

    const cachedSource = { id: 'cached-source' };
    const cachedClone = await store.load(request({
      key: 'cached-clone-failure',
      value: cachedSource,
      bytes: 1,
      clone: (value) => ({ ...value }),
      dispose: (value) => disposed.push(value),
    }));
    expect(cachedClone).not.toBe(cachedSource);
    const hitFallback = await store.load(request({
      key: 'cached-clone-failure',
      value: cachedSource,
      clone: () => { throw new Error('hit clone failed'); },
      dispose: (value) => disposed.push(value),
    }));
    expect(hitFallback).toBe(cachedSource);
    expect(store.getStats()).toMatchObject({ entries: 0, cloneFailures: 2 });
    expect(disposed).toEqual([]);

    store.clear();
    expect(disposed).toEqual([]);
  });

  it('keeps a coalesced clone image live when an oversized source owner closes first', async () => {
    const store = cache<PreparedModel>(1, 1, 1);
    const fixture = fitPreviewModel();
    const options = {
      key: 'fit-preview-oversized',
      value: fixture.model,
      bytes: 2,
      clone: clonePreparedModel,
      dispose: disposePreparedModel,
    };
    const [owner, survivor] = await Promise.all([
      store.load(request(options)),
      store.load(request(options)),
    ]);
    const survivingTexture = getModelTexture(survivor);
    expect(owner).toBe(fixture.model);
    expect(survivingTexture.image).toBe(fixture.image);

    releasePreparedModelImageSources(owner.scene);
    expect(fixture.image.closed).toBe(false);
    expect(survivingTexture.image.closed).toBe(false);
    disposePreparedModel(owner);
    expect(survivingTexture.image.closed).toBe(false);
    disposePreparedModel(survivor);
    expect(fixture.image.closeCount).toBe(1);
  });

  it('keeps a clone-failure fallback image live after context loss and owner disposal', async () => {
    const store = cache<PreparedModel>();
    const fixture = fitPreviewModel();
    let cloneCalls = 0;
    const options = {
      key: 'fit-preview-clone-fallback',
      value: fixture.model,
      bytes: 1,
      clone: (value: PreparedModel) => {
        cloneCalls++;
        if (cloneCalls === 1) throw new Error('simulated clone failure');
        return clonePreparedModel(value);
      },
      dispose: disposePreparedModel,
    };
    const ownerPromise = store.load(request(options));
    const survivorPromise = store.load(request(options));
    const [owner, survivor] = await Promise.all([ownerPromise, survivorPromise]);
    const survivingTexture = getModelTexture(survivor);
    expect(owner).toBe(fixture.model);
    expect(survivingTexture.image).toBe(fixture.image);

    store.clearForContextLoss();
    releasePreparedModelImageSources(owner.scene);
    expect(fixture.image.closed).toBe(false);
    expect(survivingTexture.image.closed).toBe(false);
    expect(survivingTexture.image.width).toBe(2);
    disposePreparedModel(owner);
    expect(survivingTexture.image.closed).toBe(false);
    disposePreparedModel(survivor);
    expect(fixture.image.closeCount).toBe(1);
  });

  it('releases a retained cache image on context loss only after the active clone releases it', async () => {
    const store = cache<PreparedModel>();
    const fixture = fitPreviewModel();
    const active = await store.load(request({
      key: 'fit-preview-context-loss',
      value: fixture.model,
      bytes: 1,
      clone: clonePreparedModel,
      dispose: disposePreparedModel,
    }));
    const activeTexture = getModelTexture(active);
    expect(store.getStats()).toMatchObject({ entries: 1 });

    store.clearForContextLoss();
    expect(store.getStats()).toMatchObject({ entries: 0, contextLossClears: 1 });
    expect(fixture.image.closed).toBe(false);
    expect(activeTexture.image.closed).toBe(false);
    expect(activeTexture.image.width).toBe(2);

    disposePreparedModel(active);
    expect(fixture.image.closeCount).toBe(1);
  });

  it('aborts a shared in-flight load only after the last consumer cancels and disposes a late result', async () => {
    const store = cache<{ id: string }>();
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    const loadSignal: { current: AbortSignal | null } = { current: null };
    let resolveLoad!: (value: { id: string }) => void;
    const disposed: string[] = [];
    const options = {
      key: 'shared',
      namespace: 'same-source',
      value: { id: 'result' },
      signal: firstAbort.signal,
      load: (signal: AbortSignal) => {
        loadSignal.current = signal;
        return new Promise<{ id: string }>((resolve) => { resolveLoad = resolve; });
      },
      clone: (value: { id: string }) => ({ ...value }),
      dispose: (value: { id: string }) => disposed.push(value.id),
    };
    const first = store.load(request(options));
    const second = store.load(request({ ...options, signal: secondAbort.signal }));
    await Promise.resolve();
    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadSignal.current?.aborted).toBe(false);
    secondAbort.abort();
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadSignal.current?.aborted).toBe(true);
    resolveLoad({ id: 'late-result' });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.getStats()).toMatchObject({ pending: 0, entries: 0, cancelledRequests: 2 });
    expect(disposed).toEqual(['late-result']);
  });

  it('invalidates changed file identity and clears entries on workspace or WebGL context changes', async () => {
    const store = cache<{ id: string }>();
    const disposed: string[] = [];
    const add = (key: string, namespace: string, value = key) => store.load(request({
      key,
      namespace,
      value: { id: value },
      clone: (entry) => ({ ...entry }),
      dispose: (entry) => disposed.push(entry.id),
    }));
    store.setWorkspaceScope('workspace-a/instance-a');
    await add('old-revision', 'owner-a/model-a');
    await add('new-revision', 'owner-a/model-a');
    expect(store.getStats()).toMatchObject({ entries: 1, invalidations: 1 });
    expect(disposed).toContain('old-revision');

    store.setWorkspaceScope('workspace-b/instance-b');
    expect(store.getStats()).toMatchObject({ entries: 0, workspaceClears: 1 });
    await add('workspace-b-model', 'owner-b/model-b');
    store.clearForContextLoss();
    expect(store.getStats()).toMatchObject({ entries: 0, contextLossClears: 1 });
    expect(disposed).toContain('workspace-b-model');
  });

  it('does not retain failed loads and tracks measured source-resource size', async () => {
    const store = cache<{ id: string }>();
    await expect(store.load(storeRequestFailure())).rejects.toThrow('parse failed');
    expect(store.getStats()).toMatchObject({ entries: 0, pending: 0, failedLoads: 1 });
    const prepared = preparedModel();
    expect(estimatePreparedModelBytes(prepared)).toBeGreaterThan(128 * 1024);
    disposePreparedModel(prepared);
  });
});

function storeRequestFailure() {
  return request({
    key: 'broken',
    value: { id: 'broken' },
    load: async () => { throw new Error('parse failed'); },
    clone: (value) => ({ ...value }),
    dispose: () => {},
  });
}

type ClosableTestImage = { width: number; height: number; closed: boolean; closeCount: number; close: () => void };

function fitPreviewModel() {
  const image = {
    width: 2,
    height: 2,
    closed: false,
    closeCount: 0,
    close() { this.closeCount++; this.closed = true; },
  };
  const texture = new THREE.Texture(image as any);
  texture.userData = { ...texture.userData, atelierFitPreview: true };
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  const scene = new THREE.Group();
  scene.add(mesh);
  return { model: { scene, animations: [] }, image };
}

function getModelTexture(model: PreparedModel): THREE.Texture & { image: ClosableTestImage } {
  let texture: THREE.Texture | undefined;
  model.scene.traverse((object) => {
    if (texture || !(object as THREE.Mesh).isMesh) return;
    const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial;
    texture = material.map || undefined;
  });
  if (!texture) throw new Error('The model has no test texture.');
  return texture as THREE.Texture & { image: ClosableTestImage };
}
