import AsyncStorage from '@react-native-async-storage/async-storage';

// Per-user "recently visited channels" for the FileHub Overview. Client-side and
// per-device (same lightweight pattern as recent task templates) — no backend,
// no migration, and it's genuinely "visited by me".
const KEY = '@TrustFlow_filehub_recent_channels';
const MAX = 12;
let cache: string[] | null = null;

export async function recordChannelVisit(id: string): Promise<void> {
  try {
    const list = await getRecentChannelIds();
    const next = [id, ...list.filter(x => x !== id)].slice(0, MAX);
    cache = next;
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
}

export async function getRecentChannelIds(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch {
    cache = [];
  }
  return cache!;
}
