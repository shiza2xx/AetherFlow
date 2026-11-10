export type AssetUiLocale = 'en' | 'ru';

export function assetPhotoRoleLabel(role: string, locale: AssetUiLocale): string {
  const [kind, view] = role.split(':');
  const viewLabels: Record<string, [string, string]> = {
    front: ['front', 'спереди'], back: ['back', 'сзади'], side: ['side', 'сбоку'], top: ['top', 'сверху'],
  };
  if (role === 'sheet') return locale === 'ru' ? 'Общий лист геометрии' : 'Shared geometry sheet';
  if (role === 'item') return locale === 'ru' ? 'Деталь' : 'Item';
  const kindLabels: Record<string, [string, string]> = {
    image: ['Color', 'Цвет'], depth: ['Depth map', 'Карта глубины'], foliage: ['Foliage', 'Листва'],
  };
  const kindLabel = kindLabels[kind], viewLabel = viewLabels[view];
  if (!kindLabel || !viewLabel) return locale === 'ru' ? 'Другой ракурс' : 'Other view';
  return locale === 'ru' ? `${kindLabel[1]} · ${viewLabel[1]}` : `${kindLabel[0]} · ${viewLabel[0]}`;
}

export function assetPhotoWaitingReason(reason: string, locale: AssetUiLocale): string {
  const normalized = String(reason || '').toLowerCase();
  if (/awaiting human review|awaiting review|pending/.test(normalized)) return locale === 'ru' ? 'Текущий вариант ожидает проверки.' : 'The current view is awaiting review.';
  if (/stale|outdated|old or stale/.test(normalized)) return locale === 'ru' ? 'Этот принятый вид устарел. Примите актуальный источник и экспортируйте снова.' : 'This accepted view is outdated. Accept a current source, then export again.';
  if (/shared sheet|sheet mapping|sheet does not map|geometry sheet/.test(normalized)) return locale === 'ru' ? 'Нужен актуальный общий лист геометрии с целой картой сопоставления.' : 'A current shared geometry sheet and its mapping are required.';
  if (/no longer in the active catalog/.test(normalized)) return locale === 'ru' ? 'Этой детали уже нет в активном составе.' : 'This item is no longer in the active catalog.';
  if (/artifact.*missing|corrupt|saved hash|hash changed/.test(normalized)) return locale === 'ru' ? 'Файл принятого изображения отсутствует или его контрольная сумма изменилась.' : 'The accepted image file is missing or its saved hash changed.';
  if (/depth|depth-map/.test(normalized)) return locale === 'ru' ? 'Примите актуальную карту глубины, связанную с цветным видом.' : 'Accept a current depth map paired with its color view.';
  if (/color|image/.test(normalized)) return locale === 'ru' ? 'Примите актуальную цветную фотографию этого ракурса.' : 'Accept a current color photo for this view.';
  return locale === 'ru' ? 'Проверьте этот ракурс перед экспортом.' : 'Review this view before exporting.';
}

export type AssetTexturingHandoffEntry = { itemId: string; itemName: string; role: string; path: string; artifactId: string; hash: string };
export type AssetTexturingHandoffGroup = { itemId: string; itemName: string; model: AssetTexturingHandoffEntry | null; colorReferences: AssetTexturingHandoffEntry[] };

/** Groups the verified handoff receipt by its real item owner; unknown roles are not presented as texture inputs. */
export function assetTexturingHandoffGroups(entries: AssetTexturingHandoffEntry[] | undefined): AssetTexturingHandoffGroup[] {
  const groups = new Map<string, AssetTexturingHandoffGroup>();
  for (const entry of entries || []) {
    if (!entry?.itemId || !entry.itemName || !entry.path || !entry.artifactId || !/^[a-f0-9]{64}$/.test(entry.hash)) continue;
    let group = groups.get(entry.itemId);
    if (!group) {
      group = { itemId: entry.itemId, itemName: entry.itemName, model: null, colorReferences: [] };
      groups.set(entry.itemId, group);
    }
    if (entry.role === 'geometry') group.model = entry;
    else if (/^image:(front|side|back|top)$/.test(entry.role)) group.colorReferences.push(entry);
  }
  return [...groups.values()].filter(group => group.model || group.colorReferences.length > 0);
}

export function assetTexturingHandoffWaitingReason(reason: string, locale: AssetUiLocale): string {
  const normalized = String(reason || '').toLowerCase();
  if (/foliage/.test(normalized)) return locale === 'ru' ? 'Листва использует локальные карточки, а не Tripo.' : 'Foliage uses local cards, not Tripo.';
  if (/partition|separated|shared sheet/.test(normalized)) return locale === 'ru' ? 'Примите актуальную разделённую модель из принятого общего листа геометрии.' : 'Accept the current partitioned prop from the accepted shared geometry sheet.';
  if (/geometry/.test(normalized)) return locale === 'ru' ? 'Примите актуальную модель этого разделённого объекта и отправьте её на проверку.' : 'Accept this separated prop’s current model and review it.';
  if (/front color|color reference/.test(normalized)) return locale === 'ru' ? 'Примите актуальный цветной референс спереди для этой детали.' : 'Accept a current front color reference for this item.';
  if (/no items are currently eligible/.test(normalized)) return locale === 'ru' ? 'Пока нет деталей с актуальной принятой геометрией и цветными референсами.' : 'No items have both current accepted geometry and color references yet.';
  return locale === 'ru' ? 'Проверьте актуальную геометрию и цветные референсы этой детали.' : 'Check this item’s current geometry and color references.';
}

