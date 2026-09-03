import type { ImportedTask } from './types';

export type PipelineImportPlan = {
  boardName: string;
  // Set when an existing, non-deleted pipeline already has this name —
  // the import reuses it instead of creating a duplicate.
  existingPipelineId: string | null;
  // Distinct source stage/status names, in first-seen order.
  stageNames: string[];
};

// One pipeline per imported board/project (issue #100): reuse an existing
// pipeline whose name matches the source board (case-insensitively — board
// names arrive verbatim from Jira/Odoo/Trello and casing isn't a meaningful
// distinction), else plan to create a new one with stages named after the
// source's distinct columns/statuses.
export function buildPipelineImportPlan(
  boardName: string,
  tasks: ImportedTask[],
  existingPipelines: { id: string; name: string }[]
): PipelineImportPlan {
  const normalized = boardName.trim();
  const match = existingPipelines.find(p => p.name.trim().toLowerCase() === normalized.toLowerCase());
  const stageNames = Array.from(new Set(tasks.map(t => t.stageName).filter((s): s is string => !!s)));

  return {
    boardName: normalized,
    existingPipelineId: match?.id ?? null,
    stageNames,
  };
}
