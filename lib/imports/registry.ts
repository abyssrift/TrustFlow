import type { ImporterAdapter } from './types';

const registry = new Map<string, ImporterAdapter>();

export function registerImporter(adapter: ImporterAdapter) {
  const id = adapter.manifest.id;
  if (registry.has(id)) {
    console.warn(`[imports] Adapter "${id}" already registered — skipping duplicate`);
    return;
  }
  registry.set(id, adapter);
}

export function getImporter(id: string): ImporterAdapter | undefined {
  return registry.get(id);
}

export function listImporters(): ImporterAdapter[] {
  return Array.from(registry.values());
}
