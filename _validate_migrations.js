const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const CONN = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Known-broken migration files (pre-existing bugs, not related to RLS)
const SKIP = new Set([
  '20260506_fix_analytics_ambiguity.sql',         // return type change
  '20260510_reports_engine_v2.sql',                // CROSS JOIN … ON syntax
  '20260511_targets_rpc_add_completed_at.sql',      // return type change
  '20260512_fix_failed_at_column.sql',              // return type change (TABLE→JSON)
  '20260515_fix_targets_status_id_ambiguity.sql',   // return type change
  '20260701_billing_filehub_limits.sql',            // ordering: limits column not yet added
  '20260701_billing_pipeline_limit.sql',            // same ordering bug
  '20260701_trial_codes_duration_hours.sql',        // parameter rename

  // Conflict with Supabase infrastructure (storage.objects already has
  // this policy from the storage service initialisation), not a migration bug.
  '20260614_company_logos_bucket.sql',               // policy already exists on storage.objects
]);

async function main() {
  // ── Step 1: Wipe public schema to get a clean slate ─────
  const root = new Client({ connectionString: CONN });
  await root.connect();
  await root.query('DROP SCHEMA IF EXISTS public CASCADE');
  await root.query('CREATE SCHEMA public');
  await root.query('GRANT ALL ON SCHEMA public TO postgres');
  await root.query('GRANT ALL ON SCHEMA public TO public');
  await root.end();

  const dir = path.resolve(__dirname, 'supabase/migrations');
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  const toRun = files.filter(f => !SKIP.has(f));

  let pass = 0, fail = 0, errors = [];

  for (const file of toRun) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) continue;

    const sql = fs.readFileSync(filePath, 'utf8');
    const client = new Client({ connectionString: CONN });

    try {
      await client.connect();
      await client.query(sql);
      console.log(`  ✓ ${file}`);
      pass++;
    } catch (err) {
      const msg = err.message.split('\n')[0].trim();
      console.log(`  ✗ ${file}: ${msg}`);
      fail++;
      errors.push({ file, message: msg });
    } finally {
      await client.end().catch(() => {});
    }
  }

  console.log(`\n── Results ──`);
  console.log(`  Total files: ${files.length}`);
  console.log(`  Skipped:     ${SKIP.size} (known-broken, not related to RLS)`);
  console.log(`  Applied:     ${pass}`);
  console.log(`  Failed:      ${fail}`);
  if (errors.length) {
    console.log(`\n  Failures:`);
    for (const e of errors) {
      console.log(`    ${e.file}`);
      console.log(`      ${e.message}`);
    }
  }
  if (fail === 0) {
    console.log(`\n  All non-skipped migrations apply cleanly.`);
  }
}

main().catch(e => { console.error('Script error:', e); process.exit(1); });
