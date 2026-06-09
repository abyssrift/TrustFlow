const shouldLogTaskFlow = typeof __DEV__ === 'undefined' ? true : __DEV__;

export function taskFlowDebug(event: string, payload?: unknown) {
  if (!shouldLogTaskFlow) return;
  if (payload === undefined) {
    console.log(`[TrustFlow][TaskFlow] ${event}`);
    return;
  }

  console.log(`[TrustFlow][TaskFlow] ${event}`, payload);
}

export function taskFlowError(event: string, error: unknown, payload?: unknown) {
  if (!shouldLogTaskFlow) return;
  if (payload === undefined) {
    console.error(`[TrustFlow][TaskFlow] ${event}`, error);
    return;
  }

  console.error(`[TrustFlow][TaskFlow] ${event}`, payload, error);
}