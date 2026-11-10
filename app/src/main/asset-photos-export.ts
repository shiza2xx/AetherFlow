import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Entity } from '../shared/contracts';
import { assetViewsForRoute } from '../shared/asset-production';
import { AssetSharedReturnService } from './asset-shared-return';
import type { AtelierStore } from './store';
import { safeStorageName, workspaceLayout } from './workspace-layout';
import { AssetProductionService } from './asset-production';

const Id = z.string().uuid();
export const AssetPhotosExportInput = z.object({ id: Id, expectedRevision: z.number().int().nonnegative() }).strict();
const hashFile = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

type PlannedFile = {
  itemId: string;
  itemName: string;
  role: string;
  purpose: 'texturing-reference' | 'geometry-view' | 'shared-geometry-sheet';
  folder: 'colored' | 'depth-map';
  artifactId: string;
  hash: string;
  candidateId?: string;
  sourceType?: 'color' | 'depth' | 'mixed';
  path?: string;
  sourceLineage?: unknown;
};

function isHumanAccepted(candidate: any): boolean {
  return candidate?.status === 'accepted' && candidate.reviewedBy === 'human' && /^[a-f0-9]{64}$/.test(String(candidate.hash || '')) && Id.safeParse(candidate.artifactId).success;
}

function roleCandidate(rows: any[] | undefined, role: string, state: any): any | null {
  const alias = role === 'image:front' ? 'image' : role === 'depth:front' ? 'depth' : null;
  const candidate = rows?.find((row: any) => row.role === role)?.candidate || (alias ? rows?.find((row: any) => row.role === alias)?.candidate : null);
  return isHumanAccepted(candidate) && Array.isArray(state?.imageInputFingerprints) && state.imageInputFingerprints.includes(candidate.inputFingerprint) ? candidate : null;
}

function artifactExtension(artifact: Entity): string {
  const names = [artifact.data.logicalPath, artifact.data.sourceName, artifact.name];
  for (const value of names) {
    const ext = path.extname(String(value || '')).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  }
  const mime = String(artifact.data.mime || '').toLowerCase();
  return mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
}

function filenameCollisionKey(filename: string): string {
  return filename.normalize('NFKC').toLowerCase();
}

function physicalPathCollisionKey(filename: string): string {
  return filename.replace(/\\/g, '/').split('/').map(part => filenameCollisionKey(part)).join('/');
}

function sourceName(itemName: string, role: string, extension: string, used: Set<string>, itemId: string): string {
  const view = role.split(':').at(-1) || role;
  const base = `${safeStorageName(itemName, 'item')}-${safeStorageName(view, 'view')}`;
  let filename = `${base}${extension}`, key = filenameCollisionKey(filename);
  if (used.has(key)) {
    let length = 8;
    do { filename = `${base}-${itemId.replaceAll('-', '').slice(0, length)}${extension}`; key = filenameCollisionKey(filename); length += 4; }
    while (used.has(key) && length <= 40);
    if (used.has(key)) throw new Error('Could not allocate a collision-safe photo export filename.');
  }
  used.add(key);
  return filename;
}

function createSafeDirectory(root: string, directory: string): string[] {
  const relative = path.relative(root, directory).replace(/\\/g, '/');
  const layout = workspaceLayout(root);
  const created: string[] = [];
  let current = root;
  for (const component of relative.split('/')) {
    current = path.join(current, component);
    layout.resolve(path.relative(root, current).replace(/\\/g, '/'));
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(current) !== path.resolve(current)) throw new Error('Photo export destination contains an unsafe path component.');
    } else { fs.mkdirSync(current); created.push(current); }
  }
  return created;
}

/** Exports only current, human-accepted source images into an immutable, revision-bound folder. */
export class AssetPhotosExportService {
  private production: AssetProductionService;

  constructor(private store: AtelierStore) { this.production = new AssetProductionService(store); }

  private acceptedSlotRole(ctx: any, itemId: string, candidateId: string, canonicalRole: string) {
    const slot = ctx.workflow.data.slots.find((value: any) => value.itemId === itemId && value.candidates.some((candidate: any) => candidate.id === candidateId));
    return slot?.role || canonicalRole;
  }

