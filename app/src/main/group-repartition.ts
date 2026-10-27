export const PARTITION_STALE_REASON = 'The component partition changed; rebuild this dependent output from its current group.';

/** Paint approval belongs to the image; a changed mesh is a review notice, not a revoked human decision. */
export function recoverPartitionPaintApprovals(g: any) {
  for (const slot of g.slots || []) {
    if (slot.purpose !== 'texture-references' || slot.retiredGroup || slot.invalidatedByCorrection
      || !['invalidated','pending'].includes(slot.reviewStatus)
      || !(g.groups || []).some((group: any) => group.present !== false && group.key === slot.group)) continue;
    const candidate = (slot.candidates || []).find((row: any) => row.id === slot.candidateId);
    if (!candidate || candidate.artifactId !== slot.artifactId || candidate.hash !== slot.hash) continue;
    let reviewed = candidate;
    const seen = new Set<string>();
    while (reviewed?.reviewStatus === 'pending' && reviewed.restoredFrom && !seen.has(reviewed.id)) {
      seen.add(reviewed.id);
      reviewed = (slot.candidates || []).find((row: any) => row.id === reviewed.restoredFrom && row.artifactId === candidate.artifactId && row.hash === candidate.hash);
    }
    if (!reviewed || reviewed.reviewStatus !== 'invalidated' || reviewed.invalidatedReason !== PARTITION_STALE_REASON
      || reviewed.reviewedBy !== 'human' || !reviewed.reviewedAt || !reviewed.invalidatedByPartitionOperationId
      || candidate === reviewed && slot.invalidatedReason !== PARTITION_STALE_REASON) continue;
    slot.groupChangeNotice = {operationId: reviewed.invalidatedByPartitionOperationId, previousInvalidationAt: reviewed.invalidatedAt, retainedHumanApproval: true};
    const history = {operationId: reviewed.invalidatedByPartitionOperationId, at: reviewed.invalidatedAt, reason: reviewed.invalidatedReason};
    candidate.partitionInvalidationHistory = [...(candidate.partitionInvalidationHistory || []), history];
    candidate.reviewStatus = slot.reviewStatus = 'accepted';
    candidate.reviewedBy = 'human'; candidate.reviewedAt = reviewed.reviewedAt;
    if (candidate !== reviewed) candidate.carriedApprovalFrom = reviewed.id;
    for (const item of [slot, candidate]) for (const key of ['invalidatedAt', 'invalidatedReason', 'invalidatedByPartitionOperationId']) delete item[key];
  }
}

/** Keep old versions and adopted paint; invalidate changed geometry-dependent outputs. */
export function prepareGroupRepartition(g: any, nextGroups: any[], operationId: string) {
  const old = (g.groups || []).filter((row: any) => row.present !== false);
  const byKey = new Map<string, any>(nextGroups.map(row => [row.id, row]));
  const same = (a: any, b: any) => !!a && !!b && b.baselineSurfaceUnchanged !== false && a.source === b.source
    && JSON.stringify([...(a.componentIds || [])].sort()) === JSON.stringify([...(b.componentIds || [])].sort());
  const changed = new Set<string>();
  for (const previous of old) if (!same(previous, byKey.get(previous.key))) changed.add(previous.key);
  for (const next of nextGroups) if (!same(old.find((row: any) => row.key === next.id), next)) changed.add(next.id);
  const at = new Date().toISOString();
  const reason = PARTITION_STALE_REASON;
  g.groupPartitionHistory ||= [];
  g.groupPartitionHistory.push({operationId, at, previousStep: g.currentStepKey, groups: structuredClone(old), changedGroups: [...changed],
    slots: g.slots.filter((slot: any) => ['prepare-groups', 'texture-references', 'receive-materials', 'export-rig-source', 'rig-manual', 'receive-rig', 'texture-repair', 'weight-cleanup', 'finish'].includes(slot.stepKey))
      .map((slot: any) => ({key: slot.key, group: slot.group, artifactId: slot.artifactId, hash: slot.hash, candidateId: slot.candidateId, reviewStatus: slot.reviewStatus}))});
  for (const slot of g.slots) {
    const group = slot.group || old.find((row: any) => ['group-model-', 'texture-guide-', 'texture-reference-', 'texture-handoff-', 'texture-return-'].some(prefix => slot.key === prefix + row.key || slot.key === prefix + row.key + '-front' || slot.key === prefix + row.key + '-back'))?.key;
    const groupChanged = !!group && changed.has(group);
    const assembledDescendant = changed.size > 0 && !group && ['receive-materials', 'export-rig-source', 'rig-manual', 'receive-rig', 'texture-repair', 'weight-cleanup', 'finish'].includes(slot.stepKey);
    if (group && !byKey.has(group)) {slot.retiredGroup = true; slot.required = false;}
    else if (group) {delete slot.retiredGroup; slot.required = true;}
    if (groupChanged && byKey.has(group) && slot.purpose === 'texture-references') {
      if (slot.artifactId) slot.groupChangeNotice = {operationId, changedAt: at, retainedHumanApproval: slot.reviewStatus === 'accepted'};
      continue;
    }
    if ((groupChanged || assembledDescendant) && slot.artifactId) {
      const active = (slot.candidates || []).find((row: any) => row.id === slot.candidateId);
      if (active && !['invalidated', 'rejected'].includes(active.reviewStatus)) Object.assign(active, {reviewStatus: 'invalidated', invalidatedAt: at, invalidatedReason: reason, invalidatedByPartitionOperationId: operationId});
      Object.assign(slot, {reviewStatus: 'invalidated', invalidatedReason: reason, invalidatedByPartitionOperationId: operationId});
    }
  }
  if (changed.size) {
    for (const name of ['surfaceMapping', 'geometryBaseline', 'rigProof', 'textureRepair', 'riggedModelAudit', 'weightCleanup', 'finalChecks']) {
      if (g[name] && typeof g[name] === 'object') g[name] = {...g[name], current: false, ...('passed' in g[name] ? {passed: false} : {}), ...('auditPassed' in g[name] ? {auditPassed: false} : {}), invalidatedByPartitionOperationId: operationId};
    }
    g.completedStepKeys = (g.completedStepKeys || []).filter((key: string) => ['source', 'views', 'review-images', 'generate-mesh', 'receive-mesh', 'segment-mesh', 'receive-segments'].includes(key));
    g.currentStepKey = 'prepare-groups';
    g.manualRigContinue = false;
  }
  return {changed, unchanged: new Set(nextGroups.filter(row => !changed.has(row.id)).map(row => row.id))};
}
