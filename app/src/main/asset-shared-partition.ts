import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type AssetPartitionStore = {
  get: (kind: 'artifact', id: string) => any;
  dependencies: (artifactId: string) => Array<{ hash: string; logicalPath: string; role: string }>;
  object: (hash: string) => string | null | undefined;
};

type SharedPartitionLineage = {
  sharedSourceId: string;
  sharedSourceArtifactId: string;
  sharedSourceHash: string;
  sheetArtifactId: string;
  sheetHash: string;
  sheetInputFingerprint: string;
  partitionReportHash: string;
  meshObjectCount: number | null;
};

function humanAccepted(candidate: any): boolean {
  return candidate?.status === 'accepted'
    && candidate.reviewedBy === 'human'
    && typeof candidate.artifactId === 'string'
    && typeof candidate.hash === 'string';
}

/** Returns lineage only when this shared-prop model is a current, reviewed partition of its accepted sheet source. */
export function currentAcceptedSharedPartition(store: AssetPartitionStore, workflow: any, item: any, current: any): SharedPartitionLineage | null {
  if (item?.data?.route !== 'shared-prop' || !current || current.geometryNeedsReview || !humanAccepted(current.geometry)) return null;

  const geometry = current.geometry;
  const geometrySlot = workflow?.data?.slots?.find((slot: any) => slot.itemId === item.id && slot.role === 'geometry');
  const acceptedGeometry = geometrySlot?.candidates?.find((candidate: any) => candidate.id === geometry.id);
  if (geometrySlot?.acceptedCandidateId !== geometry.id || !humanAccepted(acceptedGeometry) || acceptedGeometry.hash !== geometry.hash || acceptedGeometry.artifactId !== geometry.artifactId || geometry.inputFingerprint !== current.geometryInputFingerprint) return null;

  const sheet = current.sheets?.find((value: any) => value.fresh === true && value.accepted === true && humanAccepted(value.candidate) && value.candidate.hash === value.hash && value.candidate.artifactId === value.artifactId);
  if (!sheet || geometry.dependsOnSheetHash !== sheet.hash) return null;

  const sharedSource = workflow?.data?.sharedSources?.find((value: any) => value.status === 'accepted'
    && value.reviewedBy === 'human'
    && value.sheetArtifactId === sheet.artifactId
    && value.sheetHash === sheet.hash
    && value.sheetInputFingerprint === current.sharedSheetInputFingerprint
    && value.members?.some((member: any) => member.itemId === item.id));
  if (!sharedSource || typeof sharedSource.sheetInputFingerprint !== 'string') return null;

  const sourceArtifact = store.get('artifact', sharedSource.artifactId);
  if (!sourceArtifact || sourceArtifact.data?.parentId !== item.data.jobId || sourceArtifact.data?.hash !== sharedSource.hash) return null;
  const partition = store.get('artifact', geometry.artifactId);
  if (!partition || partition.data?.parentId !== item.id || partition.data?.hash !== geometry.hash) return null;

  const dependencies = store.dependencies(partition.id);
  const sourceDependency = dependencies.find(value => value.role === 'partition-source' && value.hash === sharedSource.hash);
  const reportDependency = dependencies.find(value => value.role === 'provenance' && value.logicalPath === 'partition-report.json');
  if (!sourceDependency || !reportDependency) return null;
  const reportFile = store.object(reportDependency.hash);
  if (!reportFile || !fs.existsSync(reportFile) || fs.lstatSync(reportFile).isSymbolicLink() || fs.realpathSync.native(reportFile) !== path.resolve(reportFile) || fs.statSync(reportFile).size > 4 * 1024 * 1024) return null;
  const reportBytes = fs.readFileSync(reportFile);
  if (crypto.createHash('sha256').update(reportBytes).digest('hex') !== reportDependency.hash) return null;
  let report: any;
  try { report = JSON.parse(reportBytes.toString('utf8')); } catch { return null; }
  if (report?.schemaVersion !== 1 || report.mode !== 'partition' || report.ok !== true || report.sourceHash !== sharedSource.hash
    || !Array.isArray(report.outputs)) return null;
  const output = report.outputs.find((value: any) => value.group === item.id && value.format === 'fbx' && value.hash === geometry.hash);
  if (!output) return null;
  const meshObjectCount = Number.isInteger(output.meshObjectCount) && output.meshObjectCount > 0 ? output.meshObjectCount : null;

  return {
    sharedSourceId: sharedSource.id,
    sharedSourceArtifactId: sharedSource.artifactId,
    sharedSourceHash: sharedSource.hash,
    sheetArtifactId: sheet.artifactId,
    sheetHash: sheet.hash,
    sheetInputFingerprint: sharedSource.sheetInputFingerprint,
    partitionReportHash: reportDependency.hash,
    meshObjectCount,
  };
}
