import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { runExclusiveBlenderJob } from './blender-adapter';
import { PNG } from 'pngjs';
import { AssetHandoffService } from './asset-handoff';
import { AssetOperationsService } from './asset-operations';
import { AssetProductionService } from './asset-production';
import { AssetSharedReturnService } from './asset-shared-return';
import { AtelierStore } from './store';

const roots: string[] = [], stores: AtelierStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) try { store.db.close(); } catch {}
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function workspace() {
  const base = path.resolve('evidence/assets-handoff-test'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'texturing-')); roots.push(root);
  const store = new AtelierStore(root, path.join(root, 'key')); stores.push(store);
  return { root, store, production: new AssetProductionService(store) };
}

function png(root: string, filename: string, color: readonly [number, number, number]) {
  const image = new PNG({ width: 16, height: 16 });
  for (let index = 0; index < image.width * image.height; index++) {
    const offset = index * 4; image.data[offset] = color[0]; image.data[offset + 1] = color[1]; image.data[offset + 2] = color[2]; image.data[offset + 3] = 255;
  }
  const file = path.join(root, filename); fs.writeFileSync(file, PNG.sync.write(image)); return file;
}

async function acceptImage(store: AtelierStore, production: AssetProductionService, jobId: string, item: any, role: string, file: string) {
  const artifact = await store.ingest(file, item.id, 'artifact'), current = production.get(jobId);
  const submitted = production.submit({ id: jobId, expectedRevision: current.workflow.revision, outputs: [{ itemId: item.id, role, artifactId: artifact.id }] }, 'ui');
  const reviewed = production.review({ id: jobId, expectedRevision: submitted.workflow.revision, itemId: item.id, role, candidateId: submitted.candidateIds[0], decision: 'accept' });
  return { artifact, revision: reviewed.revision };
}

async function acceptGeometry(store: AtelierStore, production: AssetProductionService, jobId: string, item: any, file: string) {
  const artifact = await store.ingest(file, item.id, 'artifact'), current = production.get(jobId), state = current.current.find(value => value.itemId === item.id)!;
  const candidateId = crypto.randomUUID(), sheet = state.sheets?.find((value: any) => value.fresh && value.accepted);
  const candidate = { id: candidateId, artifactId: artifact.id, hash: artifact.data.hash, inputFingerprint: state.geometryInputFingerprint, ...(item.route === 'shared-prop' ? { dependsOnSheetHash: sheet?.hash } : {}), submittedAt: new Date().toISOString(), submittedBy: 'ui' as const, status: 'accepted' as const, reviewedAt: new Date().toISOString(), reviewedBy: 'human' as const, warnings: [] };
  const slots = [...current.workflow.data.slots, { itemId: item.id, role: 'geometry', acceptedCandidateId: candidateId, candidates: [candidate] }];
  const workflow = store.assetProductionPut({ kind: 'workflow', id: current.workflow.id, name: current.workflow.name, data: { ...current.workflow.data, slots, updatedAt: new Date().toISOString() }, expectedRevision: current.workflow.revision });
  return { artifact, revision: workflow.revision };
}

