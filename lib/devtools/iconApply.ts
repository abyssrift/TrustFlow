// Client side of the icon-changes apply loop. The browser cannot write source
// files, so these helpers talk to a local Node process started by the developer:
//
//     node scripts/apply-icon-changes.mjs --serve
//
// which POSTs are sent to `<endpoint>/apply` (default http://localhost:8787).
// The apply server verifies each change against the audited snippet + glyph
// before writing, is idempotent, and batches writes per file.

export type IconChangeInput = {
  file: string;
  line: number;
  kind: string;
  from: string;
  to: string;
  snippet: string;
};

export type ApplyResult = {
  ok: boolean;
  applied: number;
  alreadyApplied: number;
  failed: number;
  /** True when the apply server re-ran the audit generator after writing. */
  regenerated?: boolean;
  failures?: { file: string; line: number; reason: string }[];
  error?: string;
};

export const DEFAULT_APPLY_ENDPOINT = 'http://localhost:8787';

export function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

export async function pingIconServer(endpoint: string): Promise<boolean> {
  try {
    const res = await fetch(`${normalizeEndpoint(endpoint)}/ping`, { method: 'GET' });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export async function applyIconChanges(
  changes: IconChangeInput[],
  endpoint: string = DEFAULT_APPLY_ENDPOINT,
): Promise<ApplyResult> {
  const res = await fetch(`${normalizeEndpoint(endpoint)}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  });
  const body = (await res.json()) as ApplyResult;
  return body;
}
