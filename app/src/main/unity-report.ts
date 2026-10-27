import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateStagedGalleryImage } from './gallery-image-validation';
import { validateUnityReportVideo, type UnityReportVideoFacts } from './unity-video-validation';
import type { AtelierStore } from './store';
import type { Entity } from '../shared/contracts';

const MAX_EVIDENCE_BYTES = 32 * 1024 * 1024;
const categories = ['General', 'Shader', 'Mechanic', 'Scene', 'Bug fix', 'Performance', 'Other'];
const roles = ['before', 'after', 'gif', 'video', 'beforeVideo', 'afterVideo'] as const;
type Role = typeof roles[number];
type VideoViewRequest = { id: string; label: string; evidence: Partial<Record<'beforeVideo'|'afterVideo', string>>; missingEvidence: Partial<Record<'beforeVideo'|'afterVideo', string>> };
type Request = {
  name: string; summary: string; unityProjectPath: string; projectId?: string;
  category: string; checks: string[]; taskIds: string[];
  evidence: Partial<Record<Role, string>>;
  missingEvidence: Partial<Record<Role, string>>; videoViews?: VideoViewRequest[]; idempotencyKey: string;
};
type ImportManaged = (file: string, idempotencyKey: string) => Promise<Entity[]>;
type Replacement = { id: string; expectedRevision: number; role: Role; path: string; reason: string; idempotencyKey: string; viewId?: string };

const locks = new Map<string, Promise<unknown>>();
const digest = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }); }
function checkedPath(value: string, label: string) {
  if (!path.isAbsolute(value)) fail('INVALID_EVIDENCE_PATH', `${label} must be an absolute local file path.`);
  let real: string;
  try { real = fs.realpathSync.native(value); } catch { fail('EVIDENCE_UNREADABLE', `${label} file is missing or unreadable.`); }
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_EVIDENCE_BYTES) fail('INVALID_EVIDENCE_SIZE', `${label} must be a nonempty file no larger than 32 MiB.`);
  return real;
}

function gifFacts(bytes: Buffer) {
  if (bytes.length < 14 || !/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) || bytes.at(-1) !== 0x3b) fail('INVALID_GIF', 'GIF evidence is not a complete GIF file.');
  let p = 13, frameCount = 0, pendingDuration = 0, totalDuration = 0;
  if (bytes[10] & 0x80) p += 3 * (1 << ((bytes[10] & 7) + 1));
  while (p < bytes.length) {
    const marker = bytes[p++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      if (p >= bytes.length) fail('INVALID_GIF', 'GIF extension is truncated.');
      const label = bytes[p++];
      if (label === 0xf9) {
        if (p + 6 > bytes.length || bytes[p] !== 4 || bytes[p + 5] !== 0) fail('INVALID_GIF', 'GIF frame control is malformed.');
        pendingDuration = bytes.readUInt16LE(p + 2) * 10;
      }
      while (p < bytes.length) { const n = bytes[p++]; if (!n) break; if (p + n > bytes.length) fail('INVALID_GIF', 'GIF extension data is truncated.'); p += n; }
    } else if (marker === 0x2c) {
      if (p + 9 > bytes.length) fail('INVALID_GIF', 'GIF frame descriptor is truncated.');
      const flags = bytes[p + 8]; p += 9;
      if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
      if (p >= bytes.length) fail('INVALID_GIF', 'GIF frame data is missing.');
      p++;
      while (p < bytes.length) { const n = bytes[p++]; if (!n) break; if (p + n > bytes.length) fail('INVALID_GIF', 'GIF frame data is truncated.'); p += n; }
      frameCount++; totalDuration += pendingDuration; pendingDuration = 0;
    } else fail('INVALID_GIF', 'GIF contains an invalid block marker.');
  }
  if (frameCount < 2 || totalDuration <= 0) fail('INVALID_GIF', 'GIF must contain at least two frames and a positive total frame duration.');
  return { frameCount, durationMs: totalDuration };
}

