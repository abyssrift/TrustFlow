// ====================================================================
// filehub-orphan-sweep — pure selection logic
// ====================================================================
// The decision of WHICH objects get deleted, with no I/O, so it can be
// unit-tested against fixtures (see logic.test.ts). index.ts owns the
// listing / reference-lookup / removal I/O and calls into these.
//
// Behaviour here is load-bearing for the #1 invariant: never return a path
// that is still referenced, and never return a path we cannot age-verify.
// ====================================================================

export interface StorageObj {
  path: string
  created_at: string | null
}

/**
 * Split listed objects into paths old enough to be swept vs. skipped ones.
 *
 * An object is a candidate only when its created_at parses AND is at or before
 * `cutoffMs`. A missing/unparseable created_at is treated as too-recent: we
 * never delete something whose age we cannot verify (fail-safe).
 */
export function ageCandidates(
  objects: StorageObj[],
  cutoffMs: number,
): { candidates: string[]; tooRecent: number } {
  const candidates: string[] = []
  let tooRecent = 0
  for (const obj of objects) {
    const createdMs = obj.created_at ? Date.parse(obj.created_at) : NaN
    if (!Number.isFinite(createdMs) || createdMs > cutoffMs) {
      tooRecent += 1
      continue
    }
    candidates.push(obj.path)
  }
  return { candidates, tooRecent }
}

/**
 * Subtract the referenced set from the aged candidates. Anything referenced by
 * a filehub_files row (live OR in the Bin) or any filehub_file_versions row
 * survives.
 */
export function selectOrphans(candidates: string[], referenced: Set<string>): string[] {
  return candidates.filter((p) => !referenced.has(p))
}
