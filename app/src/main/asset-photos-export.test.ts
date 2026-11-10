import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { AtelierStore } from './store';
import { AssetProductionService } from './asset-production';
import { AssetOperationsService } from './asset-operations';
import { AssetPhotosExportService, openVerifiedAssetPhotosExport } from './asset-photos-export';

const roots: string[] = [], stores: AtelierStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) try { store.db.close(); } catch {}
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const base = path.resolve('evidence/assets-photos-export-test'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'photos-')); roots.push(root);
  const store = new AtelierStore(root, path.join(root, 'key')); stores.push(store);
  return { root, store, production: new AssetProductionService(store) };
}

function png(root: string, name: string, color: readonly [number, number, number], depth = false) {
  const value = new PNG({ width: 20, height: 20 });
  for (let y = 0; y < value.height; y++) for (let x = 0; x < value.width; x++) {
    const i = (y * value.width + x) * 4, foreground = x > 1 && x < 18 && y > 1 && y < 18;
    value.data[i] = foreground ? (depth ? 140 : color[0]) : 0;
    value.data[i + 1] = foreground ? (depth ? 140 : color[1]) : 0;
    value.data[i + 2] = foreground ? (depth ? 140 : color[2]) : 0;
    value.data[i + 3] = 255;
  }
  const file = path.join(root, name); fs.writeFileSync(file, PNG.sync.write(value)); return file;
}

async function acceptFile(store: AtelierStore, production: AssetProductionService, jobId: string, revision: number, item: any, role: string, file: string) {
  const artifact = await store.ingest(file, item.id, 'artifact');
  const submitted = production.submit({ id: jobId, expectedRevision: revision, outputs: [{ itemId: item.id, role, artifactId: artifact.id }] }, 'ui');
  const reviewed = production.review({ id: jobId, expectedRevision: submitted.workflow.revision, itemId: item.id, role, candidateId: submitted.candidateIds[0], decision: 'accept' });
  return { revision: reviewed.revision, artifact, candidateId: submitted.candidateIds[0] };
}

function assertFileExport(value: any): asserts value is { operationId: string; directory: string; entries: any[]; waiting: any[]; status: string } {
  if (!value.operationId || !value.directory) throw new Error('Expected a non-empty photo export.');
}