async function preflightEvidence(input: Request, authorizeSource: (file: string) => string) {
  const useVideoRole = input.evidence.video !== undefined || input.missingEvidence.video !== undefined;
  const usePairedVideo = input.videoViews !== undefined || input.evidence.beforeVideo !== undefined || input.missingEvidence.beforeVideo !== undefined || input.evidence.afterVideo !== undefined || input.missingEvidence.afterVideo !== undefined;
  const evidence: Partial<Record<Role, { path: string; hash: string; facts?: { frameCount: number; durationMs: number } | UnityReportVideoFacts }>> = {};
  for (const role of roles) {
    const file = input.evidence[role], reason = input.missingEvidence[role];
    if (input.videoViews !== undefined && ['video','beforeVideo','afterVideo'].includes(role)) continue;
    const pairRole = role === 'beforeVideo' || role === 'afterVideo';
    const optionalRole = usePairedVideo
      ? !pairRole && file === undefined && reason === undefined
      : role === 'video' && !useVideoRole || role === 'gif' && useVideoRole && file === undefined && reason === undefined;
    if (pairRole && !usePairedVideo) continue;
    if (!optionalRole && (!!file === !!reason)) fail('EVIDENCE_ROLE_REQUIRED', `Evidence role ${role} requires exactly one file path or missingEvidence reason.`);
    if (reason !== undefined && (!reason.trim() || reason.length > 2000)) fail('INVALID_MISSING_EVIDENCE', `Missing evidence reason for ${role} must contain 1 to 2000 characters.`);
    if (!file) continue;
    const resolved = checkedPath(authorizeSource(file), role), ext = path.extname(resolved).toLowerCase(), bytes = fs.readFileSync(resolved);
    let facts: { frameCount: number; durationMs: number } | UnityReportVideoFacts | undefined;
    if (role === 'gif') {
      if (ext !== '.gif') fail('INVALID_GIF', 'GIF evidence must use the .gif format.');
      try { await validateStagedGalleryImage(resolved, ext, 'unity-report'); } catch (error) { fail('INVALID_GIF', error instanceof Error ? error.message : 'GIF evidence is malformed.'); }
      facts = gifFacts(bytes);
    } else if (role === 'video' || role === 'beforeVideo' || role === 'afterVideo') {
      if (ext !== '.mp4') fail('INVALID_VIDEO', 'Video evidence must use the .mp4 format.');
      try { facts = await validateUnityReportVideo(resolved); } catch (error) { fail('INVALID_VIDEO', error instanceof Error ? error.message : 'MP4 evidence is malformed or unsupported.'); }
    } else {
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) fail('INVALID_IMAGE', `${role} evidence must be PNG, JPEG, WebP, or GIF image data.`);
      await validateStagedGalleryImage(resolved, ext);
    }
    evidence[role] = { path: resolved, hash: digest(bytes), ...(facts ? { facts } : {}) };
  }
  return evidence;
}

async function preflightVideoViews(views: VideoViewRequest[] | undefined, authorizeSource: (file: string) => string) {
  const result = new Map<string, { path: string; hash: string; facts: UnityReportVideoFacts }>();
  if (!views) return result;
  for (const view of views) for (const side of ['beforeVideo', 'afterVideo'] as const) {
    const file = view.evidence[side];
    if (!file) continue;
    const resolved = checkedPath(authorizeSource(file), `${view.id} ${side}`), ext = path.extname(resolved).toLowerCase(), bytes = fs.readFileSync(resolved);
    if (ext !== '.mp4') fail('INVALID_VIDEO', `Video view ${view.id} ${side} evidence must use the .mp4 format.`);
    let facts: UnityReportVideoFacts;
    try { facts = await validateUnityReportVideo(resolved); } catch (error) { fail('INVALID_VIDEO', error instanceof Error ? error.message : `Video view ${view.id} ${side} is malformed or unsupported.`); }
    result.set(`${view.id}:${side}`, { path: resolved, hash: digest(bytes), facts });
  }
  return result;
}

