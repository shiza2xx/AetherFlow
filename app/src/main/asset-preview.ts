import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AtelierStore } from './store';
import { AssetOperationsService } from './asset-operations';
import { assetAssemblyWorkingSetBudget, runExclusiveBlenderJob } from './blender-adapter';
import { currentAssemblyPreviewLinks, currentAssemblyPreviewSources, verifyAssetViewer } from './asset-ui-context';
import { AssetProductionService } from './asset-production';
import { workspaceLayout, ownerForArtifact } from './workspace-layout';
import { coordinateModelProcessingRequest, createModelProcessingIdentity, findCompletedModelProcessing, modelProcessingRequestKey } from './model-processing-cache';
import { verifyAssetHashesOffThread, type AssetHashCheck } from './asset-hash-validation';

const scriptsFor = (resourceRoot: string) => {
  const dir = path.resolve(resourceRoot, 'docs/skills/aetherflow-asset-pipeline/scripts');
  return { dir, main: path.join(dir, 'asset_preview.py'), surface: path.join(dir, 'asset_surface.py'), support: path.join(dir, 'asset_preview_support.py'), importer: path.join(dir, 'asset_safe_import.py'), mesh: path.join(dir, 'asset_mesh_helpers.py') };
};

function safeReportFile(file: string) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync.native(file) !== path.resolve(file) || stat.size > 1024 * 1024) throw new Error('Preview report is missing, oversized, or unsafe.');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as any)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function managedHashCheck(store: AtelierStore, hash: string, label: string): AssetHashCheck {
  const file = store.object(hash);
  if (!file) throw new Error(`${label} is missing from managed storage.`);
  return { file, expectedHash: hash, label };
}

async function readVerifiedJson(file: string, maxBytes: number) {
  const absolute = path.resolve(file), before = await fs.promises.lstat(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes || await fs.promises.realpath(absolute) !== absolute) throw new Error('Assembly preview report is missing, oversized, or unsafe.');
  const bytes = await fs.promises.readFile(absolute), after = await fs.promises.lstat(absolute);
  if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || await fs.promises.realpath(absolute) !== absolute) throw new Error('Assembly preview report changed while it was being read.');
  return { value: JSON.parse(bytes.toString('utf8')), hash: crypto.createHash('sha256').update(bytes).digest('hex') };
}

