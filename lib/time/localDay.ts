// Local calendar day as YYYY-MM-DD. NOT `d.toISOString().split('T')[0]`,
// which reads the UTC calendar date -- for any timezone ahead of UTC
// (including Egypt, this app's production market) that silently resolves
// "today" to yesterday for the first ~2-3hrs after local midnight (#272).
export function localIsoDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
