import { getStringValue, getObjectValue } from './bodyNormalizer';
import type { StepOption } from '../shared/types';

export function extractStepOption(item: unknown): StepOption | null {
  if (typeof item === 'string' && item.trim()) {
    const value = item.trim();
    return { name: value, path: value };
  }

  const safeItem = getObjectValue(item);
  if (!safeItem) return null;

  const pathCandidates = [
    safeItem.step,
    safeItem.path,
    safeItem.initialStep,
    safeItem.url,
    safeItem.id,
  ];

  let path: string | null = null;
  for (const candidate of pathCandidates) {
    const value = getStringValue(candidate);
    if (value) { path = value; break; }
  }

  if (!path) return null;

  const nameCandidates = [safeItem.name, safeItem.label, safeItem.title, safeItem.intent];
  let name: string | null = null;
  for (const candidate of nameCandidates) {
    const value = getStringValue(candidate);
    if (value) { name = value; break; }
  }

  return { name: name || path, path };
}

export function extractStepsFromPayload(payload: unknown): StepOption[] {
  const readFromArray = (items: unknown[]): StepOption[] =>
    items.map(extractStepOption).filter((v): v is StepOption => Boolean(v));

  const dedupeByPath = (items: StepOption[]): StepOption[] => {
    const map = new Map<string, StepOption>();
    for (const item of items) {
      if (!map.has(item.path)) map.set(item.path, item);
    }
    return Array.from(map.values());
  };

  if (Array.isArray(payload)) return dedupeByPath(readFromArray(payload));

  const safePayload = getObjectValue(payload);
  if (!safePayload) return [];

  for (const candidate of [safePayload.steps, safePayload.items, safePayload.data]) {
    if (Array.isArray(candidate)) return dedupeByPath(readFromArray(candidate));
  }

  return [];
}