export function hasExistingAssetReturnModels(workflow: any): boolean {
  if ((workflow?.data?.sharedSources || []).length > 0) return true;
  return (workflow?.data?.slots || []).some((slot: any) => ['geometry', 'material'].includes(slot.role) && (slot.candidates || []).length > 0);
}

export function hasAssetPhotoFiles(exported: any): boolean {
  const entries = Array.isArray(exported?.receipt?.entries) ? exported.receipt.entries : Array.isArray(exported?.entries) ? exported.entries : [];
  return entries.some((entry: any) => typeof entry?.path === 'string' && entry.path.length > 0 && typeof entry?.hash === 'string' && entry.hash.length > 0);
}

export function shouldShowAssetReturnWorkflow(exported: any, workflow: any): boolean {
  const successfulCurrentExport = typeof exported?.operationId === 'string' && exported.operationId.length > 0 && exported.current === true && ['ready', 'partial'].includes(exported.status) && hasAssetPhotoFiles(exported);
  return successfulCurrentExport || hasExistingAssetReturnModels(workflow);
}

export function assetStage4ReturnSections(items: any[], available: boolean) {
  const solid = (items || []).filter((item: any) => item?.data?.route !== 'foliage');
  const shared = solid.filter((item: any) => item?.data?.route === 'shared-prop');
  return {
    individualGeometry: available && solid.some((item: any) => item.data.route !== 'shared-prop'),
    sharedGeometry: available && shared.length > 0,
    textureReturns: available && shared.length > 0,
  };
}

export type AssetGeometryProgressStep = { id: 'photos' | 'individual' | 'shared-geometry' | 'shared-textures' | 'foliage' | 'additional-review'; title: string; done: boolean; optional?: boolean };

/** Returns only work that exists in this job; status is derived from current accepted revisions. */
export function assetGeometryProgressSteps(ctx: any, exported: any): AssetGeometryProgressStep[] {
  const items = ctx?.items || [], current = ctx?.current || [], slots = ctx?.workflow?.data?.slots || [];
  const stateFor = (id: string) => current.find((value: any) => value.itemId === id);
  const solid = items.filter((item: any) => item.data.route !== 'foliage');
  const individual = solid.filter((item: any) => item.data.route !== 'shared-prop');
  const shared = solid.filter((item: any) => item.data.route === 'shared-prop');
  const foliage = items.filter((item: any) => item.data.route === 'foliage');
  const acceptedGeometry = (item: any) => { const state = stateFor(item.id); return !!state?.geometry && !state.geometryNeedsReview; };
  const additionalReview = slots.some((slot: any) => ['material', 'material-reference:front', 'guide:front'].includes(slot.role) && (slot.candidates || []).some((candidate: any) => candidate.status === 'pending' || slot.role === 'material-reference:front' && candidate.id === slot.acceptedCandidateId && candidate.status === 'accepted' && candidate.inputFingerprint && current.find((state: any) => state.itemId === slot.itemId)?.materialInputFingerprint && candidate.inputFingerprint !== current.find((state: any) => state.itemId === slot.itemId)?.materialInputFingerprint)) ||
    current.some((state: any) => state.materialNeedsCompatibilityReview || state.guideNeedsReview);
  const completedExport = exported?.current === true && exported.status === 'ready' && hasAssetPhotoFiles(exported) && !(exported.receipt?.waiting || []).length;
  const steps: AssetGeometryProgressStep[] = [];
  if (solid.length) steps.push({ id: 'photos', title: 'Photos', done: completedExport });
  if (individual.length) steps.push({ id: 'individual', title: 'Individual models', done: individual.every(acceptedGeometry) });
  if (shared.length) {
    steps.push({ id: 'shared-geometry', title: 'Shared partitions', done: shared.every((item: any) => acceptedGeometry(item) && stateFor(item.id)?.sharedPartitionReady === true) });
    steps.push({ id: 'shared-textures', title: 'Shared textures', done: shared.every((item: any) => { const state = stateFor(item.id); return state?.sharedPartitionReady === true && !!state.material && !state.materialNeedsCompatibilityReview && !state.geometryNeedsReview && !state.imagesNeedReview; }) });
  }
  if (foliage.length) steps.push({ id: 'foliage', title: 'Foliage cards', done: foliage.every(acceptedGeometry) });
  if (additionalReview) steps.push({ id: 'additional-review', title: 'Additional reviews', done: false, optional: true });
  return steps;
}
