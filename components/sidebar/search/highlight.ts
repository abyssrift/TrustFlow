// ts_headline (rpc_global_search `snippet`) wraps matched terms in <b>…</b>.
// Split into alternating runs so callers can tint the odd (matched) ones:
// even index = plain, odd index = matched. Whitespace collapsed + trimmed.
// ponytail: naive split on <b>/</b> — ts_headline emits nothing else. Parse
// properly only if the headline StartSel/StopSel config ever changes.
export function highlightRuns(text: string | null): string[] {
  return (text || '').replace(/\s+/g, ' ').trim().split(/<\/?b>/);
}