function validateVideoViews(views: VideoViewRequest[] | undefined) {
  if (views === undefined) return;
  if (!Array.isArray(views) || views.length < 1 || views.length > 8) fail('INVALID_VIDEO_VIEWS', 'videoViews must contain 1 to 8 ordered views.');
  const ids = new Set<string>();
  for (const value of views as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_VIDEO_VIEW', 'Each video view must be an object.');
    const view=value as Record<string, unknown>;
    for (const key of Object.keys(view)) if (!['id','label','evidence','missingEvidence'].includes(key)) fail('INVALID_VIDEO_VIEW', `Unknown video view field: ${key}`);
    if (typeof view.id !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(view.id) || ids.has(view.id)) fail('INVALID_VIDEO_VIEW_ID', 'Each video view needs a unique lowercase slug ID of at most 48 characters.');
    ids.add(view.id);
    if (typeof view.label !== 'string' || !view.label.trim() || view.label.length > 80) fail('INVALID_VIDEO_VIEW_LABEL', 'Each video view label must contain 1 to 80 characters.');
    const isRoleMap=(item:unknown):item is Record<string,unknown>=>!!item&&typeof item==='object'&&!Array.isArray(item);
    if (!isRoleMap(view.evidence)||!isRoleMap(view.missingEvidence)) fail('INVALID_VIDEO_VIEW', 'View evidence and missingEvidence must be objects.');
    const evidence=view.evidence,missing=view.missingEvidence;
    for (const key of [...Object.keys(evidence),...Object.keys(missing)]) if (!['beforeVideo','afterVideo'].includes(key)) fail('INVALID_VIDEO_VIEW', `Unknown view evidence role: ${key}`);
    for (const side of ['beforeVideo','afterVideo'] as const) {
      const file=evidence[side],reason=missing[side];
      if (file!==undefined&&(typeof file!=='string'||!file.trim())) fail('INVALID_EVIDENCE_PATH', `Video view ${view.id} ${side} path must be a nonempty string.`);
      if (reason!==undefined&&(typeof reason!=='string'||!reason.trim()||reason.length>2000)) fail('INVALID_MISSING_EVIDENCE', `Missing evidence reason for ${view.id} ${side} must contain 1 to 2000 characters.`);
      if (Boolean(file)===Boolean(reason)) fail('EVIDENCE_ROLE_REQUIRED', `Video view ${view.id} ${side} requires exactly one file path or missingEvidence reason.`);
    }
    if (!evidence.beforeVideo && !evidence.afterVideo) fail('VIDEO_VIEW_EMPTY', `Video view ${view.id} needs at least one real MP4 clip.`);
  }
}

async function preflightReplacement(file: string, role: Role, authorizeSource: (file: string) => string) {
  const resolved = checkedPath(authorizeSource(file), role), ext = path.extname(resolved).toLowerCase(), bytes = fs.readFileSync(resolved);
  let facts: { frameCount: number; durationMs: number } | UnityReportVideoFacts | undefined;
  if (role === 'gif') {
    if (ext !== '.gif') fail('INVALID_GIF', 'GIF evidence must use the .gif format.');
    try { await validateStagedGalleryImage(resolved, ext, 'unity-report'); } catch (error) { fail('INVALID_GIF', error instanceof Error ? error.message : 'GIF evidence is malformed.'); }
    facts = gifFacts(bytes);
  } else if (role === 'video' || role === 'beforeVideo' || role === 'afterVideo') {
    if (ext !== '.mp4') fail('INVALID_VIDEO', 'Video evidence must use the .mp4 format.');
    try { facts = await validateUnityReportVideo(resolved); } catch (error) { fail('INVALID_VIDEO', error instanceof Error ? error.message : 'MP4 evidence is malformed or unsupported.'); }
  } else {
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) fail('INVALID_IMAGE', `${role} evidence must be PNG, JPEG, WebP, or GIF image data.`);
    await validateStagedGalleryImage(resolved, ext);
  }
  return { path: resolved, hash: digest(bytes), facts };
}

