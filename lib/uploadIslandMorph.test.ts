import { describe, expect, it } from 'vitest';
import { computeMorphGeometry } from './uploadIslandMorph';

describe('computeMorphGeometry', () => {
  it('shrinks shape A toward an 18px square centered on the island', () => {
    const cardRect = { x: 200, y: 100, width: 560, height: 480 };
    const islandRect = { x: 600, y: 8, width: 90, height: 26 };

    const geo = computeMorphGeometry(cardRect, islandRect);

    expect(geo.shapeA.from).toEqual(cardRect);
    expect(geo.shapeA.to.width).toBe(18);
    expect(geo.shapeA.to.height).toBe(18);
    expect(geo.shapeA.to.x).toBe(600 + 90 / 2 - 18 / 2);
    expect(geo.shapeA.to.y).toBe(8 + 26 / 2 - 18 / 2);
  });

  it('centers shape B on the island and sizes it to the pill height', () => {
    const cardRect = { x: 0, y: 0, width: 400, height: 300 };
    const islandRect = { x: 700, y: 12, width: 90, height: 26 };

    const geo = computeMorphGeometry(cardRect, islandRect);

    expect(geo.shapeB.center).toEqual({ x: 745, y: 25 });
    expect(geo.shapeB.size).toBe(26);
  });

  it('floors shape B size at 16 for a very small island target', () => {
    const cardRect = { x: 0, y: 0, width: 400, height: 300 };
    const islandRect = { x: 0, y: 0, width: 10, height: 10 };

    const geo = computeMorphGeometry(cardRect, islandRect);

    expect(geo.shapeB.size).toBe(16);
  });
});