  private missingReason(ctx: any, itemId: string, role: string, state: any, fallback = 'Accept a current color view for texturing.') {
    const aliases = role === 'image:front' ? ['image:front', 'image'] : role === 'depth:front' ? ['depth:front', 'depth'] : [role];
    const slots = ctx.workflow.data.slots.filter((slot: any) => slot.itemId === itemId && aliases.includes(slot.role));
    if (slots.some((slot: any) => slot.candidates.some((candidate: any) => candidate.status === 'pending'))) return 'A current image candidate is awaiting human review.';
    const currentAccepted = slots.some((slot: any) => slot.candidates.some((candidate: any) => candidate.id === slot.acceptedCandidateId && candidate.status === 'accepted'));
    if (currentAccepted && !slots.some((slot: any) => slot.candidates.some((candidate: any) => candidate.id === slot.acceptedCandidateId && state?.imageInputFingerprints?.includes(candidate.inputFingerprint)))) return 'The accepted image is stale; review a current return before exporting.';
    return fallback;
  }

  private plan(id: string, ctx = this.production.get(id)) {
    const planned: PlannedFile[] = [];
    const waiting: Array<{ itemId: string; itemName: string; role: string; reason: string }> = [];
    const sharedMaps: Array<Record<string, unknown>> = [];
    const shared = ctx.items.filter((item: Entity) => item.data.route === 'shared-prop');
    const sharedSheets = shared.length ? new AssetSharedReturnService(this.store, { resourceRoot: '' }).sheets(id) : [];
    const push = (item: Entity, role: string, purpose: PlannedFile['purpose'], folder: PlannedFile['folder'], candidate: any, sourceType?: PlannedFile['sourceType'], sourceLineage?: unknown) => {
      if (!isHumanAccepted(candidate)) return false;
      const artifact = this.store.get('artifact', candidate.artifactId);
      if (!artifact || artifact.data.hash !== candidate.hash) return false;
      planned.push({ itemId: item.id, itemName: item.name, role, purpose, folder, artifactId: artifact.id, hash: candidate.hash, candidateId: candidate.id, ...(sourceType ? { sourceType } : {}), ...(sourceLineage ? { sourceLineage } : {}) });
      return true;
    };

    if (ctx.job.data.catalogRequiresRevalidation || !(ctx.job.data.catalogStatus === 'accepted' || ctx.job.data.catalogStatus === 'pending' && ctx.job.data.catalogPreviouslyAccepted)) {
      throw new Error('Accept the current catalog before exporting photos.');
    }

    for (const item of ctx.items) {
      const state = ctx.current.find((value: any) => value.itemId === item.id);
      if (!state) { waiting.push({ itemId: item.id, itemName: item.name, role: 'item', reason: 'The item is no longer in the active catalog.' }); continue; }
      const foliage = item.data.route === 'foliage';
      const views = assetViewsForRoute(item.data.route, item.data.views, item.data.viewType).filter(view => foliage || view === 'front' || view === 'side');
      const colors = new Map<string, any>();
      for (const view of views) {
        const role = foliage ? `foliage:${view}` : `image:${view}`;
        const candidate = roleCandidate(state.images, role, state);
        if (candidate) {
          colors.set(view, candidate);
          if (!push(item, role, 'texturing-reference', 'colored', candidate, 'color', { acceptedSlotRole: this.acceptedSlotRole(ctx, item.id, candidate.id, role) })) waiting.push({ itemId: item.id, itemName: item.name, role, reason: 'The accepted image artifact is missing or does not match its saved hash.' });
        } else waiting.push({ itemId: item.id, itemName: item.name, role, reason: this.missingReason(ctx, item.id, role, state) });
      }

      if (foliage || item.data.route === 'shared-prop') continue;
      for (const view of views) {
        if (item.data.depthEnabled) {
          const role = `depth:${view}`;
          const candidate = roleCandidate(state.depths, role, state);
          const paired = colors.get(view);
          if (candidate && paired && candidate.dependsOnColorHash === paired.hash) {
            if (!push(item, role, 'geometry-view', 'depth-map', candidate, 'depth', { acceptedSlotRole: this.acceptedSlotRole(ctx, item.id, candidate.id, role) })) waiting.push({ itemId: item.id, itemName: item.name, role, reason: 'The accepted depth artifact is missing or does not match its saved hash.' });
          } else waiting.push({ itemId: item.id, itemName: item.name, role, reason: this.missingReason(ctx, item.id, role, state, 'Accept a current depth view paired with the current color view.') });
        } else if (colors.has(view)) {
          const candidate = colors.get(view);
          planned.push({ itemId: item.id, itemName: item.name, role: `image:${view}`, purpose: 'geometry-view', folder: 'colored', artifactId: candidate.artifactId, hash: candidate.hash, candidateId: candidate.id, sourceType: 'color', sourceLineage: { acceptedSlotRole: this.acceptedSlotRole(ctx, item.id, candidate.id, `image:${view}`) } });
        } else waiting.push({ itemId: item.id, itemName: item.name, role: `image:${view}`, reason: 'Accept a current color view before geometry generation.' });
      }
    }

    if (shared.length) {
      const sheet = sharedSheets.find((row: any) => shared.every((item: Entity) => row.members.some((member: any) => member.itemId === item.id)));
      if (!sheet) {
        for (const item of shared) waiting.push({ itemId: item.id, itemName: item.name, role: 'sheet', reason: 'Accept the current shared geometry sheet before exporting the geometry input.' });
      } else {
        const manifestDependency = this.store.dependencies(sheet.artifactId).find((row: any) => row.role === 'mapping' && row.logicalPath === 'sheet-map.json');
        const manifestFile = manifestDependency && this.store.object(manifestDependency.hash);
        if (!manifestDependency || !manifestFile || !fs.existsSync(manifestFile) || fs.lstatSync(manifestFile).isSymbolicLink() || fs.realpathSync.native(manifestFile) !== path.resolve(manifestFile) || hashFile(manifestFile) !== manifestDependency.hash) {
          for (const item of shared) waiting.push({ itemId: item.id, itemName: item.name, role: 'sheet', reason: 'The accepted shared sheet mapping is missing or corrupt.' });
        } else {
          const sourceManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
          const hasDepth = sheet.members.some((member: any) => member.sourceType === 'depth');
          for (const item of shared) {
            const member = sheet.members.find((value: any) => value.itemId === item.id);
            if (!member) { waiting.push({ itemId: item.id, itemName: item.name, role: 'sheet', reason: 'The accepted shared sheet does not map this catalog item.' }); continue; }
            const state = ctx.current.find((value: any) => value.itemId === item.id);
            const sheetCandidate = { artifactId: sheet.artifactId, hash: sheet.hash, candidateId: state?.sheets?.find((value: any) => value.artifactId === sheet.artifactId)?.candidateId, status: 'accepted', reviewedBy: 'human' };
            push(item, 'sheet', 'shared-geometry-sheet', hasDepth ? 'depth-map' : 'colored', sheetCandidate, hasDepth ? 'mixed' : 'color', { ...member, sheetInputFingerprint: sheet.sheetInputFingerprint, mapHash: manifestDependency.hash, mapSchemaVersion: sourceManifest.schemaVersion });
            if (member.sourceType === 'depth') {
              const depth = roleCandidate(state?.depths, 'depth:front', state), color = roleCandidate(state?.images, 'image:front', state);
              if (depth && color && depth.dependsOnColorHash === color.hash) push(item, 'depth:front', 'geometry-view', 'depth-map', depth, 'depth', { acceptedSlotRole: this.acceptedSlotRole(ctx, item.id, depth.id, 'depth:front'), pairedColorHash: color.hash });
              else waiting.push({ itemId: item.id, itemName: item.name, role: 'depth:front', reason: 'The shared sheet uses a depth view whose accepted source is no longer available.' });
            }
          }
          sharedMaps.push({ artifactId: sheet.artifactId, artifactHash: sheet.hash, mapHash: manifestDependency.hash, sheetInputFingerprint: sheet.sheetInputFingerprint, manifest: sourceManifest });
        }
      }
    }
    return { planned, waiting, sharedMaps };
  }

