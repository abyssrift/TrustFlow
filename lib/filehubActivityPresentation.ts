export type ActivityTone = 'success' | 'info' | 'warning' | 'danger' | 'muted';

export type ActivityPresentation = {
  label: string;
  icon: string;
  tone: ActivityTone;
};

export type ActivityDetail = { label: string; value: string };

const META: Record<string, ActivityPresentation> = {
  upload: { label: 'Uploaded', icon: 'upload', tone: 'success' },
  download: { label: 'Downloaded', icon: 'download', tone: 'info' },
  view: { label: 'Viewed', icon: 'eye', tone: 'info' },
  delete: { label: 'Deleted', icon: 'trash-o', tone: 'danger' },
  share: { label: 'Shared', icon: 'share', tone: 'warning' },
  rename: { label: 'Renamed', icon: 'pencil', tone: 'info' },
  move: { label: 'Moved', icon: 'arrows', tone: 'info' },
  restore: { label: 'Restored', icon: 'undo', tone: 'success' },
  share_revoke: { label: 'Share revoked', icon: 'ban', tone: 'danger' },
  folder_create: { label: 'Folder created', icon: 'folder-o', tone: 'success' },
  folder_delete: { label: 'Folder deleted', icon: 'trash-o', tone: 'danger' },
};

const SAFE_KEYS: Record<string, string> = {
  file_name: 'File', name: 'Name', folder_name: 'Folder', target_name: 'Target',
  location: 'Location', path: 'Location', from_location: 'From', to_location: 'To',
  from: 'Previous', to: 'New value', change: 'Change', reason: 'Context',
  note: 'Context', source: 'Context', destination: 'Destination', shared_with: 'Shared with', version_no: 'Version',
};
const SECRET = /(token|secret|password|authorization|bearer)/i;

export function getActivityPresentation(action: string): ActivityPresentation {
  return META[action] ?? { label: action ? humanize(action) : 'Unknown action', icon: 'question-circle', tone: 'muted' };
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown action';
}

function safeValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  const text = String(value).trim();
  if (!text || SECRET.test(text) || /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(text)) return null;
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export function formatActivityDetails(metadata: Record<string, unknown> | null | undefined): ActivityDetail[] {
  if (!metadata) return [];
  return Object.entries(metadata).reduce<ActivityDetail[]>((details, [key, value]) => {
    const label = SAFE_KEYS[key.toLowerCase()];
    const text = safeValue(value);
    if (label && text) details.push({ label, value: text });
    return details;
  }, []);
}

export function formatActivitySummary(action: string, metadata: Record<string, unknown> | null | undefined) {
  const details = formatActivityDetails(metadata);
  const value = (label: string) => details.find(item => item.label === label)?.value;
  const target = value('Target') ?? value('File') ?? value('Folder') ?? value('Name') ?? 'Current FileHub item';
  const fromLocation = value('From');
  const toLocation = value('To');
  const previousValue = value('Previous');
  const newValue = value('New value');
  const location = value('Location')
    ?? (fromLocation && toLocation ? `${fromLocation} → ${toLocation}` : fromLocation ?? toLocation ?? 'Not recorded');
  let change = value('Change') ?? value('Context') ?? 'Not recorded';
  if (action === 'rename' && previousValue && newValue) change = `${previousValue} → ${newValue}`;
  if (action === 'move' && fromLocation && toLocation) change = `${fromLocation} → ${toLocation}`;
  if (action === 'restore' && value('Version')) change = `Restored to version ${value('Version')}`;
  if (action === 'share_revoke') change = `Sharing revoked for ${target}`;
  if (action === 'folder_create') change = `Created ${target}`;
  if (action === 'folder_delete') change = `Deleted ${target}`;
  return { target, location, change };
}

export function activityDateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown-date';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatActivityDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

export function formatActivityExactTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

export function groupActivities<T extends { created_at: string }>(items: T[]): Array<{ key: string; label: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach(item => {
    const key = activityDateKey(item.created_at);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return [...groups].map(([key, grouped]) => ({ key, label: formatActivityDate(grouped[0].created_at), items: grouped }));
}
