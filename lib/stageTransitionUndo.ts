/** Server-confirmed metadata required to undo one forward task transition. */
export type StageTransitionUndoMetadata = {
  historyId: string;
  undoToken: string;
  fromStageId: string;
  toStageId: string;
  refusalReasons: string[];
};

type StageTransitionUndoResponse = {
  history_id?: unknown;
  undo_token?: unknown;
  undoable?: unknown;
  refusal_reasons?: unknown;
  from_stage_id?: unknown;
  to_stage_id?: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Accept only the explicit server contract. In particular, never infer that
 * a transition is undoable from its action type or from local stage state.
 */
export function parseForwardStageUndo(
  response: unknown,
): StageTransitionUndoMetadata | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  const value = response as StageTransitionUndoResponse;
  if (value.undoable !== true) return null;
  if (
    !isNonEmptyString(value.history_id) ||
    !isNonEmptyString(value.undo_token) ||
    !isNonEmptyString(value.from_stage_id) ||
    !isNonEmptyString(value.to_stage_id)
  ) return null;

  const refusalReasons = Array.isArray(value.refusal_reasons)
    ? value.refusal_reasons.filter(isNonEmptyString)
    : [];

  return {
    historyId: value.history_id,
    undoToken: value.undo_token,
    fromStageId: value.from_stage_id,
    toStageId: value.to_stage_id,
    refusalReasons,
  };
}

/** @deprecated Use parseForwardStageUndo for forward-stage RPC responses. */
export const parseStageTransitionUndo = parseForwardStageUndo;
