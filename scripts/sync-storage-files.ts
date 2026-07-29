// One-off: copies real file bytes from every prod storage bucket into the local
// Supabase stack (bucket *definitions* already exist locally via
// supabase/migrations/20260101000001_platform_config.sql — this fills them with content).
//
// Usage (run this yourself — the prod key never goes through Claude or this chat):
//   PowerShell : $env:PROD_SERVICE_ROLE_KEY="paste-key-here"; npx tsx scripts/sync-storage-files.ts
//   bash       : PROD_SERVICE_ROLE_KEY="paste-key-here" npx tsx scripts/sync-storage-files.ts
//
// Get the key from Dashboard → Project Settings → API Keys → service_role (secret).
// Viewing/copying it does not rotate it.

import { createClient } from '@supabase/supabase-js';

const PROD_URL = 'https://wbvgufqfgbvbinjrdzlg.supabase.co';
const LOCAL_URL = 'http://127.0.0.1:54321';
// Fixed local dev demo key — same for every `supabase start`, not a secret.
const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const BUCKETS = [
  'avatars',
  'company-logos',
  'filehub-files',
  'kanban-backgrounds',
  'ping-sounds',
  'reports',
  'submission-attachments',
  'task-attachments',
  'task-submissions',
];

async function main() {
  const prodKey = process.env.PROD_SERVICE_ROLE_KEY;
  if (!prodKey) {
    console.error('Set PROD_SERVICE_ROLE_KEY in your shell before running this script.');
    process.exit(1);
  }

  const prod = createClient(PROD_URL, prodKey);
  const local = createClient(LOCAL_URL, LOCAL_SERVICE_ROLE_KEY);

  let ok = 0;
  let failed = 0;

  for (const bucket of BUCKETS) {
    console.log(`\n--- ${bucket} ---`);
    const paths = await listAllFiles(prod, bucket);
    console.log(`${paths.length} file(s)`);

    for (const path of paths) {
      const { data, error } = await prod.storage.from(bucket).download(path);
      if (error || !data) {
        console.error(`  download failed: ${path} (${error?.message})`);
        failed++;
        continue;
      }
      const { error: upErr } = await local.storage
        .from(bucket)
        .upload(path, data, { upsert: true, contentType: data.type || undefined });
      if (upErr) {
        console.error(`  upload failed: ${path} (${upErr.message})`);
        failed++;
        continue;
      }
      console.log(`  ✓ ${path}`);
      ok++;
    }
  }

  console.log(`\nDone. ${ok} copied, ${failed} failed.`);
}

async function listAllFiles(
  client: ReturnType<typeof createClient>,
  bucket: string,
  prefix = ''
): Promise<string[]> {
  const paths: string[] = [];
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;

  for (const entry of data ?? []) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // Folder placeholder entries have no id — recurse into them.
      paths.push(...(await listAllFiles(client, bucket, fullPath)));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

main();