  export(raw: unknown) {
    const input = AssetPhotosExportInput.parse(raw), ctx = this.production.get(input.id);
    if (ctx.workflow.revision !== input.expectedRevision) throw new Error('Workflow changed; refresh before exporting photos.');
    const { planned, waiting, sharedMaps } = this.plan(input.id, ctx);
    if (!planned.length && !waiting.length) throw new Error('The accepted catalog has no photo targets to export.');
    if (!planned.length) return { operationId: null, directory: null, status: 'empty', current: true, entries: [], waiting, workflowRevision: input.expectedRevision };

    const operation = this.store.put({ kind: 'operation', name: `Asset photo export · ${ctx.job.name}`, data: { schemaVersion: 1, assetId: planned[0]?.artifactId || waiting[0]?.itemId || input.id, assetJobId: input.id, status: 'running', inputs: [...new Set(planned.map(file => file.hash))], parameters: { mode: 'photos-export', kind: 'photos', workflowRevision: input.expectedRevision }, toolVersions: { application: 'AetherFlow' } } });
    const relative = `work/assets/${input.id}/exports/photos/${operation.id}`;
    const layout = workspaceLayout(this.store.root), directory = layout.resolve(relative);
    const createdFiles: string[] = [], createdDirectories: string[] = [];
    const metadataDirectory = path.join(layout.internal({ kind: 'assetJob', id: input.id, name: ctx.job.name }), 'photo-exports');
    const metadataRelative = `${path.relative(this.store.root, metadataDirectory).replace(/\\/g, '/')}/${operation.id}.json`;
    try {
      createdDirectories.push(...createSafeDirectory(this.store.root, directory));
      createdDirectories.push(...createSafeDirectory(this.store.root, metadataDirectory));
      for (const name of ['colored', 'depth-map']) {
        const child = layout.resolve(`${relative}/${name}`);
        fs.mkdirSync(child);
        createdDirectories.push(child);
      }
      const entries: PlannedFile[] = [], usedNames = new Map<string, Set<string>>(), physicalPaths = new Map<string, string>(), physicalPathOwners = new Map<string, string>();
      for (const file of planned) {
        const artifact = this.store.get('artifact', file.artifactId), source = this.store.object(file.hash);
        if (!artifact || artifact.data.hash !== file.hash || !source || !fs.existsSync(source) || fs.lstatSync(source).isSymbolicLink() || fs.realpathSync.native(source) !== path.resolve(source) || hashFile(source) !== file.hash) throw new Error(`Missing or corrupt source for ${file.itemName} · ${file.role}.`);
        const extension = artifactExtension(artifact), physicalKey = `${file.folder}:${file.artifactId}:${file.hash}`;
        let relativeFile = physicalPaths.get(physicalKey), isNewPhysicalFile = false;
        if (!relativeFile) {
          const used = usedNames.get(file.folder) || new Set<string>(); usedNames.set(file.folder, used);
          const filename = file.purpose === 'shared-geometry-sheet'
            ? sourceName('shared-props', 'geometry-sheet', extension, used, file.artifactId)
            : sourceName(file.itemName, file.role, extension, used, file.itemId);
          relativeFile = `${file.folder}/${filename}`; physicalPaths.set(physicalKey, relativeFile);
          const pathKey = physicalPathCollisionKey(relativeFile), pathOwner = physicalPathOwners.get(pathKey);
          if (pathOwner && pathOwner !== physicalKey) throw new Error('Could not allocate a collision-safe physical photo export path.');
          physicalPathOwners.set(pathKey, physicalKey); isNewPhysicalFile = true;
        }
        const target = layout.resolve(`${relative}/${relativeFile}`);
        if (isNewPhysicalFile) {
          if (fs.existsSync(target)) throw new Error(`Photo export destination already exists: ${relativeFile}.`);
          fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
          createdFiles.push(target);
        } else if (!fs.existsSync(target)) throw new Error(`A repeated photo export source disappeared: ${relativeFile}.`);
        if (hashFile(target) !== file.hash) throw new Error(`Exported source hash changed for ${file.itemName} · ${file.role}.`);
        entries.push({ ...file, path: relativeFile });
      }
      const next = this.production.get(input.id);
      if (next.workflow.revision !== input.expectedRevision) throw new Error('Workflow changed during photo export. No stale export was kept.');
      const receipt = { schemaVersion: 2, jobId: input.id, operationId: operation.id, workflowRevision: input.expectedRevision, status: waiting.length ? 'partial' : 'ready', directory: relative, folders: ['colored', 'depth-map'], entries, waiting, sharedMaps };
      const receiptPath = layout.resolve(`${metadataRelative}`);
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' });
      createdFiles.push(receiptPath);
      const current = this.store.get('operation', operation.id)!;
      const saved = this.store.put({ kind: 'operation', id: operation.id, name: operation.name, data: { ...current.data, status: 'complete', report: { relativePath: relative, metadataRelativePath: metadataRelative, receiptHash: hashFile(receiptPath), files: new Set(entries.map(entry => entry.path)).size, waiting: waiting.length, exportStatus: receipt.status } }, expectedRevision: current.revision });
      return { operationId: saved.id, directory, status: receipt.status, entries, waiting, workflowRevision: input.expectedRevision };
    } catch (error) {
      for (const file of createdFiles.reverse()) try { fs.unlinkSync(file); } catch {}
      for (const directoryPath of createdDirectories.reverse()) try { fs.rmdirSync(directoryPath); } catch {}
      const current = this.store.get('operation', operation.id);
      if (current) this.store.put({ kind: 'operation', id: operation.id, name: operation.name, data: { ...current.data, status: 'failed', report: { message: error instanceof Error ? error.message : String(error) } }, expectedRevision: current.revision });
      throw error;
    }
  }