describe('asset photo export', () => {
  it('allocates case-folded Windows-safe names for case and Unicode collisions in both folders', async () => {
    const { root, store, production } = workspace();
    const made = production.create({ name: 'Windows collision export', mode: 'prop-set', target: 'Case-insensitive output names' });
    const names = ['Box', 'box', 'Cafe', 'Ｃａｆｅ'];
    const catalog = production.catalog({ id: made.job.id, expectedRevision: made.workflow.revision, items: [
      ...names.map(name => ({ name, route: 'module', views: ['front'], depthEnabled: true })),
      { name: 'Shared Props', route: 'shared-prop', views: ['front'], depthEnabled: false },
    ] });
    let revision = production.reviewCatalog({ id: made.job.id, expectedRevision: catalog.job.revision, expectedWorkflowRevision: catalog.workflow.revision, decision: 'accept' }).workflow.revision;
    const expected = new Map<string, string>();
    for (const [index, item] of catalog.items.entries()) {
      const color = await acceptFile(store, production, made.job.id, revision, item, 'image:front', png(root, `color-${index}.png`, [40 + index * 30, 100, 160])); revision = color.revision;
      expected.set(`${item.id}:image:front`, color.artifact.data.hash);
      if (index < names.length) {
        const depth = await acceptFile(store, production, made.job.id, revision, item, 'depth:front', png(root, `depth-${index}.png`, [130, 130, 130], true)); revision = depth.revision;
        expected.set(`${item.id}:depth:front`, depth.artifact.data.hash);
      }
    }
    const current = production.get(made.job.id), readiness = (await import('../shared/asset-shared-sheet')).sharedPropSheetReadiness(current.items, current.workflow, current.current), operations = new AssetOperationsService(store, { resourceRoot: path.resolve('.') });
    const sheet = await operations.surface({ id: made.job.id, expectedRevision: revision, mode: 'sheet', items: readiness.items, size: 256 });
    if (!('candidateId' in sheet)) throw new Error('Shared sheet candidate was not created.');
    revision = production.review({ id: made.job.id, expectedRevision: sheet.workflowRevision, itemId: readiness.ownerItemId!, role: 'sheet', candidateId: sheet.candidateId, decision: 'accept' }).revision;

    const copyFlags: number[] = [], originalCopy = fs.copyFileSync.bind(fs);
    vi.spyOn(fs, 'copyFileSync').mockImplementation(((source: fs.PathOrFileDescriptor, destination: fs.PathOrFileDescriptor, flags?: number) => {
      copyFlags.push(flags || 0); return originalCopy(source as string, destination as string, flags);
    }) as any);
    const result = new AssetPhotosExportService(store).export({ id: made.job.id, expectedRevision: revision });
    assertFileExport(result);
    expect(result.status).toBe('ready');
    expect(fs.readdirSync(result.directory).sort()).toEqual(['colored', 'depth-map']);
    expect(copyFlags).toHaveLength(10);
    expect(copyFlags.every(flags => flags === fs.constants.COPYFILE_EXCL)).toBe(true);
    for (const folder of ['colored', 'depth-map']) {
      const entries = result.entries.filter((entry: any) => entry.folder === folder);
      const physicalNames = entries.map((entry: any) => path.basename(entry.path).normalize('NFKC').toLowerCase());
      expect(new Set(physicalNames).size).toBe(physicalNames.length);
    }
    const sharedSheet = result.entries.find((entry: any) => entry.purpose === 'shared-geometry-sheet');
    expect(sharedSheet?.path).toMatch(/^colored\/shared-props-geometry-sheet\.png$/);
    for (const entry of result.entries) {
      expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(result.directory, entry.path!))).digest('hex')).toBe(entry.hash);
      const sourceHash = expected.get(`${entry.itemId}:${entry.role}`);
      if (sourceHash) expect(entry.hash).toBe(sourceHash);
    }
    const modulePhotoNames = result.entries.filter((entry: any) => names.includes(entry.itemName) && entry.folder === 'colored').map((entry: any) => path.basename(entry.path));
    expect(modulePhotoNames).toHaveLength(4);
    expect(modulePhotoNames.some((name: string) => /-[a-f0-9]{8}\.png$/i.test(name))).toBe(true);
    expect(result.entries.find((entry: any) => entry.itemName === 'Shared Props' && entry.role === 'image:front')?.path).toBe('colored/Shared-Props-front.png');
  });

  it('exports current color references, exact per-item depth geometry views and the accepted mixed shared sheet with a verifiable map', async () => {
    const { root, store, production } = workspace();
    const made = production.create({ name: 'Photo handoff', mode: 'prop-set', target: 'A small set of synthetic props' });
    const catalog = production.catalog({ id: made.job.id, expectedRevision: made.workflow.revision, items: [
      { name: '箱/前', route: 'module', views: ['front', 'side'], depthEnabled: true },
      { name: '箱?前', route: 'module', views: ['front'], depthEnabled: false },
      { name: 'Depth prop', route: 'shared-prop', views: ['front'], depthEnabled: true },
      { name: 'Color prop', route: 'shared-prop', views: ['front'], depthEnabled: false },
      { name: 'Missing image', route: 'module', views: ['front'], depthEnabled: false },
    ] });
    let revision = production.reviewCatalog({ id: made.job.id, expectedRevision: catalog.job.revision, expectedWorkflowRevision: catalog.workflow.revision, decision: 'accept' }).workflow.revision;
    const [moduleDepth, moduleColor, sharedDepth, sharedColor] = catalog.items;
    for (const [item, view, color] of [[moduleDepth, 'front', [40, 110, 180]], [moduleDepth, 'side', [60, 120, 190]], [moduleColor, 'front', [160, 80, 40]], [sharedDepth, 'front', [100, 130, 80]], [sharedColor, 'front', [80, 150, 90]]] as const) {
      const role = item.id === moduleColor.id && view === 'front' ? 'image' : `image:${view}`;
      const result = await acceptFile(store, production, made.job.id, revision, item, role, png(root, `${item.id}-${view}.png`, color)); revision = result.revision;
    }
    for (const [item, view, color] of [[moduleDepth, 'front', [40, 110, 180]], [moduleDepth, 'side', [60, 120, 190]], [sharedDepth, 'front', [100, 130, 80]]] as const) {
      const role = item.id === sharedDepth.id && view === 'front' ? 'depth' : `depth:${view}`;
      const result = await acceptFile(store, production, made.job.id, revision, item, role, png(root, `${item.id}-${view}-depth.png`, color, true)); revision = result.revision;
    }
    const current = production.get(made.job.id), readiness = (await import('../shared/asset-shared-sheet')).sharedPropSheetReadiness(current.items, current.workflow, current.current);
    const operations = new AssetOperationsService(store, { resourceRoot: path.resolve('.') });
    const sheet = await operations.surface({ id: made.job.id, expectedRevision: revision, mode: 'sheet', items: readiness.items, size: 256 });
    if (!('candidateId' in sheet)) throw new Error('Shared sheet candidate was not created.');
    revision = production.review({ id: made.job.id, expectedRevision: sheet.workflowRevision, itemId: readiness.ownerItemId!, role: 'sheet', candidateId: sheet.candidateId, decision: 'accept' }).revision;

    const latest = production.get(made.job.id), staleSlot = latest.workflow.data.slots.find((slot: any) => slot.itemId === moduleDepth.id && slot.role === 'image:side');
    const staleWorkflow = { ...latest.workflow.data, slots: latest.workflow.data.slots.map((slot: any) => slot === staleSlot ? { ...slot, candidates: slot.candidates.map((candidate: any) => ({ ...candidate, inputFingerprint: 'd'.repeat(64) })) } : slot) };
    const staleSaved = store.assetProductionPut({ kind: 'workflow', id: latest.workflow.id, name: latest.workflow.name, data: staleWorkflow, expectedRevision: latest.workflow.revision });
    revision = staleSaved.revision;
    const pendingFile = png(root, 'pending.png', [210, 10, 10]), pendingArtifact = await store.ingest(pendingFile, moduleColor.id, 'artifact');
    production.submit({ id: made.job.id, expectedRevision: revision, outputs: [{ itemId: moduleColor.id, role: 'image:front', artifactId: pendingArtifact.id }] }, 'ui');

    const exporter = new AssetPhotosExportService(store), result = exporter.export({ id: made.job.id, expectedRevision: production.get(made.job.id).workflow.revision });
    assertFileExport(result);
    const savedOperation = store.get('operation', result.operationId)!;
    const receipt = JSON.parse(fs.readFileSync(path.join(root, savedOperation.data.report.metadataRelativePath), 'utf8'));
    expect(result.status).toBe('partial');
    expect(fs.readdirSync(result.directory).sort()).toEqual(['colored', 'depth-map']);
    expect(result.waiting).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: catalog.items[4].id, role: 'image:front' }),
      expect.objectContaining({ itemId: moduleDepth.id, role: 'image:side' }),
    ]));
    expect(receipt.entries.some((entry: any) => entry.artifactId === pendingArtifact.id)).toBe(false);
    expect(receipt.entries.some((entry: any) => entry.itemId === moduleDepth.id && entry.role === 'image:side')).toBe(false);
    const depthFiles = receipt.entries.filter((entry: any) => entry.purpose === 'geometry-view' && entry.sourceType === 'depth');
    expect(depthFiles.map((entry: any) => entry.role).sort()).toEqual(['depth:front', 'depth:front']);
    const shared = receipt.entries.filter((entry: any) => entry.purpose === 'shared-geometry-sheet');
    expect(shared).toHaveLength(2);
    expect(new Set(shared.map((entry: any) => entry.path)).size).toBe(1);
    expect(shared[0].path).toMatch(/^depth-map\/shared-props-geometry-sheet\./);
    expect(receipt.sharedMaps).toHaveLength(1);
    expect(receipt.entries.every((entry: any) => !entry.path.includes('64') && !entry.path.match(/[a-f0-9]{32}/))).toBe(true);
    const unicodeNames = fs.readdirSync(path.join(result.directory, 'colored')).filter(name => name.startsWith('箱-前-front'));
    expect(unicodeNames).toHaveLength(2);
    expect(unicodeNames).toContain('箱-前-front.png');
    expect(unicodeNames.some(name => /^箱-前-front-[a-f0-9]{8}\.png$/.test(name))).toBe(true);
    expect(receipt.entries.find((entry: any) => entry.itemId === moduleColor.id && entry.purpose === 'texturing-reference')).toMatchObject({ role: 'image:front', sourceLineage: { acceptedSlotRole: 'image' } });
    expect(receipt.entries.find((entry: any) => entry.itemId === sharedDepth.id && entry.role === 'depth:front' && entry.purpose === 'geometry-view')).toMatchObject({ sourceLineage: { acceptedSlotRole: 'depth' } });
    const sameNameFiles = receipt.entries.filter((entry: any) => entry.itemId === moduleDepth.id || entry.itemId === moduleColor.id);
    const sourcePaths = new Map<string, Set<string>>();
    for (const entry of sameNameFiles) {
      const key = `${entry.itemId}:${entry.role}:${entry.artifactId}:${entry.hash}`;
      sourcePaths.set(key, new Set([...(sourcePaths.get(key) || []), entry.path]));
    }
    expect([...sourcePaths.values()].every(paths => paths.size === 1)).toBe(true);
    expect(new Set([...sourcePaths.keys()].map(key => sourcePaths.get(key)!.values().next().value)).size).toBe(sourcePaths.size);
    for (const entry of receipt.entries) expect(crypto.createHash('sha256').update(fs.readFileSync(path.join(result.directory, entry.path))).digest('hex')).toBe(entry.hash);
    expect(new AssetPhotosExportService(store).read(made.job.id, result.operationId)).toMatchObject({ current: true, status: 'partial' });
    const legacyId = crypto.randomUUID(), legacyRelative = `work/assets/${made.job.id}/exports/photos/${legacyId}`, legacyDirectory = path.join(root, legacyRelative);
    fs.mkdirSync(path.join(legacyDirectory, 'colored'), { recursive: true }); fs.mkdirSync(path.join(legacyDirectory, 'depth-map'));
    const legacyEntries = receipt.entries.map((entry: any) => ({ ...entry }));
    for (const entry of legacyEntries) fs.copyFileSync(path.join(result.directory, entry.path), path.join(legacyDirectory, entry.path));
    const map = receipt.sharedMaps[0], mapPath = 'colored/shared-props-sheet-map.json';
    fs.copyFileSync(store.object(map.mapHash)!, path.join(legacyDirectory, mapPath));
    legacyEntries.push({ itemId: shared[0].itemId, itemName: shared[0].itemName, role: 'sheet-map', purpose: 'shared-sheet-map', folder: 'colored', artifactId: map.artifactId, hash: map.mapHash, sourceType: 'mixed', path: mapPath });
    const legacyReceipt = { ...receipt, schemaVersion: 1, operationId: legacyId, directory: legacyRelative, entries: legacyEntries };
    const legacyReceiptPath = path.join(legacyDirectory, 'photos.json'); fs.writeFileSync(legacyReceiptPath, JSON.stringify(legacyReceipt));
    store.put({ kind: 'operation', id: legacyId, name: 'Legacy photo export', data: { schemaVersion: 1, assetId: shared[0].artifactId, assetJobId: made.job.id, status: 'complete', inputs: [shared[0].hash], parameters: { mode: 'photos-export' }, toolVersions: {}, report: { relativePath: legacyRelative, receiptHash: crypto.createHash('sha256').update(fs.readFileSync(legacyReceiptPath)).digest('hex') } } });
    expect(new AssetPhotosExportService(store).read(made.job.id, legacyId)).toMatchObject({ current: true, status: 'partial' });
    const mockedShell = vi.fn(async (_directory: string) => '');
    expect(await openVerifiedAssetPhotosExport(store, made.job.id, result.operationId, mockedShell)).toMatchObject({ directory: result.directory, status: 'partial' });
    expect(mockedShell).toHaveBeenCalledOnce(); expect(mockedShell).toHaveBeenCalledWith(result.directory);
    await expect(openVerifiedAssetPhotosExport(store, made.job.id, result.operationId, async () => 'Explorer unavailable')).rejects.toThrow('Explorer unavailable');

    store.db.close();
    const reopened = new AtelierStore(root, path.join(root, 'key')); stores.push(reopened);
    expect(new AssetPhotosExportService(reopened).read(made.job.id, result.operationId)).toMatchObject({ current: true, status: 'partial' });
    const reopenedProduction = new AssetProductionService(reopened), reopenedContext = reopenedProduction.get(made.job.id);
    await acceptFile(reopened, reopenedProduction, made.job.id, reopenedContext.workflow.revision, reopenedContext.items.find((item: any) => item.id === moduleColor.id), 'image:front', png(root, 'replacement-color.png', [20, 180, 190]));
    expect(new AssetPhotosExportService(reopened).read(made.job.id, result.operationId)).toMatchObject({ current: false, status: 'outdated' });
    expect(fs.readdirSync(result.directory).sort()).toEqual(['colored', 'depth-map']);
  });

  it('exports current foliage texture views and reports pending, stale and missing views in foliage-only jobs', async () => {
    const { root, store, production } = workspace();
    const made = production.create({ name: 'Foliage photos', mode: 'composite', target: 'One foliage card' });
    const catalog = production.catalog({ id: made.job.id, expectedRevision: made.workflow.revision, items: [{ name: '箱/前', route: 'foliage', views: ['front', 'back', 'side', 'top'], depthEnabled: false }] });
    const item = catalog.items[0];
    let revision = production.reviewCatalog({ id: made.job.id, expectedRevision: catalog.job.revision, expectedWorkflowRevision: catalog.workflow.revision, decision: 'accept' }).workflow.revision;
    const empty = new AssetPhotosExportService(store).export({ id: made.job.id, expectedRevision: revision });
    expect(empty).toMatchObject({ operationId: null, directory: null, status: 'empty', current: true, entries: [] });
    expect(empty.waiting.map((row: any) => row.role)).toEqual(['foliage:front', 'foliage:back', 'foliage:side', 'foliage:top']);
    expect(store.list({ kind: 'operation', limit: 50, offset: 0 }).some((operation: any) => operation.data.assetJobId === made.job.id && operation.data.parameters?.mode === 'photos-export')).toBe(false);
    expect(fs.existsSync(path.join(root, 'work', 'assets', made.job.id, 'exports', 'photos'))).toBe(false);
    const repeatedEmpty = new AssetPhotosExportService(store).export({ id: made.job.id, expectedRevision: revision });
    expect(repeatedEmpty).toMatchObject({ operationId: null, directory: null, status: 'empty', entries: [], waiting: empty.waiting });
    expect(store.list({ kind: 'operation', limit: 50, offset: 0 }).some((operation: any) => operation.data.assetJobId === made.job.id && operation.data.parameters?.mode === 'photos-export')).toBe(false);
    const frontFile = png(root, 'front.png', [30, 90, 130]), front = await acceptFile(store, production, made.job.id, revision, item, 'foliage:front', frontFile); revision = front.revision;
    const stale = await acceptFile(store, production, made.job.id, revision, item, 'foliage:back', png(root, 'back.png', [90, 30, 130])); revision = stale.revision;
    const current = production.get(made.job.id);
    const workflow = { ...current.workflow.data, slots: current.workflow.data.slots.map((value: any) => value.itemId === item.id && value.role === 'foliage:back' ? { ...value, candidates: value.candidates.map((candidate: any) => ({ ...candidate, inputFingerprint: 'e'.repeat(64) })) } : value) };
    revision = store.assetProductionPut({ kind: 'workflow', id: current.workflow.id, name: current.workflow.name, data: workflow, expectedRevision: current.workflow.revision }).revision;
    const side = await store.ingest(png(root, 'side-pending.png', [30, 130, 90]), item.id, 'artifact');
    production.submit({ id: made.job.id, expectedRevision: revision, outputs: [{ itemId: item.id, role: 'foliage:side', artifactId: side.id }] }, 'ui');
    const exported = new AssetPhotosExportService(store).export({ id: made.job.id, expectedRevision: production.get(made.job.id).workflow.revision });
    assertFileExport(exported);
    expect(exported.status).toBe('partial');
    expect(fs.readdirSync(exported.directory).sort()).toEqual(['colored', 'depth-map']);
    expect(exported.entries).toHaveLength(1);
    expect(exported.entries[0]).toMatchObject({ itemId: item.id, role: 'foliage:front', purpose: 'texturing-reference', folder: 'colored', hash: front.artifact.data.hash });
    const exportedFrontPath = exported.entries[0].path!;
    expect(fs.readFileSync(path.join(exported.directory, exportedFrontPath))).toEqual(fs.readFileSync(frontFile));
    expect(exported.waiting).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: item.id, role: 'foliage:back', reason: expect.stringMatching(/stale/i) }),
      expect.objectContaining({ itemId: item.id, role: 'foliage:side', reason: expect.stringMatching(/awaiting/i) }),
      expect.objectContaining({ itemId: item.id, role: 'foliage:top' }),
    ]));
    const operation = store.get('operation', exported.operationId)!;
    const metadataRelativePath = String(operation.data.report.metadataRelativePath); expect(metadataRelativePath).toContain('.aetherflow/photo-exports/');
    const receipt = JSON.parse(fs.readFileSync(path.join(root, metadataRelativePath), 'utf8'));
    const legacyId = crypto.randomUUID(), legacyRelative = `work/assets/${made.job.id}/exports/photos/${legacyId}`, legacyDirectory = path.join(root, legacyRelative);
    fs.mkdirSync(path.join(legacyDirectory, 'colored'), { recursive: true }); fs.mkdirSync(path.join(legacyDirectory, 'depth-map'));
    fs.copyFileSync(path.join(exported.directory, exportedFrontPath), path.join(legacyDirectory, exportedFrontPath));
    const legacyReceipt = { ...receipt, schemaVersion: 1, operationId: legacyId, directory: legacyRelative };
    const legacyReceiptPath = path.join(legacyDirectory, 'photos.json'); fs.writeFileSync(legacyReceiptPath, JSON.stringify(legacyReceipt));
    store.put({ kind: 'operation', id: legacyId, name: 'Legacy photo export', data: { schemaVersion: 1, assetId: front.artifact.id, assetJobId: made.job.id, status: 'complete', inputs: [front.artifact.data.hash], parameters: { mode: 'photos-export' }, toolVersions: {}, report: { relativePath: legacyRelative, receiptHash: crypto.createHash('sha256').update(fs.readFileSync(legacyReceiptPath)).digest('hex') } } });
    expect(new AssetPhotosExportService(store).read(made.job.id, legacyId)).toMatchObject({ current: true, status: 'partial' });
  });

  it('does not leave a partial directory when writing the receipt fails', async () => {
    const { root, store, production } = workspace();
    const made = production.create({ name: 'Rollback export', mode: 'composite', target: 'One synthetic prop' });
    const catalog = production.catalog({ id: made.job.id, expectedRevision: made.workflow.revision, items: [{ name: 'Front', route: 'module', views: ['front'], depthEnabled: false }] });
    const accepted = production.reviewCatalog({ id: made.job.id, expectedRevision: catalog.job.revision, expectedWorkflowRevision: catalog.workflow.revision, decision: 'accept' });
    const image = await acceptFile(store, production, made.job.id, accepted.workflow.revision, catalog.items[0], 'image:front', png(root, 'front.png', [25, 80, 140]));
    const originalWrite = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, ...args: any[]) => {
      if (String(file).endsWith(`${path.sep}photos.json`) || String(file).includes(`${path.sep}photo-exports${path.sep}`)) throw new Error('synthetic receipt failure');
      return (originalWrite as any)(file, ...args);
    }) as any);
    expect(() => new AssetPhotosExportService(store).export({ id: made.job.id, expectedRevision: image.revision })).toThrow(/synthetic receipt failure/);
    const base = path.join(root, 'work', 'assets', made.job.id, 'exports', 'photos');
    expect(fs.existsSync(base) ? fs.readdirSync(base) : []).toEqual([]);
    expect(store.list({ kind: 'operation', limit: 20, offset: 0 }).some((entry: any) => entry.data.parameters?.mode === 'photos-export' && entry.data.status === 'failed')).toBe(true);
  });
});
