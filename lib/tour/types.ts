import type { TooltipSide } from '@/lib/tooltipPosition';

export type TourStep = {
  /** Stable id a target component registers itself under via useTourTarget(id). */
  targetId: string;
  title?: string;
  body: string;
  /** Preferred tooltip side, passed straight through to positionTooltip(). Default 'bottom'. */
  placement?: TooltipSide;
  /** Optional id of a registered action (useTourAction) to run before this step measures its target — e.g. opening a drawer the target lives behind. */
  beforeActionId?: string;
};
