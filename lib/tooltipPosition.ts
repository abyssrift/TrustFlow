export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 8; // distance between anchor and bubble
const PAD = 8; // minimum distance from any viewport edge

/**
 * Pure placement math shared by Tooltip.tsx / Tooltip.web.tsx.
 * Flips to the opposite side when the preferred side lacks room,
 * then clamps the bubble fully inside the viewport.
 */
export function positionTooltip(
  target: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  side: TooltipSide = 'top',
): { left: number; top: number; side: TooltipSide } {
  const room: Record<TooltipSide, number> = {
    top: target.y,
    bottom: viewport.height - (target.y + target.height),
    left: target.x,
    right: viewport.width - (target.x + target.width),
  };
  const needed = (s: TooltipSide) =>
    (s === 'top' || s === 'bottom' ? tip.height : tip.width) + GAP + PAD;
  const opposite: Record<TooltipSide, TooltipSide> = {
    top: 'bottom',
    bottom: 'top',
    left: 'right',
    right: 'left',
  };
  if (room[side] < needed(side) && room[opposite[side]] > room[side]) {
    side = opposite[side];
  }

  let left: number;
  let top: number;
  if (side === 'top' || side === 'bottom') {
    left = target.x + target.width / 2 - tip.width / 2;
    top = side === 'top' ? target.y - tip.height - GAP : target.y + target.height + GAP;
  } else {
    top = target.y + target.height / 2 - tip.height / 2;
    left = side === 'left' ? target.x - tip.width - GAP : target.x + target.width + GAP;
  }

  left = Math.min(Math.max(left, PAD), Math.max(viewport.width - tip.width - PAD, PAD));
  top = Math.min(Math.max(top, PAD), Math.max(viewport.height - tip.height - PAD, PAD));
  return { left, top, side };
}
