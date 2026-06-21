export type ActionUiSlot = 'button' | 'submission' | 'review';
export type ActionExecutionRoute = 'generic' | 'submit_work' | 'review_submission';

export type ActionDescriptor = {
  actionType: string;
  uiSlot: ActionUiSlot;
  executionRoute: ActionExecutionRoute;
  isComplex: boolean;
};

const ACTION_REGISTRY: Record<string, Omit<ActionDescriptor, 'actionType'>> = {
  submit_work: { uiSlot: 'submission', executionRoute: 'submit_work', isComplex: true },
  review_approve: { uiSlot: 'review', executionRoute: 'generic', isComplex: true },
  review_revise: { uiSlot: 'review', executionRoute: 'generic', isComplex: true },
  review_reject: { uiSlot: 'review', executionRoute: 'generic', isComplex: true },
};

const ACTION_FALLBACK: Omit<ActionDescriptor, 'actionType'> = {
  uiSlot: 'button',
  executionRoute: 'generic',
  isComplex: false,
};

export function getActionDescriptor(actionType: string): ActionDescriptor {
  const normalized = actionType?.trim();
  const descriptor = ACTION_REGISTRY[normalized] || ACTION_FALLBACK;

  return {
    actionType: normalized,
    ...descriptor,
  };
}

export function isComplexActionType(actionType: string): boolean {
  return getActionDescriptor(actionType).isComplex;
}

// ─── Directional advancement ──────────────────────────────────────────────────
// A stage action that moves the task to a *later* stage points forward (right);
// one routing back to an *earlier* stage points backward (left). Used to render
// contextual arrows on stage-action buttons. Returns null when there is no
// transition target or the target sits at the same position (no clear direction).
export type StageDirection = 'forward' | 'backward' | null;

export function stageDirection(
  currentPosition: number | null | undefined,
  targetPosition: number | null | undefined
): StageDirection {
  if (currentPosition == null || targetPosition == null) return null;
  if (targetPosition > currentPosition) return 'forward';
  if (targetPosition < currentPosition) return 'backward';
  return null;
}

/** Build transitionId → target-stage-position lookup from transitions + stages. */
export function buildTransitionTargetMap(
  transitions: { id: string; to_stage_id: string }[],
  stagePositionById: Map<string, number>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of transitions) {
    const pos = stagePositionById.get(t.to_stage_id);
    if (pos != null) map.set(t.id, pos);
  }
  return map;
}

export function splitStageActions<T extends { action_type: string }>(actions: T[]) {
    const grouped: { buttons: T[]; review: T[]; submission: T[] } = {
      buttons: [],
      review: [],
      submission: [],
    };
  
    for (const action of actions) {
      const descriptor = getActionDescriptor(action.action_type);
      if (descriptor.uiSlot === 'submission') grouped.submission.push(action);
      else if (descriptor.uiSlot === 'review') grouped.review.push(action);
      else grouped.buttons.push(action);
    }
  
    return grouped;
}

export const TYPE_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    success: { bg: 'bg-state-success/10', border: 'border-state-success/30', text: 'text-state-success', icon: 'check' },
    warning: { bg: 'bg-state-warning/10', border: 'border-state-warning/30', text: 'text-state-warning', icon: 'refresh' },
    danger: { bg: 'bg-state-danger/10', border: 'border-state-danger/30', text: 'text-state-danger', icon: 'times' },
    neutral: { bg: 'bg-surface-overlay', border: 'border-surface-border', text: 'text-typography-main', icon: 'arrow-right' },
    primary: { bg: 'bg-brand-primary/10', border: 'border-brand-primary/30', text: 'text-brand-primary', icon: 'play' },
};