async function verifyAssemblyPreview(store: AtelierStore, input: { assetJobId: string; assetItemId?: string; artifactId: string }, link: ReturnType<typeof currentAssemblyPreviewLinks>[number]) {
  const { source, viewer, operation, candidate, validation } = link;
  const context = new AssetProductionService(store).get(input.assetJobId), owner = { kind: 'assetJob' as const, id: input.assetJobId, name: context.job.name }, layout = workspaceLayout(store.root), run = layout.run(owner, operation.id), outputs = path.join(run, 'outputs');
  const runStat = await fs.promises.lstat(run), outputStat = await fs.promises.lstat(outputs);
  if (!runStat.isDirectory() || runStat.isSymbolicLink() || await fs.promises.realpath(run) !== run || !outputStat.isDirectory() || outputStat.isSymbolicLink() || await fs.promises.realpath(outputs) !== outputs) throw new Error('Assembly preview operation folder is missing or unsafe.');
  const reportPath = path.join(run, 'report.json'), requestPath = path.join(run, 'request.json'), [{ value: report, hash: reportHash }, { value: request }] = await Promise.all([readVerifiedJson(reportPath, 1024 * 1024), readVerifiedJson(requestPath, 8 * 1024 * 1024)]);
  const databaseReport = operation.data.report, usedMasters = new Set(validation.instances.map((instance: any) => instance.masterItemId)), expectedSources = validation.masters.filter((master: any) => usedMasters.has(master.itemId)).map((master: any) => [master.itemId, master.hash]).sort(([a]: any, [b]: any) => String(a).localeCompare(String(b))), fileChecks: AssetHashCheck[] = [];
  if (!expectedSources.length || expectedSources.some(([, hash]: any) => typeof hash !== 'string') || expectedSources.length !== usedMasters.size) throw new Error('Current assembly masters are incomplete.');
  const expectedSourceHashes = Object.fromEntries(expectedSources), reportedSourceHashes = report.sourceHashes && typeof report.sourceHashes === 'object' && !Array.isArray(report.sourceHashes) ? Object.fromEntries(Object.entries(report.sourceHashes).sort(([a], [b]) => a.localeCompare(b))) : null;
  for (const master of validation.masters.filter((value: any) => usedMasters.has(value.itemId))) {
    if (!master.artifactId || !master.hash) throw new Error('Current assembly master is incomplete.');
    const artifact = store.get('artifact', master.artifactId), managedFile = store.object(master.hash);
    if (!artifact || artifact.data.hash !== master.hash || !managedFile) throw new Error('Current accepted master file is missing or has a different hash.');
    fileChecks.push({ file: managedFile, expectedHash: master.hash, label: `${master.name}: accepted model` });
    for (const dependency of store.dependencies(master.artifactId)) {
      const file = store.object(dependency.hash);
      if (!file) throw new Error(`Accepted master dependency ${dependency.logicalPath} is missing.`);
      fileChecks.push({ file, expectedHash: dependency.hash, label: `${master.name}: ${dependency.logicalPath}` });
    }
  }
  const requestSources = Array.isArray(request.sources) ? request.sources.map((row: any) => [String(row.itemId || ''), String(row.hash || '')]).sort(([a]: any, [b]: any) => String(a).localeCompare(String(b))) : [];
  const expectedInstances = [...validation.instances].sort((a: any, b: any) => a.id.localeCompare(b.id));
  if (report.schemaVersion !== 1 || report.mode !== 'assemble' || report.ok !== true || report.autoexec !== 'disabled' || report.instanceCount !== expectedInstances.length || report.sharedGeometry !== true || stableJson(reportedSourceHashes) !== stableJson(expectedSourceHashes)) throw new Error('Assembly Blender report does not match the current masters and instances.');
  if (request.mode !== 'assemble' || path.resolve(String(request.report || '')) !== reportPath || path.resolve(String(request.outputDirectory || '')) !== outputs || stableJson(requestSources) !== stableJson(expectedSources) || stableJson(request.instances) !== stableJson(expectedInstances)) throw new Error('Assembly request does not match the current placement plan.');
  if (!Array.isArray(request.sources) || request.sources.length !== expectedSources.length || new Set(request.sources.map((row: any) => String(row.itemId || ''))).size !== expectedSources.length) throw new Error('Assembly request source list is incomplete or duplicated.');
  const expectedByItem = new Map(expectedSources.map(([itemId, hash]: any) => [String(itemId), String(hash)]));
  for (const [index, row] of request.sources.entries()) {
    const itemId = String(row.itemId || ''), hash = expectedByItem.get(itemId), master = validation.masters.find((value: any) => value.itemId === itemId), inputRoot = path.join(run, `input-${index}`), sourcePath = path.resolve(String(row.path || '')), manifest = row.manifest, artifact = master?.artifactId ? store.get('artifact', master.artifactId) : null;
    const sourceName = String(artifact?.data.logicalPath || artifact?.data.sourceName || artifact?.name || ''), expectedPrimaryName = `master-${String(index).padStart(3, '0')}${path.extname(sourceName).toLowerCase()}`;
    if (!hash || hash !== String(row.hash || '') || !master?.artifactId || !artifact || path.dirname(sourcePath) !== inputRoot || path.basename(sourcePath) !== expectedPrimaryName || !manifest || path.resolve(String(manifest.inputRoot || '')) !== inputRoot || manifest.sourceHash !== hash) throw new Error('Assembly request source does not match its staged accepted master.');
    const expectedDependencies = store.dependencies(master.artifactId).map((dependency: any) => ({ logicalPath: String(dependency.logicalPath).replace(/\\/g, '/'), hash: String(dependency.hash), role: String(dependency.role) })).sort((a: any, b: any) => a.logicalPath.localeCompare(b.logicalPath));
    if (!artifact || artifact.data.hash !== hash || !Array.isArray(manifest.dependencies)) throw new Error('Assembly request master or dependency record is missing.');
    const stagedDependencies = manifest.dependencies.map((dependency: any) => ({ logicalPath: String(dependency.logicalPath || '').replace(/\\/g, '/'), hash: String(dependency.hash || ''), role: String(dependency.role || ''), stagedPath: String(dependency.stagedPath || '') })).sort((a: any, b: any) => a.logicalPath.localeCompare(b.logicalPath));
    if (stableJson(stagedDependencies.map(({ logicalPath, hash, role }: any) => ({ logicalPath, hash, role }))) !== stableJson(expectedDependencies)) throw new Error('Assembly request dependencies do not match the accepted masters.');
    const inputStat = await fs.promises.lstat(inputRoot);
    if (!inputStat.isDirectory() || inputStat.isSymbolicLink() || await fs.promises.realpath(inputRoot) !== inputRoot) throw new Error('A staged assembly master is missing, unsafe, or changed.');
    fileChecks.push({ file: sourcePath, expectedHash: hash, label: `${master.name}: staged assembly master` });
    for (const dependency of stagedDependencies) {
      const relative = dependency.stagedPath.replace(/\\/g, '/');
      if (!relative || relative.startsWith('/') || relative.includes(':') || relative.split('/').some((part: string) => !part || part === '.' || part === '..')) throw new Error('Assembly dependency staging path is unsafe.');
      const stagedPath = path.resolve(inputRoot, ...relative.split('/'));
      if (!stagedPath.startsWith(inputRoot + path.sep)) throw new Error('A staged assembly dependency is missing, unsafe, or changed.');
      fileChecks.push({ file: stagedPath, expectedHash: dependency.hash, label: `${master.name}: staged ${dependency.logicalPath}` });
    }
  }
  if (databaseReport.reportSHA256 !== undefined && databaseReport.reportSHA256 !== reportHash || databaseReport.reportSchemaVersion !== undefined && databaseReport.reportSchemaVersion !== report.schemaVersion || databaseReport.sourceHashes !== undefined && stableJson(databaseReport.sourceHashes) !== stableJson(expectedSourceHashes)) throw new Error('Stored assembly report fingerprint does not match the operation report.');
  const outputRows = Array.isArray(report.outputs) ? report.outputs : [], byFormat = new Map<string, any>();
  for (const row of outputRows) {
    if (!row || !['blend', 'glb'].includes(row.format) || byFormat.has(row.format) || typeof row.path !== 'string' || !/^[a-f0-9]{64}$/.test(String(row.hash || ''))) throw new Error('Assembly report has invalid or duplicate output rows.');
    const target = path.resolve(row.path), expectedName = row.format === 'blend' ? 'scene.blend' : 'scene.glb';
    if (path.dirname(target) !== outputs || path.basename(target) !== expectedName) throw new Error('Assembly preview output escaped its operation folder.');
    byFormat.set(row.format, { ...row, path: target });
  }
  if (byFormat.size !== 2) throw new Error('Assembly report must contain both the scene and its GLB preview.');
  const blend = byFormat.get('blend'), glb = byFormat.get('glb');
  if (blend.hash !== source.data.hash || glb.hash !== viewer.data.hash || databaseReport.sceneHash !== undefined && databaseReport.sceneHash !== blend.hash || databaseReport.previewHash !== undefined && databaseReport.previewHash !== glb.hash) throw new Error('Assembly preview output hashes do not match their managed artifacts.');
  const managedBlend = store.object(source.data.hash), managedGlb = store.object(viewer.data.hash);
  if (!managedBlend || !managedGlb) throw new Error('Assembly scene or GLB managed output is missing.');
  fileChecks.push({ file: managedBlend, expectedHash: source.data.hash, label: 'Managed assembly scene' }, { file: managedGlb, expectedHash: viewer.data.hash, label: 'Managed full quality GLB' }, { file: blend.path, expectedHash: blend.hash, label: 'Assembly scene output' }, { file: glb.path, expectedHash: glb.hash, label: 'Full quality GLB output' });
  await verifyAssetHashesOffThread(fileChecks);
  return { artifactId: source.id, sourceHash: source.data.hash, status: 'complete' as const, operationId: operation.id, assemblyReportHash: reportHash, fullPreviewArtifactId: viewer.id, fullPreviewHash: viewer.data.hash, previewArtifactId: viewer.id, previewHash: viewer.data.hash, materialAudit: null, error: null };
}

