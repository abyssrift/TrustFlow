import AsyncStorage from '@react-native-async-storage/async-storage';

// Last-used import context per provider — survives modal close and app
// restarts, so an accidental dismiss (or returning to the same platform next
// week) doesn't mean retyping the instance URL or re-finding the board.
// Client-side and per-device, same pattern as filehubRecentChannels.ts.
const KEY_PREFIX = '@TrustFlow_import_lastused_';

export type LastUsedImport = {
  // Non-secret connector fields only (instanceUrl/db/username) — callers must
  // strip password-type fields before persisting.
  connectorFields?: Record<string, string>;
  projectId?: string | null;
  projectName?: string | null;
};

export async function getLastUsedImport(providerId: string): Promise<LastUsedImport | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY_PREFIX + providerId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setLastUsedImport(providerId: string, value: LastUsedImport): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PREFIX + providerId, JSON.stringify(value));
  } catch { /* storage unavailable — prefill is best-effort */ }
}
