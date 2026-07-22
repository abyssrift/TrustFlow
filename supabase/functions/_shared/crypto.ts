// AES-GCM encrypt/decrypt for stored import credentials.
// Web Crypto (`crypto.subtle`) is a Deno global — no std import needed.
// If IMPORT_ENCRYPTION_KEY is unset (local dev only) we fall back to base64
// plaintext so the flow still runs; NEVER deploy without the key set.

const KEY = Deno.env.get('IMPORT_ENCRYPTION_KEY') ?? '';

async function aesKey(usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(KEY.padEnd(32, ' ').slice(0, 32));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usage);
}

export async function encryptJson(obj: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  if (!KEY) return btoa(String.fromCharCode(...data)); // ponytail: dev-only plaintext
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(['encrypt']), data));
  const combined = new Uint8Array(iv.length + enc.length);
  combined.set(iv);
  combined.set(enc, iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptJson(s: string): Promise<any> {
  const raw = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if (!KEY) return JSON.parse(new TextDecoder().decode(raw)); // ponytail: dev-only plaintext
  const iv = raw.slice(0, 12);
  const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(['decrypt']), raw.slice(12));
  return JSON.parse(new TextDecoder().decode(dec));
}
