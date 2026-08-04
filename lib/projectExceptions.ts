// Phase 10 (#191, plan §16.2) — the qualifying predicate + sort order for the
// dashboard's "blocked projects, by exception" panel. Pure logic, no imports,
// so lib/projectExceptions.check.ts can assert it under plain `npx tsx`
// (same split as lib/projectPresentation.ts).
//
// Three ways a project earns a spot on this panel:
//
//   1. blocked — projects.blocked OR 'blocked' in projects.flags. Those are
//      the two live representations 20260801_project_header_flags.sql
//      shipped side by side and deliberately left unreconciled. Unioned the
//      same way fn_trg_projects_notify_flags() does in
//      20260805_project_notifications.sql — not a third interpretation.
//
//   2. overdue — due_date has passed and the project is not done.
//
//   3. overrun — fn_project_projection() says the project will land after
//      due_date, AND the server trusts its own forecast. confidence:
//        'ok'   -> fires, shown as a real warning
//        'low'  -> fires, shown but marked uncertain
//        'none' -> never fires. The server explicitly refused to forecast
//                  (fewer than 5 completed tasks) — silence, not a guess.
//
// "Done" is a stage predicate — is_terminal AND terminal_type = 'success' —
// never project.completed_at. A finished project must never read as overdue
// or overrunning, no matter how stale its blocked flag or due_date is.

export type ExceptionSourceRow = {
  blocked?: boolean | null;
  blocked_reason?: string | null;
  flags?: readonly string[] | null;
  flag_note?: string | null;
  due_date?: string | null;
  days_remaining?: number | null;
  projected_end?: string | null;
  projection_confidence?: string | null;
  /** The project's own current stage, not a task stage. */
  stage_is_terminal?: boolean | null;
  stage_terminal_type?: string | null;
};

export function isProjectDone(row: ExceptionSourceRow): boolean {
  return !!row.stage_is_terminal && row.stage_terminal_type === 'success';
}

export function isBlockedException(row: ExceptionSourceRow): boolean {
  return !!row.blocked || !!row.flags?.includes('blocked');
}

/** The note to show for a blocked exception — whichever representation set one. */
export function effectiveBlockedReason(row: ExceptionSourceRow): string | null {
  return row.flag_note?.trim() || row.blocked_reason?.trim() || null;
}

export function isOverdueException(row: ExceptionSourceRow): boolean {
  if (isProjectDone(row)) return false;
  return row.days_remaining != null && row.days_remaining < 0;
}

export type OverrunStatus = { fires: boolean; uncertain: boolean };

/** uncertain=true means "shown, but the server's own confidence is low." */
export function overrunStatus(row: ExceptionSourceRow): OverrunStatus {
  if (isProjectDone(row)) return { fires: false, uncertain: false };
  if (!row.projection_confidence || row.projection_confidence === 'none') return { fires: false, uncertain: false };
  if (!row.projected_end || !row.due_date) return { fires: false, uncertain: false };
  const fires = new Date(row.projected_end).getTime() > new Date(row.due_date).getTime();
  return { fires, uncertain: fires && row.projection_confidence === 'low' };
}

export function isExceptionProject(row: ExceptionSourceRow): boolean {
  return isBlockedException(row) || isOverdueException(row) || overrunStatus(row).fires;
}

/**
 * Higher = more urgent. blocked > overdue > overrun, matching the precedence
 * lib/projectPresentation.ts's projectHealth() already uses for blocked vs
 * overdue elsewhere in the app — not a second ranking invented for this panel.
 */
export function exceptionUrgencyScore(row: ExceptionSourceRow): number {
  let score = 0;
  if (isBlockedException(row)) score += 3000;
  if (isOverdueException(row)) score += 2000 + Math.min(Math.abs(row.days_remaining ?? 0), 900);
  const overrun = overrunStatus(row);
  if (overrun.fires) score += overrun.uncertain ? 500 : 1000;
  return score;
}