type AssemblyPreviewLink = ReturnType<typeof currentAssemblyPreviewLinks>[number];
type VerifiedAssemblyPreview = Awaited<ReturnType<typeof verifyAssemblyPreview>>;
type AssemblyProxyContext = { link: AssemblyPreviewLink; verified: VerifiedAssemblyPreview };

function assemblyPreviewProxyProof({ link, verified }: AssemblyProxyContext) {
  return { schemaVersion: 1, sceneArtifactId: link.source.id, sceneHash: link.source.data.hash, sceneCandidateId: link.candidate.id, dependencyFingerprint: link.candidate.dependencyFingerprint, assembleOperationId: link.operation.id, assembleReportSHA256: verified.assemblyReportHash, fullPreviewArtifactId: link.viewer.id, fullPreviewHash: link.viewer.data.hash };
}

function scenePreviewResult(link: AssemblyPreviewLink, verified: VerifiedAssemblyPreview, proxy: any) {
  return { artifactId: verified.artifactId, sourceHash: verified.sourceHash, status: proxy.status, operationId: link.operation.id, assemblyReportHash: verified.assemblyReportHash, fullPreviewArtifactId: verified.fullPreviewArtifactId, fullPreviewHash: verified.fullPreviewHash, proxyOperationId: proxy.operationId || null, proxySourceArtifactId: verified.fullPreviewArtifactId, proxySourceHash: verified.fullPreviewHash, previewArtifactId: proxy.status === 'complete' ? proxy.previewArtifactId : null, previewHash: proxy.status === 'complete' ? proxy.previewHash : null, materialAudit: null, error: proxy.error || null };
}

