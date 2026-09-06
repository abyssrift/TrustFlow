#!/usr/bin/env node
/** Cross-platform Expo web export with the repository's public-asset overlay. */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['expo', 'export', '-p', 'web'], {
  stdio: 'inherit',
  // Windows exposes npx through a .cmd shim; shell mode makes that shim
  // callable while the argument list remains fixed and repository-owned.
  shell: process.platform === 'win32',
});
if (result.error) console.error(`Unable to start Expo export: ${result.error.message}`);
if (result.status !== 0) process.exit(result.status ?? 1);

const publicDir = join(root, 'public');
const distDir = join(root, 'dist');
async function copyPublic(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const source = join(dir, entry.name);
    if (entry.isDirectory()) { await copyPublic(source); continue; }
    if (entry.name === 'index.html') continue;
    // GNU cp --parents public/foo dist/ produced dist/public/foo; retain that
    // exact layout so existing deployments and references remain unchanged.
    const destination = join(distDir, relative(root, source));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { force: true });
  }
}
await copyPublic(publicDir);
console.log('Copied public assets into dist (excluding public/index.html).');
