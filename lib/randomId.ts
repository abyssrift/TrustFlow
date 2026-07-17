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
export function randomId(): string {
  const c: any = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;

  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }

  if (c && typeof c.getRandomValues === 'function') {
    const b: Uint8Array = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10x
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Last resort: not cryptographically random, but time-ordered + 96 bits of
  // Math.random is ample to keep one company's upload paths from colliding.
  const rand = () => Math.random().toString(16).slice(2).padEnd(13, '0');
  return `${Date.now().toString(16)}-${rand().slice(0, 8)}-${rand().slice(0, 12)}`;
}
