// Phase 10 (#191, plan §16.1/§16.2) — PRESENTATION helpers for the dashboard's
// "blocked projects, by exception" panel. Pure logic, no imports, so
// lib/projectExceptions.check.ts can assert it under plain `npx tsx` (same
// split as lib/projectPresentation.ts).
//
// ── WHERE THE PREDICATE LIVES: THE SERVER, AND ONLY THE SERVER ─────────────
// This file used to re-derive "does this project need a human" from raw
// columns, while rpc_projects_table's p_blocked filter answered the same
// question with a poorer definition (no flags[], no done-exclusion, no
// overrun). Two definitions on two screens is exactly the §16.1 failure, so
// 20260806_project_needs_attention.sql moved the RICH one into
// public.fn_project_needs_attention() and grew the RPC a `needs_attention`
// column that its own filter also calls.
//
// isExceptionProject() therefore just reads that column. Everything else here
// is DISPLAY — which reason to show, which note, how to rank — and display is
// allowed to be a client concern. What is NOT allowed is a second answer to
// "is this an exception at all", which is why that one function is a
// passthrough and must stay one.
//
// For the record, the definition it is reading (quoted from the migration):
//   blocked via EITHER representation (projects.blocked OR 'blocked' in
//   flags[]), OR — only when the project is NOT in a success-terminal stage —
//   past its due_date, OR forecast by fn_project_projection() to land after
//   due_date at a confidence other than 'none'.

export type ExceptionSourceRow = {
  /**
   * rpc_projects_table.needs_attention — the server's single definition.
   * Never recomputed here; see the header.
   */
  needs_attention?: boolean | null;
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

/**
 * Display-side "done", mirroring the server's own: a success-TERMINAL stage,
 * never project.completed_at. Used only to decide which reason to render and
 * how to rank — the qualifying decision is isExceptionProject().
 */
export function isProjectDone(row: ExceptionSourceRow): boolean {
  return !!row.stage_is_terminal && row.stage_terminal_type === 'success';
}

/** Which badge to show — the union of the two live blocked representations. */
export function isBlockedException(row: ExceptionSourceRow): boolean {
  return !!row.blocked || !!row.flags?.includes('blocked');
}

/** The note to show for a blocked exception — whichever representation set one. */
export function effectiveBlockedReason(row: ExceptionSourceRow): string | null {
  return row.flag_note?.trim() || row.blocked_reason?.trim() || null;
}

/**
 * Display only. The server decides overdue from `due_date::date < CURRENT_DATE`;
 * this reads the pre-computed `days_remaining`, which can differ by a few hours
 * either side of midnight. That is fine for choosing a label and a sort key and
 * is NOT fine for deciding whether a row appears at all — which is why
 * isExceptionProject() does not call this.
 */
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

/**
 * THE qualifying predicate — a passthrough of the server's `needs_attention`
 * column, deliberately. Re-deriving it from the raw columns below is what
 * created the divergence 20260806_project_needs_attention.sql closed: the
 * dashboard and the Intelligence lens answered the same question differently
 * and would have disagreed on screen the first time anyone finished an overdue
 * project or used flags[]. If a row needs to qualify for a new reason, the
 * reason goes in fn_project_needs_attention(), not here.
 */
export function isExceptionProject(row: ExceptionSourceRow): boolean {
  return !!row.needs_attention;
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
