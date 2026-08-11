#!/usr/bin/env node
// Applies icon changes from the Dev Tools "Icon Audit" page directly to source
// files on disk. The browser can't write files, so this script runs locally
// (alongside the dev server) and exposes either:
//
//   - a one-shot CLI:  node scripts/apply-icon-changes.mjs <payload.json> [--dry-run]
//   - a local HTTP endpoint the dev tool POSTs to:
//                       node scripts/apply-icon-changes.mjs --serve [port]
//
// Safety model (see .agents/workflows and the icon audit tool docs):
//   - Verifies each change against its snippet + `from` glyph BEFORE touching
//     the line. Line numbers drift; never trust them alone.
//   - Idempotent: if a line already shows `to` (and no longer `from`) it is
//     reported as "already applied" and left alone.
//   - Batched: all changes are validated up front, then written once per file.
//     A failing match aborts that file BEFORE any write happens.
//   - `--dry-run` validates and prints the plan without writing anything.
//   - Failed matches are reported with a `git checkout -- <file>` escape hatch;
//     nothing is ever auto-reverted.
//
// Accepted payloads (the dev tool's export format):
//   { changes: [{ file, line, kind, from, to, snippet }] }
//   or a bare array of the same objects.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(process.cwd());

// ── Payload handling ─────────────────────────────────────────────────────────
function normalizePayload(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const list = Array.isArray(data) ? data : data?.changes;
  if (!Array.isArray(list)) throw new Error('payload must be an array or { changes: [...] }');
  return list
    .filter((c) => c && c.file && c.from && c.to)
    .map((c) => ({ file: c.file, line: c.line ?? null, kind: c.kind ?? 'attribute', from: c.from, to: c.to, snippet: c.snippet ?? null }));
}

const QUOTED_GLYPH_RE = (glyph) => new RegExp(`(['"])${escapeRe(glyph)}\\1`, 'g');

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Per-change match + replace (string-level; no AST needed for name=/icon:) ─
// Returns { status, line? } where status is one of:
//   'ok'               → the line was rewritten
//   'already-applied'  → `to` present, `from` absent (idempotent no-op)
//   'no-match'         → neither `from` (nor a clean `to`) found; left untouched
function applyToFile(lines, change) {
  // Collect candidate lines in order of trust: the audited line number first,
  // then any line matching the snippet (line numbers drift, the snippet is
  // stable). Pick the first candidate that actually contains `from`.
  const idx = change.line != null ? change.line - 1 : null;
  const candidates = [];
  if (idx != null && idx >= 0 && idx < lines.length) candidates.push({ index: idx, line: lines[idx] });
  if (change.snippet) {
    lines.forEach((l, i) => {
      if (l.includes(change.snippet) && i !== idx) candidates.push({ index: i, line: l });
    });
  }
  const target = candidates.find((c) => c.line.includes(change.from)) ?? null;
  if (target == null) {
    // Idempotency: if the only candidate already shows `to` and no longer
    // `from`, the change already landed — no-op.
    const first = candidates[0];
    if (first && first.line.includes(change.to) && !first.line.includes(change.from)) {
      return { status: 'already-applied' };
    }
    return { status: 'no-match', reason: `no line found containing "${change.from}"` };
  }

  const re = QUOTED_GLYPH_RE(change.from);
  if (!re.test(target.line)) {
    return { status: 'no-match', reason: `"${change.from}" not found as a quoted glyph token` };
  }

  const next = target.line.replace(re, (_m, q) => `${q}${change.to}${q}`);
  if (next === target.line) return { status: 'no-match', reason: 'replacement produced no change' };
  return { status: 'ok', index: target.index, line: next };
}

// ── Core apply pass ──────────────────────────────────────────────────────────
// Validates everything first (batched): collect per-file edits, then write each
// file exactly once. No file is written until every change targeting it has been
// resolved — a failing match aborts that file wholesale.
function applyChanges(changes, { dryRun = false } = {}) {
  const byFile = new Map();
  const summary = { ok: [], alreadyApplied: [], failed: [] };

  for (const change of changes) {
    const abs = resolve(ROOT, change.file);
    const rel = resolve(ROOT).length ? change.file : change.file;
    let entry = byFile.get(abs);
    if (!entry) {
      const ok = existsSync(abs);
      entry = { file: rel, abs, ok, lines: null, edits: [], alreadyApplied: 0, failed: [] };
      if (ok) entry.lines = readFileSync(abs, 'utf8').split(/\r?\n/);
      byFile.set(abs, entry);
    }
    if (!entry.ok) {
      entry.failed.push({ change, reason: 'file not found' });
      summary.failed.push({ ...change, reason: 'file not found' });
      continue;
    }
    const result = applyToFile(entry.lines, change);
    if (result.status === 'ok') {
      entry.edits.push({ index: result.index, nextLine: result.line });
      summary.ok.push(change);
    } else if (result.status === 'already-applied') {
      entry.alreadyApplied += 1;
      summary.alreadyApplied.push(change);
    } else {
      entry.failed.push({ change, reason: result.reason });
      summary.failed.push({ ...change, reason: result.reason });
    }
  }

  // A file with any failed match is not written at all (no half-applied state).
  for (const entry of byFile.values()) {
    if (entry.failed.length > 0) entry.edits = [];
  }

  if (dryRun) return { summary, written: [], skippedFiles: [...byFile.values()].filter((e) => e.failed.length > 0).map((e) => e.file) };

  const written = [];
  for (const entry of byFile.values()) {
    if (entry.edits.length === 0) continue;
    const edited = new Map(entry.edits.map((e) => [e.index, e.nextLine]));
    const out = entry.lines.map((l, i) => edited.get(i) ?? l).join('\n');
    writeFileSync(entry.abs, out, 'utf8');
    written.push({ file: entry.file, edits: entry.edits.length });
  }
  return { summary, written };
}

