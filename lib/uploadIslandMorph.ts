// Pure geometry math for the upload-card -> topbar-island goo morph. Kept
// separate from the animation wiring in _filehub_desktop.tsx so the math is
// unit-testable without a DOM or Animated runtime.

export type Rect = { x: number; y: number; width: number; height: number };

export type MorphGeometry = {
  // Shape A: the shrinking ghost of the upload card, animated from `from` to `to`.
  shapeA: { from: Rect; to: Rect };
  // Shape B: the growing blob that lands on the island, centered + sized to match its pill.
  shapeB: { center: { x: number; y: number }; size: number };
};

// Shape A shrinks toward a small square centered on the island rather than
// matching its full pill shape — the goo filter fuses A into B well before
// A's exact shape would ever be noticed, so a square keeps the corner-radius
// interpolation trivial.
const SHRUNK_SIZE = 18;
const MIN_SHAPE_B_SIZE = 16;

export function computeMorphGeometry(cardRect: Rect, islandRect: Rect): MorphGeometry {
  const islandCenter = {
    x: islandRect.x + islandRect.width / 2,
    y: islandRect.y + islandRect.height / 2,
  };
  return {
    shapeA: {
      from: cardRect,
      to: {
        x: islandCenter.x - SHRUNK_SIZE / 2,
        y: islandCenter.y - SHRUNK_SIZE / 2,
        width: SHRUNK_SIZE,
        height: SHRUNK_SIZE,
      },
    },
    shapeB: {
      center: islandCenter,
      size: Math.max(islandRect.height, MIN_SHAPE_B_SIZE),
    },
  };
}
