/** Stable, renderer-neutral filter values shared by the archive views. */
export type ArchiveEntityFilter = 'all' | 'task' | 'project';
export type ArchiveStatusFilter = 'all' | 'archived' | 'restored' | 'conflict';
export type ArchiveStatus = Exclude<ArchiveStatusFilter, 'all'>;

/** The only live schema information needed to validate a restore destination. */
export interface ArchiveSchema {
  pipelineIds: ReadonlySet<string>;
  stageIds: ReadonlySet<string>;
}

/** Minimal shape of the persisted archive snapshot used by both renderers. */
export interface ArchiveSnapshot {
  pipeline_id?: string | null;
  project?: { pipeline_id?: string | null } | null;
  task?: { current_stage_id?: string | null } | null;
}

/** Structural archive row; renderers can add their own metadata and fields. */
export interface ArchiveRecord {
  id: string;
  entity_type: 'task' | 'project';
  snapshot?: ArchiveSnapshot | null;
  restored_at?: string | null;
}

export interface ArchiveFilters {
  entity: ArchiveEntityFilter;
  status: ArchiveStatusFilter;
}

export interface ArchiveCounts {
  total: number;
  task: number;
  project: number;
  archived: number;
  restored: number;
  conflict: number;
}

export interface ArchiveEmptyState {
  title: string;
  body: string;
  actionLabel: string;
}

export type ArchiveEmptyStateDecision =
  | ({ action: 'clear-search' } & ArchiveEmptyState)
  | ({ action: 'clear-filters' } & ArchiveEmptyState)
  | ({ action: 'view-active-work' } & ArchiveEmptyState);

/** Return why restore cannot use an archive's original pipeline or stage. */
export function getArchiveIntegrityIssue(
  archive: ArchiveRecord,
  schema: ArchiveSchema,
): string | null {
  // A successfully restored record is historical evidence, not a restore conflict.
  if (archive.restored_at) return null;

  if (archive.entity_type === 'project') {
    const pipelineId = archive.snapshot?.project?.pipeline_id ?? archive.snapshot?.pipeline_id;
    if (!pipelineId || !schema.pipelineIds.has(pipelineId)) {
      return 'The original pipeline is missing. Restore is unavailable because destination remapping is not supported yet.';
    }
  }

  if (archive.entity_type === 'task') {
    const stageId = archive.snapshot?.task?.current_stage_id;
    if (!stageId || !schema.stageIds.has(stageId)) {
      return 'The original stage is missing. Restore is unavailable because destination remapping is not supported yet.';
    }
  }

  return null;
}

/** Classify a row, giving restored state precedence over integrity conflicts. */
export function getArchiveStatus(archive: ArchiveRecord, schema: ArchiveSchema): ArchiveStatus {
  if (archive.restored_at) return 'restored';
  return getArchiveIntegrityIssue(archive, schema) ? 'conflict' : 'archived';
}

/** Filter without changing the caller's archive collection. */
export function filterArchives<T extends ArchiveRecord>(
  archives: readonly T[],
  filters: ArchiveFilters,
  schema: ArchiveSchema,
): T[] {
  return archives.filter((archive) =>
    (filters.entity === 'all' || archive.entity_type === filters.entity)
    && (filters.status === 'all' || getArchiveStatus(archive, schema) === filters.status),
  );
}

/** Count entity and status totals using the same classification as filtering. */
export function getArchiveCounts(
  archives: readonly ArchiveRecord[],
  schema: ArchiveSchema,
): ArchiveCounts {
  const counts: ArchiveCounts = {
    total: archives.length,
    task: 0,
    project: 0,
    archived: 0,
    restored: 0,
    conflict: 0,
  };
  for (const archive of archives) {
    counts[archive.entity_type] += 1;
    counts[getArchiveStatus(archive, schema)] += 1;
  }
  return counts;
}

/** Choose the empty action from server results and client-side filter results. */
export function getArchiveEmptyState(input: {
  serverTotal: number;
  shownCount: number;
  searchActive: boolean;
  filtersActive: boolean;
}): ArchiveEmptyStateDecision {
  if (input.serverTotal === 0 && input.searchActive) {
    return {
      action: 'clear-search',
      title: 'No matching archives',
      body: 'No archived tasks or projects match your search.',
      actionLabel: 'Clear search',
    };
  }

  if (input.serverTotal > 0 && input.shownCount === 0 && input.filtersActive) {
    return {
      action: 'clear-filters',
      title: 'No archives match these filters',
      body: 'Archives are available, but none match the selected entity and status filters.',
      actionLabel: 'Clear filters',
    };
  }

  return {
    action: 'view-active-work',
    title: 'Cold Storage is empty',
    body: 'There are no archived tasks or projects to show. View active work to continue.',
    actionLabel: 'View active work',
  };
}
