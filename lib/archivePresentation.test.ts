import { describe, expect, it } from 'vitest';
import {
  filterArchives,
  getArchiveCounts,
  getArchiveEmptyState,
  getArchiveIntegrityIssue,
  getArchiveStatus,
  type ArchiveRecord,
  type ArchiveSchema,
} from './archivePresentation';

const schema: ArchiveSchema = {
  pipelineIds: new Set(['pipeline-live']),
  stageIds: new Set(['stage-live']),
};

const rows: ArchiveRecord[] = [
  { id: 'project-ok', entity_type: 'project', snapshot: { project: { pipeline_id: 'pipeline-live' } } },
  { id: 'task-ok', entity_type: 'task', snapshot: { task: { current_stage_id: 'stage-live' } } },
  { id: 'project-missing', entity_type: 'project', snapshot: { project: { pipeline_id: 'pipeline-gone' } } },
  { id: 'task-missing', entity_type: 'task', snapshot: { task: { current_stage_id: null } } },
  { id: 'restored-conflict', entity_type: 'task', restored_at: '2026-01-01', snapshot: { task: { current_stage_id: 'stage-gone' } } },
];

describe('archive integrity and status', () => {
  it('returns specific restore guidance for missing original project pipelines and task stages', () => {
    expect(getArchiveIntegrityIssue(rows[2], schema)).toMatch(/pipeline.*missing.*Restore is unavailable.*remap/i);
    expect(getArchiveIntegrityIssue(rows[3], schema)).toMatch(/stage.*missing.*Restore is unavailable.*remap/i);
    expect(getArchiveIntegrityIssue(rows[0], schema)).toBeNull();
  });

  it('classifies archived, restored, and conflict rows, with restored rows never conflicting', () => {
    expect(rows.map((row) => getArchiveStatus(row, schema))).toEqual([
      'archived', 'archived', 'conflict', 'conflict', 'restored',
    ]);
    expect(getArchiveIntegrityIssue(rows[4], schema)).toBeNull();
  });
});

describe('archive filtering and counts', () => {
  it('filters across all entity and status branches without mutating the input', () => {
    const input = [...rows];
    expect(filterArchives(input, { entity: 'all', status: 'all' }, schema)).toEqual(rows);
    expect(filterArchives(input, { entity: 'task', status: 'all' }, schema).map((row) => row.id))
      .toEqual(['task-ok', 'task-missing', 'restored-conflict']);
    expect(filterArchives(input, { entity: 'project', status: 'all' }, schema).map((row) => row.id))
      .toEqual(['project-ok', 'project-missing']);
    expect(filterArchives(input, { entity: 'all', status: 'archived' }, schema).map((row) => row.id))
      .toEqual(['project-ok', 'task-ok']);
    expect(filterArchives(input, { entity: 'all', status: 'restored' }, schema).map((row) => row.id))
      .toEqual(['restored-conflict']);
    expect(filterArchives(input, { entity: 'all', status: 'conflict' }, schema).map((row) => row.id))
      .toEqual(['project-missing', 'task-missing']);
    expect(input).toEqual(rows);
  });

  it('counts each entity and classified status once', () => {
    expect(getArchiveCounts(rows, schema)).toEqual({
      total: 5,
      task: 3,
      project: 2,
      archived: 2,
      restored: 1,
      conflict: 2,
    });
  });
});

describe('archive empty state', () => {
  it('offers clear search when the server returned no rows for an active search', () => {
    expect(getArchiveEmptyState({ serverTotal: 0, shownCount: 0, searchActive: true, filtersActive: false }))
      .toMatchObject({ action: 'clear-search', title: expect.any(String), body: expect.any(String), actionLabel: 'Clear search' });
  });

  it('offers clear filters when client filters hide non-empty server results', () => {
    expect(getArchiveEmptyState({ serverTotal: 3, shownCount: 0, searchActive: false, filtersActive: true }))
      .toMatchObject({ action: 'clear-filters', title: expect.any(String), body: expect.any(String), actionLabel: 'Clear filters' });
  });

  it('offers active work for an empty base result', () => {
    expect(getArchiveEmptyState({ serverTotal: 0, shownCount: 0, searchActive: false, filtersActive: false }))
      .toMatchObject({ action: 'view-active-work', title: expect.any(String), body: expect.any(String), actionLabel: 'View active work' });
  });

  it('preserves base-result context when no client filter is active', () => {
    expect(getArchiveEmptyState({ serverTotal: 4, shownCount: 0, searchActive: false, filtersActive: false }).action)
      .toBe('view-active-work');
  });
});
