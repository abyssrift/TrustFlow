// Sequential runner for "apply one action to N selected tasks" (issue #216).
//
// Sequential, not Promise.all: the board's per-stage pagination + optimistic
// patching races badly with a burst of parallel writes + realtime echoes, and
// N parallel RPC calls stampede PostgREST. It also keeps failures legible —
// one task's active-timer lock on archive shouldn't abort the other 20.
//
// ponytail: fine to ~50 selected; past that this wants a real bulk RPC per
// action instead of a client loop.

export type BulkOutcome = {
  ok: string[];
  failed: { id: string; error: string }[];
};

export async function runBulk(
  ids: string[],
  op: (id: string) => Promise<void>,
): Promise<BulkOutcome> {
  const ok: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids) {
    try {
      await op(id);
      ok.push(id);
    } catch (e: any) {
      failed.push({ id, error: e?.message || String(e) });
    }
  }
  return { ok, failed };
}

export function summarizeBulk(o: BulkOutcome, verb: string): string {
  const total = o.ok.length + o.failed.length;
  if (o.failed.length === 0) {
    return `${verb} ${o.ok.length} task${o.ok.length === 1 ? '' : 's'}.`;
  }
  if (o.ok.length === 0) {
    return `${verb} 0 of ${total} — all failed: ${o.failed[0].error}`;
  }
  return `${verb} ${o.ok.length} of ${total}. ${o.failed.length} failed — e.g. ${o.failed[0].error}`;
}
