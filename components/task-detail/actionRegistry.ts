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
  review_approve: { uiSlot: 'review', executionRoute: 'review_submission', isComplex: true },
  review_revise: { uiSlot: 'review', executionRoute: 'review_submission', isComplex: true },
  review_reject: { uiSlot: 'review', executionRoute: 'review_submission', isComplex: true },
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
