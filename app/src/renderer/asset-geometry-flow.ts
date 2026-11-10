import { assetViewsForRoute } from '../shared/asset-production';

export type AssetGeometryStep = { item: any; state: any; role: string; photo: { role: string; candidate: any } | null; displayPhoto: { role: string; candidate: any } | null; pending: any | null; accepted: boolean; canImport: boolean; geometryReady?: boolean };

function humanAccepted(candidate: any): boolean {
  return candidate?.status === 'accepted' && candidate.reviewedBy === 'human' && typeof candidate.artifactId === 'string' && typeof candidate.hash === 'string';
}

function acceptedReference(rows: any[], role: string, state: any) {
  const alias = role === 'image:front' ? 'image' : role === 'depth:front' ? 'depth' : null;
  const candidate = rows?.find((entry: any) => entry.role === role)?.candidate || (alias ? rows?.find((entry: any) => entry.role === alias)?.candidate : null);
  if (!humanAccepted(candidate) || !state?.imageInputFingerprints?.includes(candidate.inputFingerprint)) return null;
  return { role, candidate };
}

export function currentAssetPhoto(item: any, state: any, view = 'front', kind: 'geometry' | 'color' = 'geometry') {
  if (!item || !state) return null;
  if (item.data.route === 'foliage') return acceptedReference(state.images, `foliage:${view}`, state);
  if (kind === 'color') return acceptedReference(state.images, `image:${view}`, state);
  if (item.data.route === 'shared-prop') return null;
  if (item.data.depthEnabled === true) {
    const depth = acceptedReference(state.depths, `depth:${view}`, state), color = acceptedReference(state.images, `image:${view}`, state);
    return depth && color && depth.candidate.dependsOnColorHash === color.candidate.hash ? depth : null;
  }
  return acceptedReference(state.images, `image:${view}`, state);
}

function slotCandidate(workflow: any, itemId: string, role: string, status: 'pending' | 'accepted') {
  const slot = workflow?.data?.slots?.find((value: any) => value.itemId === itemId && value.role === role);
  return slot?.candidates?.filter((candidate: any) => candidate.status === status).sort((a: any, b: any) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0] || null;
}

function reviewCurrent(candidate: any, fingerprint: string | undefined) {
  return candidate?.status === 'pending' && !!fingerprint && candidate.inputFingerprint === fingerprint;
}

export function assetGeometryStep(item: any, state: any, workflow: any) {
  const shared = item?.data?.route === 'shared-prop';
  const role = item?.data?.depthEnabled ? 'depth:front' : 'image:front';
  const photo = shared ? null : currentAssetPhoto(item, state, 'front');
  const displayPhoto = currentAssetPhoto(item, state, 'front', 'color');
  const pending = slotCandidate(workflow, item?.id, 'geometry', 'pending');
  const currentPending = reviewCurrent(pending, state?.geometryInputFingerprint);
  const accepted = humanAccepted(state?.geometry) && !state?.geometryNeedsReview && (shared || !!photo);
  return { item, state, role, photo, displayPhoto, pending: currentPending ? pending : null, accepted, canImport: !shared && !!photo && !currentPending };
}

export function assetTextureStep(item: any, state: any, workflow: any) {
  const shared = item?.data?.route === 'shared-prop';
  const photo = shared ? currentAssetPhoto(item, state, 'front', 'color') : null;
  const pending = slotCandidate(workflow, item?.id, 'material', 'pending');
  const currentPending = reviewCurrent(pending, state?.materialInputFingerprint);
  const geometryReady = shared && state?.sharedPartitionReady === true && humanAccepted(state?.geometry) && !state?.geometryNeedsReview;
  const accepted = geometryReady && humanAccepted(state?.material) && !state?.materialNeedsCompatibilityReview && !state?.imagesNeedReview && !!photo;
  return { item, state, photo, displayPhoto: photo, pending: currentPending ? pending : null, accepted, geometryReady, canImport: geometryReady && !!photo && !currentPending && !accepted };
}

export function assetGeometryStages(ctx: any) {
  const items = ctx?.items || [], current = ctx?.current || [], workflow = ctx?.workflow;
  const stateFor = (itemId: string) => current.find((value: any) => value.itemId === itemId);
  const solid = items.filter((item: any) => item.data.route !== 'foliage');
  const individual = solid.filter((item: any) => item.data.route !== 'shared-prop');
  const shared = solid.filter((item: any) => item.data.route === 'shared-prop');
  const geometry = individual.map((item: any) => assetGeometryStep(item, stateFor(item.id), workflow));
  const sharedGeometry = shared.map((item: any) => assetGeometryStep(item, stateFor(item.id), workflow));
  const texturing = shared.map((item: any) => assetTextureStep(item, stateFor(item.id), workflow));
  const individualReady = geometry.every((step: any) => step.accepted);
  const allGeometryReady = [...geometry, ...sharedGeometry].every((step: any) => step.accepted);
  const sharedSheetReady = shared.length > 0 && shared.every((item: any) => {
    const state = stateFor(item.id);
    return state?.sharedSheetSource?.state === 'ready' && state?.sheets?.some((sheet: any) => sheet.fresh && sheet.accepted && humanAccepted(sheet.candidate));
  });
  return { solid, individual, shared, geometry, sharedGeometry, texturing, individualReady, allGeometryReady, sharedSheetReady };
}
