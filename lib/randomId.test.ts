// Self-check for randomId — run: npx tsx lib/randomId.test.ts
// No framework (ponytail): plain asserts. Swaps globalThis.crypto to prove each
// fallback tier works, since the whole point is surviving envs where
// crypto.randomUUID is missing (non-secure context / Hermes).
import assert from 'node:assert';
import { randomId } from './randomId';

const realCrypto = (globalThis as any).crypto;
const setCrypto = (v: any) => Object.defineProperty(globalThis, 'crypto', { value: v, configurable: true });
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

try {
  // Tier 1: native randomUUID is used when present.
  setCrypto({ randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  assert.equal(randomId(), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

  // Tier 2: no randomUUID (the non-secure-context case) -> real v4 from
  // getRandomValues, with correct version/variant bits.
  setCrypto({
    getRandomValues: (a: Uint8Array) => { for (let i = 0; i < a.length; i++) a[i] = 0xff; return a; },
  });
  const v4 = randomId();
  assert.match(v4, V4, `getRandomValues fallback must emit a valid v4, got ${v4}`);
  // All-0xff input still must have the version/variant nibbles forced.
  assert.equal(v4[14], '4', 'version nibble must be 4');
  assert.ok(['8', '9', 'a', 'b'].includes(v4[19]), 'variant nibble must be 8/9/a/b');

  // Tier 3: no crypto at all (Hermes without a polyfill) -> still returns a
  // usable, unique, path-safe segment rather than throwing.
  setCrypto(undefined);
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const id = randomId();
    assert.ok(id.length > 0, 'must not be empty');
    assert.match(id, /^[0-9a-f-]+$/, `must stay path-safe, got ${id}`);
    ids.add(id);
  }
  assert.equal(ids.size, 1000, 'last-resort ids must not collide across 1000 draws');

  console.log('randomId: all checks passed');
} finally {
  setCrypto(realCrypto);
}
