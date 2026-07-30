// Span math for the calendar overlay's click-anchor + hover-preview range.
// Kept pure (and out of the component) because the -1 cases are easy to get
// wrong: an anchor left over from a month you've navigated away from is not
// in the current grid, and slicing on its -1 index silently yields undefined
// day keys that crash the range summary's date formatting downstream.
export function rangeKeysBetween(gridKeys: string[], anchor: string, end: string): string[] {
  const a = gridKeys.indexOf(anchor);
  const b = gridKeys.indexOf(end);
  if (a === -1 || b === -1) return [];
  return gridKeys.slice(Math.min(a, b), Math.max(a, b) + 1);
}
