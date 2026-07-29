export type QuickAction = {
  label: string;
  days: number;
};

export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Today',     days: 0 },
  { label: 'Tomorrow',  days: 1 },
  { label: '+3 Days',   days: 3 },
  { label: '+1 Week',   days: 7 },
  { label: '+2 Weeks',  days: 14 },
  { label: '+1 Month',  days: 30 },
];

export function getQuickActionDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