async function createLegacyMultiObjectFbxFixtures(root: string, store: AtelierStore) {
  const blender = path.resolve('tools/blender-5.2.2-windows-x64/blender.exe');
  const work = path.join(root, 'legacy-blender-fixture'); fs.mkdirSync(work, { recursive: false });
  const sourceFile = path.join(work, 'shared-source.fbx'), modelFiles = [path.join(work, 'prop-a.fbx'), path.join(work, 'prop-b.fbx')], script = path.join(work, 'make-fixture.py');
  fs.writeFileSync(script, `import bpy, sys\nfrom mathutils import Euler\nargs=sys.argv[sys.argv.index('--')+1:]\nsource,a,b=args\nparts=[]\nitems=[('A1',(0,0,0),(0.8,0.2,0.1)),('A2',(2.2,0.3,0.2),(0.1,0.3,0.8)),('B1',(5,-0.1,0),(0.2,0.7,0.25)),('B2',(7.3,0.5,-0.2),(0.85,0.6,0.1))]\nfor index,(name,location,color) in enumerate(items):\n bpy.ops.mesh.primitive_cube_add(size=1.0,location=location,rotation=(0.1*index,0.15,0.2*index))\n obj=bpy.context.object;obj.name=name;obj.scale=(1.0+0.1*index,0.7+0.05*index,0.9)\n material=bpy.data.materials.new('Mat_'+name);material.diffuse_color=(*color,1.0);material.use_nodes=True;shader=material.node_tree.nodes.get('Principled BSDF')\n if shader: shader.inputs['Base Color'].default_value=(*color,1.0)\n obj.data.materials.append(material)\n if obj.data.uv_layers:\n  uv=obj.data.uv_layers.active\n  for loopIndex,loop in enumerate(uv.data): loop.uv=(float((loopIndex+index)%3)/2.0,float((loopIndex+1)%2))\n parts.append(obj)\ndef export(file,selected):\n bpy.ops.object.select_all(action='DESELECT')\n for obj in selected: obj.select_set(True)\n bpy.context.view_layer.objects.active=selected[0]\n bpy.ops.export_scene.fbx(filepath=file,use_selection=True,object_types={'MESH'},use_mesh_modifiers=False,add_leaf_bones=False,bake_anim=False,path_mode='COPY',embed_textures=True,axis_forward='-Z',axis_up='Y')\nexport(source,parts);export(a,parts[:2]);export(b,parts[2:])\n`, { flag: 'wx' });
  await runExclusiveBlenderJob(store, blender, ['--background', '--factory-startup', '--disable-autoexec', '--threads', '1', '--python', script, '--', sourceFile, ...modelFiles], { cwd: work, timeoutMs: 120000, maxWorkingSetBytes: 1536 * 1024 * 1024 });
  for (const file of [sourceFile, ...modelFiles]) if (!fs.existsSync(file) || fs.statSync(file).size < 128) throw new Error(`Blender did not create the multipart fixture: ${file}`);
  return { sourceFile, modelFiles };
}

