const SENSITIVE_PARAMETER_KEYS = new Set(['salary', 'salaries']);

/** Remove sensitive compensation inputs before report parameters are persisted or logged. */
export function redactSensitiveReportParameters(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveReportParameters);
  if (!value || typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_PARAMETER_KEYS.has(key.toLowerCase())) continue;
    redacted[key] = redactSensitiveReportParameters(nestedValue);
  }
  return redacted;
}
