/** Anatomical compatibility keys are stable; all other texture groups are agent-defined. */
export const BASE_GROUP_KEYS = ['head', 'hair', 'upper_body', 'lower_body', 'accessories'] as const;
export const MAX_TEXTURE_GROUPS = 48;
export const SURFACE_MODES = ['inventory', 'inspect-components', 'prepare-groups', 'repartition-groups', 'assemble-returns', 'rig-source', 'restore-rig-materials'] as const;
export type SurfaceMode = typeof SURFACE_MODES[number];
export type GroupDefinition = {key: string; name: string};
export type ComponentAssignment = {componentId: string; group: string};
export function isTextureGroupKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(value)
    && !['body', 'assembled', 'rig', 'constructor', 'prototype', '__proto__'].includes(value)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(value);
}
export const isSurfaceSource = (value: unknown): value is string => ['head', 'body', 'assembled', 'rig'].includes(String(value)) || isTextureGroupKey(value);
export function validateGroupDefinitions(assignments: readonly ComponentAssignment[], definitions: readonly GroupDefinition[] = []): void {
  const keys = new Set(assignments.map(row => row.group));
  if (!keys.size || keys.size > MAX_TEXTURE_GROUPS || [...keys].some(key => !isTextureGroupKey(key))) throw new Error('Use bounded, filesystem-safe group identities.');
  const named = new Set<string>();
  for (const item of definitions) {
    if (!isTextureGroupKey(item.key) || named.has(item.key) || !keys.has(item.key) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 || /[\u0000-\u001f]/.test(item.name)) throw new Error('Group definitions must have unique used keys and readable names.');
    named.add(item.key);
  }
  if ([...keys].some(key => !BASE_GROUP_KEYS.includes(key as any) && !named.has(key))) throw new Error('Each agent-defined group requires its own name in groupDefinitions.');
}
export function textureGroupLabel(key: string, groups: readonly {key: string; name?: string}[], locale: 'en' | 'ru'): string {
  const custom = groups.find(group => group.key === key)?.name;
  if (custom) return custom;
  const labels: Record<string, [string, string]> = {head: ['Head', 'Голова'], hair: ['Hair', 'Волосы'], upper_body: ['Upper body', 'Верх тела'], lower_body: ['Lower body', 'Низ тела'], accessories: ['Accessories', 'Аксессуары']};
  return labels[key]?.[locale === 'ru' ? 1 : 0] || key;
}