async function createMixedPartitionFixture(root: string, store: AtelierStore, production: AssetProductionService, legacy?: { sourceFile: string; modelFiles: string[] }) {
  const made = production.create({ name: 'Separated shared prop handoff fixture', mode: 'prop-set', target: 'One already textured module and three partitioned shared props.' });
  const catalog = production.catalog({ id: made.job.id, expectedRevision: made.workflow.revision, items: [
    { name: 'Already textured module', route: 'module', views: ['front', 'side'], depthEnabled: false },
    { name: 'Lantern', route: 'shared-prop', views: ['front'], depthEnabled: false },
    { name: 'Crate', route: 'shared-prop', views: ['front'], depthEnabled: false },
    { name: 'Unpartitioned prop', route: 'shared-prop', views: ['front'], depthEnabled: false },
  ] });
  production.reviewCatalog({ id: made.job.id, expectedRevision: catalog.job.revision, expectedWorkflowRevision: catalog.workflow.revision, decision: 'accept' });
  const [module, lantern, crate, unpartitioned] = catalog.items;
  for (const [index, item] of catalog.items.entries()) {
    await acceptImage(store, production, made.job.id, item, 'image:front', png(root, `color-${index}.png`, [40 + index * 35, 100, 170]));
    if (item.id === module.id) await acceptImage(store, production, made.job.id, item, 'image:side', png(root, 'module-side.png', [80, 120, 160]));
  }

  const operations = new AssetOperationsService(store, { resourceRoot: path.resolve('.') });
  const current = production.get(made.job.id), sheet = await operations.surface({ id: made.job.id, expectedRevision: current.workflow.revision, mode: 'sheet', items: [lantern, crate, unpartitioned].map(item => ({ itemId: item.id, role: 'image:front' })), size: 256 });
  if (!('candidateId' in sheet)) throw new Error('A shared sheet candidate was not created.');
  const acceptedSheet = production.review({ id: made.job.id, expectedRevision: sheet.workflowRevision, itemId: sheet.ownerItemId, role: 'sheet', candidateId: sheet.candidateId, decision: 'accept' });
  const shared = new AssetSharedReturnService(store, { resourceRoot: path.resolve('.') }), sheetRecord = shared.sheets(made.job.id).find(value => value.artifactId === sheet.artifactId);
  if (!sheetRecord) throw new Error('The accepted shared sheet did not retain its verified mapping.');

  const sourcePath = legacy?.sourceFile || path.join(root, 'common-segmented.obj');
  if (!legacy) fs.writeFileSync(sourcePath, 'o SharedSource\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
  const source = await store.ingest(sourcePath, made.job.id, 'artifact');
  const partitioned = [lantern, crate], geometryFiles = new Map<string, string>();
  for (const [index, item] of [lantern, crate, unpartitioned].entries()) {
    const geometryPath = path.join(root, `partition-${index}.fbx`);
    if (legacy && index < legacy.modelFiles.length) fs.copyFileSync(legacy.modelFiles[index], geometryPath);
    else fs.writeFileSync(geometryPath, Buffer.from('Kaydara FBX Binary  \0\u001a\0', 'binary'));
    geometryFiles.set(item.id, geometryPath);
  }
  const geometryArtifacts = new Map<string, any>();
  for (const item of [lantern, crate, unpartitioned]) geometryArtifacts.set(item.id, await store.ingest(geometryFiles.get(item.id)!, item.id, 'artifact'));
  const reportPath = path.join(root, 'partition-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ schemaVersion: 1, mode: 'partition', ok: true, sourceHash: source.data.hash, outputs: partitioned.map((item, index) => ({ group: item.id, format: 'fbx', hash: geometryArtifacts.get(item.id).data.hash, meshObjectCount: legacy ? 2 : 1 })) }));
  const report = await store.ingest(reportPath, made.job.id, 'artifact');
  const workflow = production.get(made.job.id).workflow, sharedSource = {
    id: crypto.randomUUID(), artifactId: source.id, hash: source.data.hash, sheetArtifactId: sheetRecord.artifactId, sheetHash: sheetRecord.hash,
    sheetInputFingerprint: sheetRecord.sheetInputFingerprint, members: sheetRecord.members, status: 'accepted' as const,
    submittedAt: new Date().toISOString(), reviewedAt: new Date().toISOString(), reviewedBy: 'human' as const,
  };
  store.assetProductionPut({ kind: 'workflow', id: workflow.id, name: workflow.name, data: { ...workflow.data, sharedSources: [sharedSource], updatedAt: new Date().toISOString() }, expectedRevision: workflow.revision });
  for (const item of catalog.items) {
    const accepted = await acceptGeometry(store, production, made.job.id, item, item.id === module.id ? png(root, 'module-geometry.png', [140, 90, 50]) : geometryFiles.get(item.id)!);
    if (partitioned.some(value => value.id === item.id)) {
      store.addDependency(accepted.artifact.id, source.data.hash, 'source.obj', 'partition-source');
      store.addDependency(accepted.artifact.id, report.data.hash, 'partition-report.json', 'provenance');
    }
  }
  return { jobId: made.job.id, items: catalog.items, module, lantern, crate, unpartitioned };
}

describe('asset texture handoff', () => {
  it('exports only current accepted shared partitions with their original color views and excludes modules from waiting', async () => {
    const { root, store, production } = workspace(), fixture = await createMixedPartitionFixture(root, store, production);
    const service = new AssetHandoffService(store), handoff = await service.prepare({ id: fixture.jobId, expectedRevision: production.get(fixture.jobId).workflow.revision, kind: 'texture' });
    const entries = handoff.entries as any[];
    expect(new Set(entries.map(entry => entry.itemId))).toEqual(new Set([fixture.lantern.id, fixture.crate.id]));
    expect(entries.filter(entry => entry.role === 'geometry').map(entry => entry.itemId)).toEqual([fixture.lantern.id, fixture.crate.id]);
    expect(entries.filter(entry => entry.role === 'image:front').map(entry => entry.itemId)).toEqual([fixture.lantern.id, fixture.crate.id]);
    expect(entries.some(entry => entry.itemId === fixture.module.id)).toBe(false);
    expect(handoff.waiting).toEqual([{ itemId: fixture.unpartitioned.id, name: fixture.unpartitioned.name, reason: 'A current human-accepted partitioned model from the accepted shared sheet is required.' }]);
    for (const entry of entries) {
      expect(entry.path).toContain(entry.itemId.slice(0, 8));
      const exported = path.join(handoff.directory, ...entry.path.split('/'));
      expect(crypto.createHash('sha256').update(fs.readFileSync(exported)).digest('hex')).toBe(entry.hash);
      if (entry.role === 'geometry') {
        expect(entry.partitionLineage).toMatchObject({ sharedSourceId: expect.any(String), sheetArtifactId: expect.any(String), partitionReportHash: expect.any(String), meshObjectCount: 1 });
        expect(entry.textureExport).toMatchObject({ sourceArtifactId: entry.artifactId, sourceHash: entry.hash, outputArtifactId: entry.artifactId, outputHash: entry.hash, sourceMeshObjectCount: 1, meshObjectCount: 1, operationId: null });
      }
    }
    const saved = service.read(fixture.jobId, handoff.operationId);
    expect(saved.receipt.entries).toEqual(entries);
    expect(saved.receipt.scope).toBe('separated-shared-props-v1');
    expect(saved.receipt.waiting.some((row: any) => row.itemId === fixture.module.id)).toBe(false);

    const oldOperationId = crypto.randomUUID(), relativePath = `work/assets/${fixture.jobId}/handoffs/texture/${oldOperationId}`, oldDirectory = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(oldDirectory, { recursive: true });
    const oldReceiptPath = path.join(oldDirectory, 'handoff.json');
    fs.writeFileSync(oldReceiptPath, JSON.stringify({ schemaVersion: 1, jobId: fixture.jobId, operationId: oldOperationId, kind: 'texture', workflowRevision: production.get(fixture.jobId).workflow.revision, entries: [{ itemId: fixture.module.id, itemName: fixture.module.name, role: 'geometry', artifactId: production.get(fixture.jobId).current.find(value => value.itemId === fixture.module.id)!.geometry.artifactId, hash: production.get(fixture.jobId).current.find(value => value.itemId === fixture.module.id)!.geometry.hash, path: 'broad-module/model.fbx', dependencies: [] }], waiting: [] }));
    const receiptHash = crypto.createHash('sha256').update(fs.readFileSync(oldReceiptPath)).digest('hex');
    store.put({ kind: 'operation', id: oldOperationId, name: 'Older broad texture handoff', data: { schemaVersion: 1, assetId: production.get(fixture.jobId).current.find(value => value.itemId === fixture.module.id)!.geometry.artifactId, assetJobId: fixture.jobId, status: 'complete', inputs: [], parameters: { mode: 'handoff', kind: 'texture' }, toolVersions: { application: 'AetherFlow' }, report: { relativePath, receiptHash } } });
    expect(() => service.read(fixture.jobId, oldOperationId)).toThrow(/older texture handoff/);
  });

  it('does not create a texture handoff for a module-only project', async () => {
    const { root, store, production } = workspace(), made = production.create({ name: 'Module-only handoff fixture', mode: 'prop-set', target: 'No shared props.' });
    const catalog = production.catalog({ id: made.job.id, expectedRevision: made.workflow.revision, items: [{ name: 'Wall module', route: 'module', views: ['front'], depthEnabled: false }] });
    production.reviewCatalog({ id: made.job.id, expectedRevision: catalog.job.revision, expectedWorkflowRevision: catalog.workflow.revision, decision: 'accept' });
    const before = store.list({ kind: 'operation', limit: 100, offset: 0 }).length;
    await expect(new AssetHandoffService(store).prepare({ id: made.job.id, expectedRevision: production.get(made.job.id).workflow.revision, kind: 'texture' })).rejects.toThrow(/No items are currently eligible/);
    expect(store.list({ kind: 'operation', limit: 100, offset: 0 })).toHaveLength(before);
  });

  it('normalizes and caches accepted legacy multipart prop models without changing their accepted records', async () => {
    const { root, store, production } = workspace(), blender = path.resolve('tools/blender-5.2.2-windows-x64/blender.exe');
    const fixtures = await createLegacyMultiObjectFbxFixtures(root, store), before = await createMixedPartitionFixture(root, store, production, fixtures);
    const acceptedGeometry = new Map([before.lantern.id, before.crate.id].map(itemId => {
      const candidate = production.get(before.jobId).current.find(value => value.itemId === itemId)!.geometry;
      return [itemId, { artifactId: candidate.artifactId, hash: candidate.hash }];
    }));
    const handoffs = new AssetHandoffService(store, { resourceRoot: path.resolve('.'), blender }), originalOperationCount = store.list({ kind: 'operation', limit: 10000 }).filter(row => row.data.parameters?.mode === 'texture-export').length;
    const handoff = await handoffs.prepare({ id: before.jobId, expectedRevision: production.get(before.jobId).workflow.revision, kind: 'texture' });
    const geometries = (handoff.entries as any[]).filter(entry => entry.role === 'geometry');
    expect(geometries).toHaveLength(2);
    expect(geometries.map(entry => entry.itemId)).toEqual([before.lantern.id, before.crate.id]);
    for (const entry of geometries) {
      const source = acceptedGeometry.get(entry.itemId)!;
      expect(entry).toMatchObject({ sourceArtifactId: source.artifactId, sourceHash: source.hash, partitionLineage: { meshObjectCount: 2 }, textureExport: { sourceArtifactId: source.artifactId, sourceHash: source.hash, sourceMeshObjectCount: 2, meshObjectCount: 1, outputArtifactId: entry.artifactId, outputHash: entry.hash } });
      expect(entry.artifactId).not.toBe(source.artifactId);
      expect(entry.partitionLineage.sharedSourceHash).toBe(crypto.createHash('sha256').update(fs.readFileSync(fixtures.sourceFile)).digest('hex'));
      const output = path.join(handoff.directory, ...entry.path.split('/'));
      expect(crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')).toBe(entry.hash);
    }
    expect(store.list({ kind: 'operation', limit: 10000 }).filter(row => row.data.parameters?.mode === 'texture-export')).toHaveLength(originalOperationCount + 2);
    const saved = handoffs.read(before.jobId, handoff.operationId);
    expect(saved.receipt.entries.filter((entry: any) => entry.role === 'geometry').map((entry: any) => entry.itemId)).toEqual([before.lantern.id, before.crate.id]);
    const cached = await handoffs.prepare({ id: before.jobId, expectedRevision: production.get(before.jobId).workflow.revision, kind: 'texture' });
    expect(cached.entries.filter((entry: any) => entry.role === 'geometry').map((entry: any) => entry.textureExport.operationId)).toEqual(geometries.map(entry => entry.textureExport.operationId));
    expect(store.list({ kind: 'operation', limit: 10000 }).filter(row => row.data.parameters?.mode === 'texture-export')).toHaveLength(originalOperationCount + 2);
    for (const [itemId, source] of acceptedGeometry) expect(production.get(before.jobId).current.find(value => value.itemId === itemId)!.geometry).toMatchObject(source);
    expect(production.get(before.jobId).workflow.data.slots.filter((slot: any) => slot.role === 'geometry' && [before.lantern.id, before.crate.id].includes(slot.itemId)).every((slot: any) => slot.acceptedCandidateId)).toBe(true);
    expect(cached.entries.some((entry: any) => entry.itemId === before.module.id)).toBe(false);
  }, 120000);
});