  read(jobId: string, operationId: string) {
    const op = this.store.get('operation', operationId);
    if (!op || op.data.assetJobId !== jobId || op.data.status !== 'complete' || op.data.parameters?.mode !== 'photos-export') throw new Error('Photo export does not belong to this job.');
    const relative = String(op.data.report?.relativePath || ''), expected = `work/assets/${jobId}/exports/photos/${operationId}`;
    if (relative !== expected) throw new Error('Photo export location is invalid.');
    const layout = workspaceLayout(this.store.root), directory = layout.resolve(relative);
    const metadataRelative = String(op.data.report?.metadataRelativePath || `${relative}/photos.json`);
    const expectedMetadata = `${path.relative(this.store.root, path.join(layout.internal({ kind: 'assetJob', id: jobId, name: op.name }), 'photo-exports', `${operationId}.json`)).replace(/\\/g, '/')}`;
    if (op.data.report?.metadataRelativePath && metadataRelative !== expectedMetadata) throw new Error('Photo export receipt location is invalid.');
    const receiptPath = layout.resolve(metadataRelative);
    if (!fs.existsSync(receiptPath) || fs.lstatSync(receiptPath).isSymbolicLink() || hashFile(receiptPath) !== op.data.report.receiptHash) throw new Error('Photo export receipt is missing or changed.');
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (receipt.directory !== relative) throw new Error('Photo export receipt directory is invalid.');
    if (receipt.schemaVersion >= 2 && JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(['colored', 'depth-map'])) throw new Error('Photo export folder structure changed.');
    for (const entry of receipt.entries || []) {
      const name = String(entry.path || '');
      if (name.includes('\\') || name.startsWith('/') || name.split('/').some((part: string) => !part || part === '.' || part === '..')) throw new Error('Photo export contains an unsafe file path.');
      const target = layout.resolve(`${relative}/${name}`);
      if (!fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink() || hashFile(target) !== entry.hash) throw new Error(`Photo export file is missing or changed: ${name}`);
    }
    const latest = this.plan(jobId), sourceKey = (entry: PlannedFile, legacy = false) => JSON.stringify([entry.itemId, entry.itemName, entry.role, entry.purpose, entry.folder, entry.artifactId, entry.hash, entry.sourceType, legacy ? undefined : entry.sourceLineage]);
    const waitingKey = (entry: { itemId: string; itemName: string; role: string; reason: string }) => JSON.stringify([entry.itemId, entry.role]);
    const legacy = receipt.schemaVersion < 2;
    const currentSources = new Set(latest.planned.map((entry: PlannedFile) => sourceKey(entry, legacy))), exportedSources = new Set((receipt.entries || []).filter((entry: any) => entry.purpose !== 'shared-sheet-map').map((entry: PlannedFile) => sourceKey(entry, legacy)));
    const currentWaiting = new Set(latest.waiting.map(waitingKey)), exportedWaiting = new Set((receipt.waiting || []).map(waitingKey));
    const currentMaps = new Set((latest.sharedMaps || []).map((value: any) => value.mapHash)), exportedMaps = new Set(legacy ? (receipt.entries || []).filter((entry: any) => entry.purpose === 'shared-sheet-map').map((entry: any) => entry.hash) : (receipt.sharedMaps || []).map((value: any) => value.mapHash));
    const unchanged = currentSources.size === exportedSources.size && [...currentSources].every(key => exportedSources.has(key)) && currentWaiting.size === exportedWaiting.size && [...currentWaiting].every(key => exportedWaiting.has(key)) && currentMaps.size === exportedMaps.size && [...currentMaps].every(hash => exportedMaps.has(hash));
    return { operationId, directory, receipt, waiting: latest.waiting, current: unchanged, status: unchanged ? receipt.status : 'outdated' };
  }
}

export async function openVerifiedAssetPhotosExport(store: AtelierStore, jobId: string, operationId: string, openPath: (directory: string) => Promise<string>) {
  const delivery = new AssetPhotosExportService(store).read(jobId, operationId);
  const error = await openPath(delivery.directory);
  if (error) throw new Error(error);
  return { directory: delivery.directory, status: delivery.status };
}
