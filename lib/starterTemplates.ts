/**
 * Database-catalog adapter for recommended project starters.
 *
 * The platform catalog is the authority for starter content. This module only
 * owns the shape used by the picker and deliberately contains no built-in
 * template rows, tenant IDs, pipeline IDs, or team IDs.
 */

export type StarterPriority = 'urgent' | 'high' | 'medium' | 'low';

export type StarterTaskItem = {
  title: string;
  description: string;
  category: string;
  priority: StarterPriority;
  /** 1-10, mirrors the tasks weight constraint. */
  weight: number;
  estimated_hours: number;
  /** Days from project start_date. Omitted for open-ended work. */
  due_offset_days?: number;
};

export type StarterTemplate = {
  /** Semantic catalog payload key, not a database row ID. */
  id: string;
  catalogKey: string;
  catalogVersion: number;
  sector: string;
  name: string;
  description: string;
  color: string;
  tasks: StarterTaskItem[];
};

export type CatalogStarterRow = {
  catalog_key: string;
  version: number;
  payload: unknown;
};

export type CatalogStarterHead = {
  catalog_key: string;
  published_version: number | null;
};

export function publishedCatalogStarterRows(
  rows: CatalogStarterRow[],
  heads: CatalogStarterHead[],
): CatalogStarterRow[] {
  const published = new Map(
    heads.map((head) => [head.catalog_key, head.published_version]),
  );
  return rows.filter((row) => published.get(row.catalog_key) === row.version);
}

function priority(value: unknown): StarterPriority {
  return value === 'urgent' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function taskFromCatalog(value: any): StarterTaskItem | null {
  if (!value || typeof value.title !== 'string' || !value.title.trim()) return null;
  const due = typeof value.due_offset_days === 'number' ? value.due_offset_days : undefined;
  return {
    title: value.title.trim(),
    description: typeof value.description === 'string' ? value.description : '',
    category: typeof value.category === 'string' && value.category.trim() ? value.category : 'General',
    priority: priority(value.priority),
    weight: typeof value.weight === 'number' ? value.weight : 1,
    estimated_hours: typeof value.estimated_hours === 'number' ? value.estimated_hours : 0,
    ...(due == null ? {} : { due_offset_days: due }),
  };
}

/** Normalize one catalog row payload into picker data. */
export function starterTemplatesFromCatalogPayload(
  payload: unknown,
  catalogKey: string,
  catalogVersion: number,
): StarterTemplate[] {
  const candidates = Array.isArray((payload as any)?.templates)
    ? (payload as any).templates
    : [payload];

  return candidates.flatMap((value: any) => {
    if (!value || typeof value.id !== 'string' || typeof value.name !== 'string') return [];
    const tasks = Array.isArray(value.tasks)
      ? value.tasks.map(taskFromCatalog).filter(Boolean) as StarterTaskItem[]
      : [];
    if (tasks.length === 0) return [];
    return [{
      id: value.id,
      catalogKey,
      catalogVersion,
      sector: typeof value.sector === 'string' && value.sector.trim() ? value.sector : 'General',
      name: value.name,
      description: typeof value.description === 'string' ? value.description : '',
      color: typeof value.color === 'string' ? value.color : '#6366F1',
      tasks,
    }];
  });
}

/** Group catalog-backed templates by sector in their catalog order. */
export function starterTemplatesBySector(templates: StarterTemplate[] = []): Array<[string, StarterTemplate[]]> {
  const map = new Map<string, StarterTemplate[]>();
  for (const template of templates) {
    const list = map.get(template.sector) ?? [];
    list.push(template);
    map.set(template.sector, list);
  }
  return [...map.entries()];
}
