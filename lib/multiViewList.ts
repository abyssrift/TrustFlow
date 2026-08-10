// Pure logic behind components/common/MultiViewList.tsx, split out so the
// branching bits (mode validation, column math) can be asserted standalone
// via `npx tsx lib/multiViewList.check.ts` without pulling in react-native —
// mirrors the split in lib/imports/spreadsheetMapping.ts / spreadsheetIntake.ts.

export type MultiViewMode = 'large' | 'medium' | 'list' | 'details';

export const ALL_MULTIVIEW_MODES: readonly MultiViewMode[] = ['large', 'medium', 'list', 'details'];

/**
 * Validates a value read back from AsyncStorage. Required (not optional) by
 * usePersistedState's contract — what comes back from storage may be a mode
 * a previous build supported and this one no longer does.
 */
export function isMultiViewMode(raw: unknown): raw is MultiViewMode {
  return raw === 'large' || raw === 'medium' || raw === 'list' || raw === 'details';
}

/**
 * Falls back to the first allowed mode when the persisted (or requested)
 * mode isn't one this particular caller enabled — e.g. a mode persisted from
 * a screen that offers all four, read back on a screen that only offers
 * 'large'/'list'.
 */
export function clampMode(mode: MultiViewMode, allowed: readonly MultiViewMode[]): MultiViewMode {
  return allowed.includes(mode) ? mode : (allowed[0] ?? 'list');
}

/**
 * Grid column count for a measured pixel width: as many `minCardWidth`
 * columns as fit, clamped to at least 1 (a not-yet-measured width must never
 * divide by zero or return 0 columns) and at most `maxColumns` (so a card
 * never gets absurdly wide on an ultrawide monitor).
 */
export function computeColumns(width: number, minCardWidth: number, maxColumns: number): number {
  if (!(width > 0) || !(minCardWidth > 0)) return 1;
  return Math.max(1, Math.min(maxColumns, Math.floor(width / minCardWidth)));
}
