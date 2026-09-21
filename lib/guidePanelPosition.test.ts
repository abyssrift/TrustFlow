import { describe, expect, it } from 'vitest';
import {
  ACCELERATED_KEYBOARD_STEP,
  DEFAULT_TOP_OFFSET,
  EDGE_INSET,
  KEYBOARD_STEP,
  clampGuidePanelPosition,
  getDefaultGuidePanelPosition,
  isGuidePanelPosition,
  moveGuidePanelByKey,
} from './guidePanelPosition';

describe('guide panel positioning', () => {
  it('places the panel just above its launcher near the bottom on desktop and mobile', () => {
    expect(getDefaultGuidePanelPosition({ width: 320, height: 400 }, { width: 1440, height: 900 }, 24)).toEqual({
      x: 1104,
      y: DEFAULT_TOP_OFFSET,
    });
    expect(getDefaultGuidePanelPosition({ width: 358, height: 400 }, { width: 390, height: 844 }, 86)).toEqual({
      x: 16,
      y: 306,
    });
  });

  it('clamps the panel above the launcher when short viewports cannot fit it', () => {
    expect(getDefaultGuidePanelPosition({ width: 358, height: 600 }, { width: 390, height: 700 }, 86)).toEqual({
      x: 16,
      y: 16,
    });
  });

  it('clamps every edge and pins oversized panels to the inset in tiny viewports', () => {
    const panel = { width: 200, height: 150 };
    const viewport = { width: 500, height: 400 };
    expect(clampGuidePanelPosition({ x: -100, y: -100 }, panel, viewport)).toEqual({ x: EDGE_INSET, y: EDGE_INSET });
    expect(clampGuidePanelPosition({ x: 900, y: 900 }, panel, viewport)).toEqual({ x: 284, y: 234 });
    expect(clampGuidePanelPosition({ x: 0, y: 0 }, { width: 500, height: 400 }, { width: 100, height: 80 }))
      .toEqual({ x: EDGE_INSET, y: EDGE_INSET });
  });

  it('accepts finite numeric persisted coordinates only', () => {
    expect(isGuidePanelPosition({ x: 0, y: -2 })).toBe(true);
    for (const value of [null, [], {}, { x: '1', y: 2 }, { x: 1, y: NaN }, { x: 1, y: Infinity }]) {
      expect(isGuidePanelPosition(value)).toBe(false);
    }
  });

  it('moves with normal and accelerated steps, clamps movement, and leaves unsupported keys unchanged', () => {
    const panel = { width: 100, height: 100 };
    const viewport = { width: 500, height: 400 };
    const start = { x: 100, y: 100 };
    expect(moveGuidePanelByKey(start, 'ArrowRight', false, panel, viewport)).toEqual({ x: 100 + KEYBOARD_STEP, y: 100 });
    expect(moveGuidePanelByKey(start, 'ArrowDown', true, panel, viewport)).toEqual({ x: 100, y: 100 + ACCELERATED_KEYBOARD_STEP });
    expect(moveGuidePanelByKey({ x: 16, y: 16 }, 'ArrowLeft', true, panel, viewport)).toEqual({ x: 16, y: 16 });
    expect(moveGuidePanelByKey(start, 'Enter', false, panel, viewport)).toEqual(start);
  });
});
