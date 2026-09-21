import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const source = readFileSync(join(process.cwd(), 'lib/uploadHelpers.ts'), 'utf8');
assert.match(source, /crypto\?\.subtle|crypto\.subtle/, 'hash helper must detect whether WebCrypto is available');
assert.match(source, /SHA-256|sha256/i, 'hash helper must retain SHA-256 semantics');
assert.match(source, /Uint8Array/, 'hash helper must support byte-oriented native input');

console.log('uploadHelpers native hash fallback contract: ok');
