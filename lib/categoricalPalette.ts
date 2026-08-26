// The app's one validated categorical palette (dataviz skill reference, fixed
// slot order) — pulled out of TimeByCategoryPie.tsx (#198) so a second surface
// needing N distinct categorical hues (DashboardFacts's expanded fact cards)
// reuses the same validated set instead of inventing a second one.
//
// Light/dark columns are the same hues stepped for the surface, not a reflip.
// Re-validated 2026-08-03 (#198) against this app's dark chart surface with
// the dataviz validator: lightness band, chroma floor, adjacent-pair CVD
// separation (worst ΔE 8.4 protan / 8.7 tritan), normal-vision floor (19.3)
// and >= 3:1 contrast all PASS on the dark column. The adjacent-pair CVD
// margin sits in the band that is only legal WITH a secondary encoding —
// every caller must keep a name/label alongside the colour, never colour alone.
export const CAT_LIGHT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
export const CAT_DARK = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

export function isDarkHex(hex?: string) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

/** `colors.card` in, the right palette out — the one decision every caller repeats. */
export function categoricalPalette(cardColorHex?: string) {
  return isDarkHex(cardColorHex) ? CAT_DARK : CAT_LIGHT;
}
