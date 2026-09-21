export function getThroughputPresentation(succeeded: number, failed: number) {
  const total = succeeded + failed;
  const hasOutcomes = total > 0;
  const successPct = hasOutcomes ? (succeeded / total) * 100 : 0;

  return {
    hasOutcomes,
    successPct,
    failurePct: hasOutcomes ? (failed / total) * 100 : 0,
  };
}