export async function replaceUnityReportEvidence(store: AtelierStore, request: Replacement, importManaged: ImportManaged, authorizeSource: (file: string) => string = file => file) {
  if (!request.id || !Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) fail('INVALID_REPORT', 'A report ID and nonnegative expectedRevision are required.');
  if (typeof request.reason !== 'string' || !request.reason.trim() || request.reason.length > 2000) fail('INVALID_REPLACEMENT_REASON', 'Replacement reason must contain 1 to 2000 characters.');
  if (typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length < 8 || request.idempotencyKey.length > 160) fail('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must contain 8 to 160 characters.');
  if (!roles.includes(request.role)) fail('INVALID_EVIDENCE_ROLE', 'Choose before, after, gif, video, beforeVideo, or afterVideo as the evidence role.');
  const evidence = await preflightReplacement(request.path, request.role, authorizeSource);
  const lookup = () => store.get('unityReport', request.id);
  const prior = lookup(); if (!prior || prior.data.deletedAt) fail('REPORT_NOT_FOUND', 'A live Unity report was not found.');
  if (request.viewId !== undefined) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(request.viewId) || !['beforeVideo','afterVideo'].includes(request.role)) fail('INVALID_VIDEO_VIEW', 'viewId replacement is available only for beforeVideo or afterVideo roles.');
    const views = Array.isArray(prior.data.videoViews) ? prior.data.videoViews as any[] : [];
    if (!views.some(view => view?.id === request.viewId)) fail('VIDEO_VIEW_NOT_FOUND', `Video view ${request.viewId} was not found on this report.`);
  }
  const fingerprint = digest(Buffer.from(JSON.stringify({ id: request.id, expectedRevision: request.expectedRevision, role: request.role, ...(request.viewId === undefined ? {} : { viewId: request.viewId }), hash: evidence.hash, reason: request.reason })));
  const priorHistory = Array.isArray(prior.data.evidenceReplacementHistory) ? prior.data.evidenceReplacementHistory as any[] : [];
  const replay = priorHistory.find(item => item.key === request.idempotencyKey);
  if (replay) {
    if (replay.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This replacement key was already used with a different payload.');
    return { report: prior, artifact: store.get('artifact', String(replay.artifactId)), replayed: true };
  }
  const lockKey = `unity-report-replace:${request.id}`, existingLock = locks.get(lockKey);
  if (existingLock) { await existingLock; return replaceUnityReportEvidence(store, request, importManaged, authorizeSource); }
  let release!: () => void; const lock = new Promise<void>(resolve => { release = resolve; }); locks.set(lockKey, lock);
  try {
    const report = lookup(); if (!report || report.data.deletedAt) fail('REPORT_NOT_FOUND', 'A live Unity report was not found.');
    const history = Array.isArray(report.data.evidenceReplacementHistory) ? report.data.evidenceReplacementHistory as any[] : [];
    const already = history.find(item => item.key === request.idempotencyKey);
    if (already) {
      if (already.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This replacement key was already used with a different payload.');
      return { report, artifact: store.get('artifact', String(already.artifactId)), replayed: true };
    }
    if (report.revision !== request.expectedRevision) fail('REVISION_CONFLICT', 'Unity report changed since this replacement was prepared.');
    const imported = await importManaged(evidence.path, `unity-evidence-replacement:${request.idempotencyKey}`), artifact = imported.find(item => item.kind === 'artifact');
    if (!artifact || artifact.data.hash !== evidence.hash) fail('EVIDENCE_CHANGED', 'Evidence bytes changed while being imported.');
    const current = lookup(); if (!current || current.data.deletedAt) fail('REPORT_NOT_FOUND', 'A live Unity report was not found.');
    if (current.revision !== request.expectedRevision) fail('REVISION_CONFLICT', 'Unity report changed while replacement evidence was imported.');
    const targetKey = `${request.role}ArtifactId`;
    const targetView = request.viewId ? (current.data.videoViews as any[]).find(view => view.id === request.viewId) : undefined;
    const previousArtifactId = targetView?.[targetKey] ? String(targetView[targetKey]) : !request.viewId && current.data[targetKey] ? String(current.data[targetKey]) : null;
    const nextMissing = { ...(current.data.missingEvidence && typeof current.data.missingEvidence === 'object' ? current.data.missingEvidence : {}) } as Record<string, unknown>;
    if (!request.viewId) delete nextMissing[request.role];
    const nextViews = request.viewId ? (current.data.videoViews as any[]).map(view => view.id !== request.viewId ? view : { ...view, [targetKey]: artifact.id, missingEvidence: { ...(view.missingEvidence || {}), [request.role]: undefined } }) : undefined;
    if (nextViews) { const view = nextViews.find(item => item.id === request.viewId); delete view.missingEvidence[request.role]; }
    const linkRole = request.viewId ? `video-view:${request.viewId}:${request.role}` : request.role;
    const entry = { role: request.role, ...(request.viewId ? { viewId: request.viewId } : {}), previousArtifactId, artifactId: artifact.id, reason: request.reason, replacedAt: new Date().toISOString(), key: request.idempotencyKey, fingerprint };
    const saved = store.transaction(() => {
      const latest = lookup(); if (!latest || latest.data.deletedAt) fail('REPORT_NOT_FOUND', 'A live Unity report was not found.');
      if (latest.revision !== request.expectedRevision) fail('REVISION_CONFLICT', 'Unity report changed while replacement evidence was imported.');
      const made = store.put({ id: latest.id, kind: 'unityReport', name: latest.name, data: { ...latest.data, ...(!request.viewId ? { [`${request.role}ArtifactId`]: artifact.id, missingEvidence: nextMissing } : { videoViews: nextViews }), evidenceReplacementHistory: [...history, entry] }, expectedRevision: latest.revision });
      store.link(made.id, artifact.id, linkRole); return made;
    });
    return { report: saved, artifact, replayed: false };
  } finally { locks.delete(lockKey); release(); }
}

function payloadFingerprint(input: Request, evidence: Awaited<ReturnType<typeof preflightEvidence>>, resolvedProjectId: string | undefined, viewEvidence: Map<string, { path: string; hash: string; facts: UnityReportVideoFacts }>) {
  const hasVideoRole = input.evidence.video !== undefined || input.missingEvidence.video !== undefined;
  const hasPairedVideo = input.evidence.beforeVideo !== undefined || input.missingEvidence.beforeVideo !== undefined || input.evidence.afterVideo !== undefined || input.missingEvidence.afterVideo !== undefined;
  const fingerprintRoles = hasPairedVideo ? roles : hasVideoRole ? roles.filter(role => role !== 'beforeVideo' && role !== 'afterVideo') : roles.filter(role => role !== 'video' && role !== 'beforeVideo' && role !== 'afterVideo');
  const payload = {
    name: input.name, summary: input.summary, unityProjectPath: path.resolve(input.unityProjectPath), projectId: input.projectId || (hasVideoRole || hasPairedVideo || input.videoViews !== undefined ? resolvedProjectId : null),
    category: input.category, checks: input.checks, taskIds: input.taskIds,
    evidence: Object.fromEntries(fingerprintRoles.map(role => [role, evidence[role]?.hash || null])), missingEvidence: input.missingEvidence,
    ...(input.videoViews === undefined ? {} : { videoViews: input.videoViews.map(view => ({ id: view.id, label: view.label, beforeVideo: viewEvidence.get(`${view.id}:beforeVideo`)?.hash || null, afterVideo: viewEvidence.get(`${view.id}:afterVideo`)?.hash || null, missingEvidence: view.missingEvidence })) }),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function priorByKey(store: AtelierStore, key: string) {
  const row = store.db.prepare("SELECT id FROM entities WHERE kind='unityReport' AND json_extract(data,'$.publishKey')=? LIMIT 1").get(key) as { id: string } | undefined;
  return row ? store.get('unityReport', row.id) : null;
}

export async function publishUnityReport(store: AtelierStore, request: Request, importManaged: ImportManaged, authorizeSource: (file: string) => string = file => file) {
  if (request.name.length < 1 || request.name.length > 240 || request.summary.length < 1 || request.summary.length > 4000) fail('INVALID_REPORT', 'Report name and summary must be within the declared limits.');
  if (!path.isAbsolute(request.unityProjectPath)) fail('INVALID_PROJECT_PATH', 'unityProjectPath must be an absolute local directory path.');
  let projectPath: string;
  try { projectPath = fs.realpathSync.native(request.unityProjectPath); } catch { fail('INVALID_PROJECT_PATH', 'Unity project directory does not exist or is unreadable.'); }
  if (!fs.statSync(projectPath).isDirectory()) fail('INVALID_PROJECT_PATH', 'unityProjectPath must point to a directory.');
  if (!categories.includes(request.category)) fail('INVALID_CATEGORY', 'Choose an existing Unity report category.');
  if (!Array.isArray(request.checks) || request.checks.some(value => typeof value !== 'string' || !value.trim() || value.length > 500)) fail('INVALID_CHECKS', 'checks must be an array of nonempty factual strings no longer than 500 characters.');
  if (!Array.isArray(request.taskIds) || new Set(request.taskIds).size !== request.taskIds.length) fail('INVALID_TASKS', 'taskIds must contain unique task UUIDs.');
  if (request.idempotencyKey.length < 8 || request.idempotencyKey.length > 160) fail('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must contain 8 to 160 characters.');
  const settings = store.settings(), projectId = request.projectId || settings.activeProjectId;
  const project = projectId ? store.get('project', projectId) : null;
  if (!project || project.data.deletedAt) fail('INVALID_PROJECT_ID', 'Selected Unity project was not found or has been deleted.');
  const tasks = request.taskIds.map(id => store.get('task', id));
  if (tasks.some(task => !task || task.data.deletedAt)) fail('INVALID_TASK_ID', 'One or more canonical task IDs were not found or have been deleted.');
  validateVideoViews(request.videoViews);
  if (request.videoViews !== undefined && (request.evidence.beforeVideo || request.evidence.afterVideo || request.evidence.video || request.missingEvidence.beforeVideo || request.missingEvidence.afterVideo || request.missingEvidence.video)) fail('AMBIGUOUS_VIDEO_EVIDENCE', 'Use either videoViews or top-level legacy video roles, not both.');
  const evidence = await preflightEvidence(request, authorizeSource), viewEvidence = await preflightVideoViews(request.videoViews, authorizeSource);
  const fingerprint = payloadFingerprint(request, evidence, project!.id, viewEvidence), prior = priorByKey(store, request.idempotencyKey);
  if (prior) {
    if (prior.data.publishFingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This publish key was already used with a different report payload.');
    return { report: prior, artifacts: [...roles.flatMap(role => { const id = prior.data[`${role}ArtifactId`]; return id ? [{ role, artifact: store.get('artifact', String(id)) }] : []; }), ...storedViewArtifacts(store, prior)], replayed: true };
  }
  const existingLock = locks.get(request.idempotencyKey);
  if (existingLock) { await existingLock; return publishUnityReport(store, request, importManaged, authorizeSource); }
  let release!: () => void;
  const lock = new Promise<void>(resolve => { release = resolve; }); locks.set(request.idempotencyKey, lock);
  try {
    const already = priorByKey(store, request.idempotencyKey);
    if (already) {
      if (already.data.publishFingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This publish key was already used with a different report payload.');
      return { report: already, artifacts: [], replayed: true };
    }
    const imported: Partial<Record<Role, Entity>> = {};
    for (const role of roles) {
      const item = evidence[role]; if (!item) continue;
      const assets = await importManaged(item.path, `unity-evidence:${request.idempotencyKey}:${role}`), artifact = assets.find(asset => asset.kind === 'artifact');
      if (!artifact || artifact.data.hash !== item.hash) fail('EVIDENCE_CHANGED', `${role} evidence bytes changed while being imported.`);
      imported[role] = artifact;
    }
    const importedViews = new Map<string, Entity>();
    for (const [key, item] of viewEvidence) {
      const assets = await importManaged(item.path, `unity-evidence:${request.idempotencyKey}:view:${key}`), artifact = assets.find(asset => asset.kind === 'artifact');
      if (!artifact || artifact.data.hash !== item.hash) fail('EVIDENCE_CHANGED', `Video view ${key} changed while being imported.`);
      importedViews.set(key, artifact);
    }
    const report = store.transaction(() => {
      if (priorByKey(store, request.idempotencyKey)) fail('IDEMPOTENCY_CONFLICT', 'This publish key was used by another publisher. Retry the exact request.');
      const data: Record<string, unknown> = {
        schemaVersion: 1, description: request.summary, unityProjectPath: projectPath, projectId: project!.id,
        category: request.category, status: 'Recorded', checks: [...request.checks], taskIds: [...request.taskIds],
        missingEvidence: { ...request.missingEvidence }, publishKey: request.idempotencyKey, publishFingerprint: fingerprint,
        evidence: [],
      };
      if (request.videoViews !== undefined) data.videoViews = request.videoViews.map(view => {
        const before = importedViews.get(`${view.id}:beforeVideo`), after = importedViews.get(`${view.id}:afterVideo`);
        return { id: view.id, label: view.label, ...(before ? { beforeVideoArtifactId: before.id } : {}), ...(after ? { afterVideoArtifactId: after.id } : {}), missingEvidence: { ...view.missingEvidence } };
      });
      for (const role of roles) if (imported[role]) data[`${role}ArtifactId`] = imported[role]!.id;
      const made = store.put({ kind: 'unityReport', name: request.name, data });
      for (const role of roles) if (imported[role]) store.link(made.id, imported[role]!.id, role);
      for (const [key, artifact] of importedViews) { const [viewId, side] = key.split(':'); store.link(made.id, artifact.id, `video-view:${viewId}:${side}`); }
      for (const taskId of request.taskIds) store.link(taskId, made.id, 'unity report');
      return made;
    });
    return { report, artifacts: [...roles.flatMap(role => imported[role] ? [{ role, artifact: imported[role] }] : []), ...[...importedViews].map(([key, artifact]) => ({ role: `videoView:${key}`, artifact }))], replayed: false };
  } finally { locks.delete(request.idempotencyKey); release(); }
}

function storedViewArtifacts(store: AtelierStore, report: Entity) {
  const views = Array.isArray(report.data.videoViews) ? report.data.videoViews as any[] : [];
  return views.flatMap(view => (['beforeVideo','afterVideo'] as const).flatMap(side => {
    const id = view[`${side}ArtifactId`];
    return id ? [{ role: `videoView:${view.id}:${side}`, artifact: store.get('artifact', String(id)) }] : [];
  }));
}

export function unityReportInput(value: unknown): Request {
  const object=(item:unknown)=>!!item&&typeof item==='object'&&!Array.isArray(item);
  if (!object(value)) fail('INVALID_REPORT', 'Report arguments must be an object.');
  const input = value as Record<string, any>, allowed = new Set(['name','summary','unityProjectPath','projectId','category','checks','taskIds','evidence','missingEvidence','videoViews','idempotencyKey']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail('INVALID_REPORT', `Unknown report field: ${key}`);
  const evidence=input.evidence===undefined?{}:input.evidence,missing=input.missingEvidence===undefined?{}:input.missingEvidence;
  if (!object(evidence)||!object(missing)) fail('INVALID_REPORT', 'evidence and missingEvidence must be objects.');
  for (const [mapName,map] of [['evidence',evidence],['missingEvidence',missing]] as const) for (const [key,item] of Object.entries(map)) {
    if (!roles.includes(key as Role)) fail('INVALID_REPORT', `Unknown ${mapName} role: ${key}`);
    if (item!==undefined&&(typeof item!=='string'||(mapName==='evidence'&&!item.trim())||(mapName==='missingEvidence'&&(!item.trim()||item.length>2000)))) fail(mapName==='evidence'?'INVALID_EVIDENCE_PATH':'INVALID_MISSING_EVIDENCE', `${mapName}.${key} must be a valid nonempty string${mapName==='missingEvidence'?' of at most 2000 characters':''}.`);
  }
  let videoViews:VideoViewRequest[]|undefined;
  if(input.videoViews!==undefined){
    if(!Array.isArray(input.videoViews)) fail('INVALID_VIDEO_VIEWS','videoViews must be an array.');
    videoViews=input.videoViews.map((view:unknown)=>{
      if(!object(view))fail('INVALID_VIDEO_VIEW','Each video view must be an object.');
      const row=view as Record<string,unknown>;
      for(const key of Object.keys(row))if(!['id','label','evidence','missingEvidence'].includes(key))fail('INVALID_VIDEO_VIEW',`Unknown video view field: ${key}`);
      const viewEvidence=row.evidence===undefined?{}:row.evidence,viewMissing=row.missingEvidence===undefined?{}:row.missingEvidence;
      if(!object(viewEvidence)||!object(viewMissing))fail('INVALID_VIDEO_VIEW','View evidence and missingEvidence must be objects.');
      for(const [mapName,map] of [['evidence',viewEvidence],['missingEvidence',viewMissing]] as const)for(const[key,item]of Object.entries(map as Record<string,unknown>)){
        if(!['beforeVideo','afterVideo'].includes(key))fail('INVALID_VIDEO_VIEW',`Unknown view ${mapName} role: ${key}`);
        if(item!==undefined&&(typeof item!=='string'||(mapName==='evidence'&&!item.trim())||(mapName==='missingEvidence'&&(!item.trim()||item.length>2000))))fail(mapName==='evidence'?'INVALID_EVIDENCE_PATH':'INVALID_MISSING_EVIDENCE',`${mapName}.${key} must be a valid nonempty string${mapName==='missingEvidence'?' of at most 2000 characters':''}.`);
      }
      return{id:row.id,label:row.label,evidence:viewEvidence,missingEvidence:viewMissing} as VideoViewRequest;
    });
    validateVideoViews(videoViews);
  }
  return {name:input.name,summary:input.summary,unityProjectPath:input.unityProjectPath,projectId:input.projectId,category:input.category,checks:input.checks,taskIds:input.taskIds,evidence,missingEvidence:missing,...(videoViews===undefined?{}:{videoViews}),idempotencyKey:input.idempotencyKey};
}
