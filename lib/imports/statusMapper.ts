export type StageMapping = {
  sourceName: string;
  targetStageId: string | null;
};

const STAGE_ALIASES: Record<string, string[]> = {
  'To Do': ['to do', 'todo', 'backlog', 'open', 'new', 'not started'],
  'In Progress': ['in progress', 'in-progress', 'doing', 'wip', 'working', 'started'],
  'In Review': ['in review', 'in-review', 'review', 'reviewing', 'peer review', 'qa'],
  'Done': ['done', 'completed', 'finished', 'closed', 'resolved'],
};

export function guessStageMapping(
  sourceStages: string[],
  existingStages: { id: string; name: string }[]
): StageMapping[] {
  return sourceStages.map(sourceName => {
    const lower = sourceName.toLowerCase().trim();
    for (const target of existingStages) {
      const aliases = STAGE_ALIASES[target.name];
      if (aliases?.includes(lower)) {
        return { sourceName, targetStageId: target.id };
      }
    }
    // Fuzzy fallback: partial match
    const match = existingStages.find(s =>
      lower.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(lower)
    );
    return { sourceName, targetStageId: match?.id ?? null };
  });
}