function currentAssemblyScene(store: AtelierStore, jobId: string, artifactId: string) {
  const context = new AssetProductionService(store).get(jobId);
  return context.job.data.mode === 'composite' && context.workflow.data.sceneCandidates.some((candidate: any) => candidate.artifactId === artifactId && ['pending', 'accepted'].includes(candidate.status) && (candidate.status !== 'accepted' || context.workflow.data.sceneAcceptedCandidateId === candidate.id));
}

export async function createAssetPreview(store: AtelierStore, input: { assetJobId: string; assetItemId?: string; artifactId: string; expectedHash: string }, options: { resourceRoot: string; blender: string }) {
  const { source } = verifyAssetViewer(store, { ...input, viewerArtifactId: input.artifactId });
  if (source.data.hash !== input.expectedHash) throw new Error('Preview source changed.');
  const isCurrentScene = currentAssemblyScene(store, input.assetJobId, source.id);
  if (!isCurrentScene && currentAssemblyPreviewSources(store, input.assetJobId, source.id).length) throw new Error('Open the current scene candidate to prepare its checked lightweight viewer proxy.');
  if (isCurrentScene) {
    const links = currentAssemblyPreviewLinks(store, input);
    let integrityError: unknown;
    for (const link of links) {
      try {
        const verified = await verifyAssemblyPreview(store, input, link);
        const proxy = await createAssetPreviewForSource(store, { assetJobId: input.assetJobId, artifactId: link.viewer.id, expectedHash: link.viewer.data.hash }, options, { link, verified });
        return scenePreviewResult(link, verified, { ...proxy, status: 'complete' });
      } catch (error) { integrityError = error; }
    }
    throw new Error(integrityError instanceof Error ? `The lightweight current assembly preview could not be verified or prepared: ${integrityError.message}` : 'The current assembly has no verified GLB preview. Rebuild the assembly to create a matching scene and preview.');
  }
  return createAssetPreviewForSource(store, input, options);
}

