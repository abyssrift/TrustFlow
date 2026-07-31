// Uploads namespace each object as `{company_id}/{randomId()}/{filename}`, so
// this value only has to be unique within the bucket — it is never the DB id
// (the server generates that with gen_random_uuid()). It still must not
// collide, because two files landing on the same storage path would overwrite
// each other.
//
// FileHub previously called `(crypto as any).randomUUID()` directly. The `as
// any` hid the fact that it isn't always there:
//   - `crypto.randomUUID` is only exposed in SECURE contexts, so it is
//     undefined when the web app is opened over plain http:// (e.g. testing
//     against a LAN IP), throwing "randomUUID is not a function" mid-upload.
//   - React Native's Hermes has no global crypto unless a polyfill is
//     installed, and this project ships none.
//
// So: prefer randomUUID, fall back to getRandomValues (still a real v4), and
// only then to a non-crypto value that is merely unique-enough for a path.
/** 16 random bytes → a canonical v4 string. The one bit of formatting logic. */
function bytesToUuidV4(b: Uint8Array): string {
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10x
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function randomId(): string {
  const c: any = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;

  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === 'function') {
    return bytesToUuidV4(c.getRandomValues(new Uint8Array(16)));
  }

  // Last resort: not cryptographically random, but ample to keep one company's
  // upload paths from colliding.
  //
  // This branch MUST still return a well-formed v4 string. It used to emit
  // `${Date.now().toString(16)}-...`, which is uuid-ish but not a uuid — fine
  // as a storage path segment, and an instant failure for any caller that
  // passes it to a uuid column (filehub_file_versions.batch_id does). Keeping
  // every branch of this function uuid-shaped removes that trap entirely.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytesToUuidV4(bytes);
}

/** Matches any RFC-4122 v4 uuid. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ponytail: one check for the only thing that can break — the byte→uuid
// formatting shared by both non-native branches. Global `crypto` is a
// getter-only property in Node, so this tests the seam directly instead of
// monkey-patching it. Run: npx tsx -e "import{__selfCheck}from'./lib/randomId';console.log(__selfCheck())"
export function __selfCheck(): string {
  for (let i = 0; i < 1000; i++) {
    const b = new Uint8Array(16);
    for (let j = 0; j < 16; j++) b[j] = Math.floor(Math.random() * 256);
    const id = bytesToUuidV4(b);
    if (!UUID_V4.test(id)) throw new Error(`bytesToUuidV4 produced a non-uuid: ${id}`);
  }
  // All-zero and all-0xff bytes are the edge cases for the version/variant masks.
  for (const fill of [0x00, 0xff]) {
    const id = bytesToUuidV4(new Uint8Array(16).fill(fill));
    if (!UUID_V4.test(id)) throw new Error(`bytesToUuidV4(${fill}) produced a non-uuid: ${id}`);
  }
  if (!UUID_V4.test(randomId())) throw new Error('randomId() did not return a v4 in this runtime');
  return 'randomId: bytesToUuidV4 valid across 1000 random + both mask edge cases';
}
