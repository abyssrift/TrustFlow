export type ThroughputKpi = {
  value: number | null;
  delta: number | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mapThroughputKpi(current: unknown, comparison: unknown): ThroughputKpi {
  const value = finiteNumber(current);
  const previous = finiteNumber(comparison);
  return {
    value,
    delta: value !== null && previous !== null ? value - previous : null,
  };
}