// ── Audit regeneration ───────────────────────────────────────────────────────
// After a successful apply the source changed, so the generated audit data is
// stale. Re-run the generator so the dev tool's list matches the code again.
function regenerateAudit() {
  try {
    execFileSync(process.execPath, ['scripts/generate-icon-audit.mjs'], { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch (err) {
    console.error('[apply] audit regeneration failed:', err?.message ?? err);
    return false;
  }
}

// ── Reporting ────────────────────────────────────────────────────────────────
function printReport({ summary, written, dryRun }) {
  const mode = dryRun ? 'DRY RUN (no files written)' : 'APPLIED';
  console.log(`\n=== Icon changes: ${mode} ===`);
  console.log(`  ok: ${summary.ok.length}  already-applied: ${summary.alreadyApplied.length}  failed: ${summary.failed.length}`);
  for (const w of written) console.log(`  wrote ${w.edits} change(s) → ${w.file}`);
  for (const c of summary.ok) console.log(`  + ${c.file}:${c.line}  ${c.from} → ${c.to}`);
  for (const c of summary.alreadyApplied) console.log(`  ~ ${c.file}:${c.line}  already ${c.to}`);
  for (const c of summary.failed) console.log(`  ! ${c.file}:${c.line}  ${c.from} → ${c.to}  (${c.reason})`);
  if (summary.failed.length > 0 && !dryRun) {
    const files = [...new Set(summary.failed.map((c) => c.file))];
    console.log(`\n  To undo the files written this run:  git checkout -- ${files.join(' ')}`);
    console.log('  Failed matches were NOT applied (their files were skipped entirely).');
  }
}

// ── HTTP serve mode (web dev tool → local apply) ─────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function startServer(port) {
  const server = http.createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/ping') {
      send(200, { ok: true, service: 'icon-changes', hint: 'POST /apply with { changes: [...] }' });
      return;
    }

    if (req.method === 'POST' && req.url === '/apply') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 10 * 1024 * 1024) {
          send(413, { ok: false, error: 'payload too large' });
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const changes = normalizePayload(body);
          const result = applyChanges(changes);
          printReport({ ...result, dryRun: false });
          const regenerated = result.summary.ok.length > 0 ? regenerateAudit() : false;
          if (regenerated) console.log('  regenerated lib/devtools/icon-audit-data.ts + .json');
          send(200, {
            ok: true,
            applied: result.summary.ok.length,
            alreadyApplied: result.summary.alreadyApplied.length,
            failed: result.summary.failed.length,
            regenerated,
            failures: result.summary.failed.map((c) => ({ file: c.file, line: c.line, reason: c.reason })),
          });
        } catch (err) {
          send(400, { ok: false, error: String(err?.message ?? err) });
        }
      });
      return;
    }

    send(404, { ok: false, error: 'not found' });
  });

  server.listen(port, () => {
    console.log(`\nIcon-changes apply server listening on http://localhost:${port}`);
    console.log('  POST /apply   → apply { changes: [...] }');
    console.log('  GET  /ping    → health check\n');
  });
  server.on('error', (err) => {
    console.error(`Failed to start server on :${port} — ${err?.message ?? err}`);
    console.error('Is another instance already running?');
    process.exit(1);
  });
  return server;
}

// ── CLI entry ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

function usage() {
  console.log(`Usage:
  node scripts/apply-icon-changes.mjs <payload.json> [--dry-run]   apply a saved payload
  node scripts/apply-icon-changes.mjs --serve [port]               start the local apply server (default 8787)
  node scripts/apply-icon-changes.mjs --help`);
}

if (args.includes('--help') || args.length === 0) {
  usage();
  process.exit(0);
}

if (args.includes('--serve')) {
  const portArg = args[args.indexOf('--serve') + 1];
  const port = portArg && /^\d+$/.test(portArg) ? Number(portArg) : 8787;
  startServer(port);
} else {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    usage();
    process.exit(1);
  }
  const dryRun = args.includes('--dry-run');
  const payload = normalizePayload(readFileSync(resolve(file), 'utf8'));
  const result = applyChanges(payload, { dryRun });
  printReport({ ...result, dryRun });
  if (!dryRun && result.written.length > 0) {
    const regenerated = regenerateAudit();
    console.log(regenerated ? '\n  regenerated lib/devtools/icon-audit-data.ts + .json' : '\n  ! audit regeneration failed (run `node scripts/generate-icon-audit.mjs` manually)');
  }
  process.exit(result.summary.failed.length > 0 ? 2 : 0);
}
