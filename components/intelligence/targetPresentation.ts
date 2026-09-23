export type TargetProgressFields = {
  target_type?: unknown;
  current_count?: unknown;
  target_quantity?: unknown;
};

export function isTargetProgressRingEligible(target: TargetProgressFields): boolean {
  return target.target_type === 'volume'
    && typeof target.current_count === 'number'
    && Number.isFinite(target.current_count)
    && typeof target.target_quantity === 'number'
    && Number.isFinite(target.target_quantity)
    && target.target_quantity > 0;
}

export function unavailableLabel(value: unknown): string {
  return value == null || value === '' ? 'Unavailable' : String(value);
}
