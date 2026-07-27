import { describe, expect, it } from 'vitest';
import { positionTooltip } from './tooltipPosition';

const viewport = { width: 1000, height: 800 };
const tip = { width: 120, height: 30 };

describe('positionTooltip', () => {
  it('centers above the target by default', () => {
    const r = positionTooltip({ x: 500, y: 400, width: 40, height: 40 }, tip, viewport);
    expect(r.side).toBe('top');
    expect(r.left).toBe(500 + 20 - 60);
    expect(r.top).toBe(400 - 30 - 8);
  });

  it('flips to bottom when the target hugs the top edge', () => {
    const r = positionTooltip({ x: 500, y: 4, width: 40, height: 40 }, tip, viewport);
    expect(r.side).toBe('bottom');
    expect(r.top).toBe(4 + 40 + 8);
  });

  it('clamps horizontally at the left edge', () => {
    const r = positionTooltip({ x: 0, y: 400, width: 20, height: 20 }, tip, viewport);
    expect(r.left).toBe(8);
  });

  it('clamps at the right edge', () => {
    const r = positionTooltip({ x: 990, y: 400, width: 20, height: 20 }, tip, viewport);
    expect(r.left).toBe(1000 - 120 - 8);
  });

  it('flips left to right when hugging the left edge', () => {
    const r = positionTooltip({ x: 2, y: 400, width: 30, height: 30 }, tip, viewport, 'left');
    expect(r.side).toBe('right');
    expect(r.left).toBe(2 + 30 + 8);
  });

  it('never escapes a tiny viewport', () => {
    const r = positionTooltip({ x: 5, y: 5, width: 10, height: 10 }, tip, { width: 100, height: 50 });
    expect(r.left).toBeGreaterThanOrEqual(8);
    expect(r.top).toBeGreaterThanOrEqual(8);
  });
});