async function createAssetPreviewForSource(store: AtelierStore, input: { assetJobId: string; assetItemId?: string; artifactId: string; expectedHash: string }, options: { resourceRoot: string; blender: string }, assemblyProxy?: AssemblyProxyContext) {
  const { source } = verifyAssetViewer(store, { ...input, viewerArtifactId: input.artifactId });
  if (source.data.hash !== input.expectedHash) throw new Error('Preview source changed.');
  const ext = path.extname(String(source.data.sourceName || source.name)).toLowerCase();
  if (!['.fbx', '.glb', '.obj', '.blend'].includes(ext)) throw new Error('Unsupported asset preview source.');
  if (ext === '.blend') {
    const operation = store.get('operation', String(source.data.operationId || ''));
    const workbench = operation && operation.data.assetWorkbench === true && operation.data.assetJobId === input.assetJobId && operation.data.assetItemId === input.assetItemId && operation.data.candidateArtifactId === source.id && operation.data.candidateHash === input.expectedHash && ['pending-review', 'accepted'].includes(String(operation.data.status)) && operation.data.audit?.ok === true;
    if (!workbench) throw new Error('Only a checked asset workbench BLEND can be converted; current assembly previews are reused from their verified assemble operation.');
  }
  const context = new AssetProductionService(store).get(input.assetJobId), sourceOwner = ownerForArtifact(store, source);
  if (sourceOwner?.kind !== 'assetJob' || sourceOwner.id !== input.assetJobId) throw new Error('Preview source belongs to another asset job.');
  const owner = { kind: 'assetJob' as const, id: input.assetJobId, name: context.job.name }, proxyProof = assemblyProxy ? assemblyPreviewProxyProof(assemblyProxy) : null, scope = proxyProof ? 'assembly-preview-proxy' : input.assetItemId || 'shared';
  const foliageMask = !!input.assetItemId && context.items.some(item => item.id === input.assetItemId && item.data.route === 'foliage');
  const scriptSet = scriptsFor(options.resourceRoot), scripts = [scriptSet.main, scriptSet.surface, scriptSet.support, scriptSet.importer, scriptSet.mesh];
  for (const script of scripts) if (!fs.existsSync(script) || fs.realpathSync.native(script) !== script) throw new Error('Bundled asset preview script is unavailable or unsafe.');
  const recipeId = proxyProof ? 'asset-assembly-viewer-proxy' : 'asset-preview', recipeVersion = proxyProof ? '1' : '2', profile = { foliageMask, ...(proxyProof ? { assemblyPreviewProxy: proxyProof } : {}) };
  const requestKey = modelProcessingRequestKey(store, owner, { scope, artifactId: source.id, sourceHash: input.expectedHash, dependencies: store.dependencies(source.id).map(row => [row.logicalPath, row.hash]), recipe: recipeId, version: recipeVersion, profile, blender: path.resolve(options.blender), scripts });

  return coordinateModelProcessingRequest(store, owner, requestKey, async () => {
    const layout = workspaceLayout(store.root), probeId = crypto.randomUUID(), probe = layout.run(owner, probeId), ops = new AssetOperationsService(store, options);
     fs.mkdirSync(path.dirname(probe), { recursive: true }); fs.mkdirSync(probe, { recursive: false });
    try {
      const stagedProbe = await ops.stageVerified(source, path.join(probe, 'input'));
      const identity = await createModelProcessingIdentity(store, { owner: { kind: 'assetJob', id: input.assetJobId }, scope, profile, artifactId: source.id, blenderPath: options.blender, scripts, recipeId, recipeVersion, verifiedFiles: stagedProbe.verifiedFiles });
      const cached = findCompletedModelProcessing(store, identity, 'derived-preview'), cachedReport = cached?.data.report as any, cachedPreview = cachedReport?.previewArtifactId ? store.get('artifact', String(cachedReport.previewArtifactId)) : null;
      if (cached && cachedPreview) {
        try {
          const { viewer } = verifyAssetViewer(store, { ...input, viewerArtifactId: cachedPreview.id });
          await verifyAssetHashesOffThread([managedHashCheck(store, input.expectedHash, 'Assembly preview source'), managedHashCheck(store, String(viewer.data.hash), 'Cached viewer proxy')]);
          if (cachedReport.assetGuardedImport === true && cachedReport.derivedPreviewOnly === true && cachedReport.inputSHA256 === input.expectedHash && cachedReport.outputSHA256 === viewer.data.hash && cachedReport.sourceAudit?.proxyOutputHash === viewer.data.hash && stableJson(cachedReport.assemblyPreviewProxy || null) === stableJson(proxyProof)) {
            return { artifactId: source.id, sourceHash: input.expectedHash, operationId: cached.id, previewArtifactId: viewer.id, previewHash: viewer.data.hash, materialAudit: null, assemblyPreviewProxy: proxyProof };
          }
        } catch { /* Corrupt or stale derivatives are rebuilt below. */ }
      }

      const workingSetBudgetBytes = proxyProof ? assetAssemblyWorkingSetBudget() : 1536 * 1024 * 1024, timeoutMs = proxyProof ? 900000 : 300000;
      const operation = ops.begin(input.assetJobId, source.id, 'derived-preview', [input.expectedHash], { recipe: proxyProof ? 'asset-assembly-viewer-proxy-v1' : 'asset-preview-v2' }), work = layout.run(owner, operation.id);
      const current = store.get('operation', operation.id)!;
      store.put({ id: operation.id, kind: 'operation', name: operation.name, data: { ...current.data, modelProcessingIdentity: identity, ...(proxyProof ? { previewWorkingSetBudgetBytes: workingSetBudgetBytes } : {}) }, expectedRevision: current.revision });
      fs.renameSync(probe, work);
      try {
        const inputRoot = path.join(work, 'input'), staged = path.join(work, path.relative(probe, stagedProbe.sourcePath)), output = path.join(work, 'preview.glb'), reportPath = path.join(work, 'report.json'), config = path.join(work, 'request.json');
        const manifest = ops.importManifest(source, inputRoot);
        fs.writeFileSync(config, JSON.stringify({ ...manifest, source: staged, output, report: reportPath, foliageMask }), { flag: 'wx' });
        const run = await runExclusiveBlenderJob(store, options.blender, ['--background', '--factory-startup', '--disable-autoexec', '--threads', '1', '--python', scriptSet.main, '--', config], { cwd: work, timeoutMs, maxWorkingSetBytes: workingSetBudgetBytes });
        if (!fs.existsSync(reportPath) || !fs.existsSync(output) || fs.realpathSync.native(reportPath) !== path.resolve(reportPath) || fs.realpathSync.native(output) !== path.resolve(output)) throw new Error(`Preview output is missing or unsafe: ${(run.stderr + ' ' + run.stdout).slice(-3000)}`);
        safeReportFile(reportPath);
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')), outputHash = String(report.outputSHA256 || '');
        await verifyAssetHashesOffThread([{ file: output, expectedHash: outputHash, label: 'Generated viewer proxy' }]);
        if (report.schemaVersion !== 1 || report.ok !== true || report.autoexec !== 'disabled' || report.derivedPreviewOnly !== true || report.assetGuardedImport !== true || foliageMask && report.foliageMask !== true || report.inputSHA256 !== input.expectedHash || report.outputSHA256 !== outputHash || !Number.isInteger(report.meshCount) || report.meshCount < 1 || !Array.isArray(report.textures) || !Array.isArray(report.sourceAudit?.assetSourceMaterials) || !Array.isArray(report.sourceAudit?.uv) || !Array.isArray(report.sourceAudit?.assetProxyMaterials) || report.sourceAudit?.proxyOutputHash !== outputHash || report.textures.some((row: any) => !Array.isArray(row.previewSize) || Math.max(...row.previewSize) > 1024)) throw new Error('Asset preview report failed verification.');
        if (proxyProof) { report.assemblyPreviewProxy = proxyProof; report.previewWorkingSetBudgetBytes = workingSetBudgetBytes; }
        await verifyAssetHashesOffThread([managedHashCheck(store, input.expectedHash, 'Assembly preview source')]);
        verifyAssetViewer(store, { ...input, viewerArtifactId: source.id });
        const ingested = await store.ingest(output, input.assetItemId || input.assetJobId, 'artifact'), preview = store.assetProductionPut({ kind: 'artifact', id: ingested.id, name: ingested.name, data: { ...ingested.data, operationId: operation.id, versionOf: source.id, sourceInputHash: input.expectedHash, settings: { textureBindingProofs: report.sourceAudit, ...(proxyProof ? { assemblyPreviewProxy: proxyProof } : {}) }, validationChecks: { outputHashVerified: true, sourceUnmodified: true, assetGuardedImport: true, ...(proxyProof ? { assemblyPreviewProxyVerified: true } : {}) } }, expectedRevision: ingested.revision });
        if (preview.data.hash !== outputHash) throw new Error('Registered preview hash differs from its Blender report.');
        ops.end(operation, 'complete', { ...report, previewArtifactId: preview.id });
        verifyAssetViewer(store, { ...input, viewerArtifactId: preview.id });
        return { artifactId: source.id, sourceHash: input.expectedHash, operationId: operation.id, previewArtifactId: preview.id, previewHash: preview.data.hash, materialAudit: null, assemblyPreviewProxy: proxyProof };
      } catch (error) {
        ops.end(operation, 'failed', { message: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    } finally {
      if (fs.existsSync(probe)) fs.rmSync(probe, { recursive: true, force: true });
    }
  });
}

export async function assetPreviewStatus(store: AtelierStore, input: { assetJobId: string; assetItemId?: string; artifactId: string }, options: { resourceRoot: string; blender: string }) {
  const { source } = verifyAssetViewer(store, { ...input, viewerArtifactId: input.artifactId });
  if (currentAssemblyScene(store, input.assetJobId, source.id)) {
    const links = currentAssemblyPreviewLinks(store, input); let integrityError: string | null = null;
    for (const link of links) {
      try {
        const verified = await verifyAssemblyPreview(store, input, link), proxy = await assetPreviewStatusForSource(store, { assetJobId: input.assetJobId, artifactId: link.viewer.id }, options, { link, verified });
        if (proxy.status === 'complete' && proxy.previewArtifactId) verifyAssetViewer(store, { assetJobId: input.assetJobId, assetItemId: input.assetItemId, artifactId: source.id, viewerArtifactId: proxy.previewArtifactId });
        return scenePreviewResult(link, verified, proxy);
      }
      catch (error) { integrityError = error instanceof Error ? error.message : String(error); }
    }
    return { artifactId: source.id, sourceHash: source.data.hash, status: 'failed', operationId: links[0]?.operation.id || null, previewArtifactId: null, previewHash: null, materialAudit: null, error: integrityError || 'The current assembly has no verified GLB preview. Rebuild the assembly to create a matching scene and preview.' };
  }
  return assetPreviewStatusForSource(store, input, options);
}

async function assetPreviewStatusForSource(store: AtelierStore, input: { assetJobId: string; assetItemId?: string; artifactId: string }, options: { resourceRoot: string; blender: string }, assemblyProxy?: AssemblyProxyContext) {
  const { source } = verifyAssetViewer(store, { ...input, viewerArtifactId: input.artifactId }), ops = new AssetOperationsService(store, { resourceRoot: '' }), context = new AssetProductionService(store).get(input.assetJobId);
  const proxyProof = assemblyProxy ? assemblyPreviewProxyProof(assemblyProxy) : null, scope = proxyProof ? 'assembly-preview-proxy' : input.assetItemId || 'shared';
  const foliageMask = !!input.assetItemId && context.items.some(item => item.id === input.assetItemId && item.data.route === 'foliage'), profile = { foliageMask, ...(proxyProof ? { assemblyPreviewProxy: proxyProof } : {}) }, recipeId = proxyProof ? 'asset-assembly-viewer-proxy' : 'asset-preview', recipeVersion = proxyProof ? '1' : '2', scriptSet = scriptsFor(options.resourceRoot), scripts = [scriptSet.main, scriptSet.surface, scriptSet.support, scriptSet.importer, scriptSet.mesh];
  const identity = await createModelProcessingIdentity(store, { owner: { kind: 'assetJob', id: input.assetJobId }, scope, profile, artifactId: source.id, blenderPath: options.blender, scripts, recipeId, recipeVersion });
  const operations = store.list({ kind: 'operation', limit: 10000 }).filter(row => row.data.assetJobId === input.assetJobId && row.data.assetId === source.id && row.data.parameters?.mode === 'derived-preview' && row.data.inputs?.[0] === source.data.hash && row.data.modelProcessingIdentity?.key === identity.key && row.data.modelProcessingIdentity?.workspace === path.resolve(store.root) && row.data.modelProcessingIdentity?.owner?.kind === 'assetJob' && row.data.modelProcessingIdentity?.owner?.id === input.assetJobId && row.data.modelProcessingIdentity?.scope === scope).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  let integrityError: string | null = null;
  for (const operation of operations) {
    const report = operation.data.report;
    if (operation.data.status !== 'complete' || report?.assetGuardedImport !== true || !report.previewArtifactId) continue;
    try {
      const { viewer } = verifyAssetViewer(store, { ...input, viewerArtifactId: report.previewArtifactId });
      await verifyAssetHashesOffThread([managedHashCheck(store, String(viewer.data.hash), 'Cached viewer proxy')]);
      if (report.inputSHA256 !== source.data.hash || report.outputSHA256 !== viewer.data.hash || report.sourceAudit?.proxyOutputHash !== viewer.data.hash || report.derivedPreviewOnly !== true || report.assetGuardedImport !== true || foliageMask && report.foliageMask !== true || viewer.data.versionOf !== source.id || viewer.data.sourceInputHash !== source.data.hash || operation.data.modelProcessingIdentity?.key !== identity.key || stableJson(report.assemblyPreviewProxy || null) !== stableJson(proxyProof)) throw new Error('Preview source or reopened output proof is stale.');
      return { artifactId: source.id, sourceHash: source.data.hash, status: 'complete', operationId: operation.id, previewArtifactId: viewer.id, previewHash: viewer.data.hash, materialAudit: null, error: null, assemblyPreviewProxy: proxyProof };
    } catch (error) { integrityError = error instanceof Error ? error.message : String(error); }
  }
  const failed = operations.find(row => row.data.status === 'failed');
  return { artifactId: source.id, sourceHash: source.data.hash, status: failed || integrityError ? 'failed' : 'not-started', operationId: failed?.id || null, previewArtifactId: null, previewHash: null, materialAudit: null, error: failed?.data.report?.message || integrityError || null, assemblyPreviewProxy: proxyProof };
}
