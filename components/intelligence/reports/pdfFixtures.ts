import type { TableRow } from './shared'

export const PDF_FIXTURES = {
  empty: { rows: [] as TableRow[] },
  oneRecord: { rows: [{ cells: ['One record', '0', 'N/A'] }] as TableRow[] },
  longLabels: {
    labels: [
      'A deliberately long pipeline stage label that must wrap instead of clipping',
      'مرحلة عربية طويلة لاختبار عرض الحروف غير اللاتينية',
      'ステージ名の長いラベルを折り返して表示する',
    ],
  },
  longText: 'A long methodology and caveat string that should wrap across lines without forcing a blank page or overflowing the printable area.',
  largeTable: {
    rows: Array.from({ length: 120 }, (_, index) => ({
      cells: [`Record ${index + 1}`, index % 3 === 0 ? '0' : String(index), index % 5 === 0 ? 'N/A' : 'Observed'],
    })) as TableRow[],
  },
  nullAndZero: { cells: ['N/A', '0', 'No denominator'] },
  manyCategories: { labels: Array.from({ length: 24 }, (_, index) => `Category ${index + 1}`) },
  nonLatin: { labels: ['مرحبا بالعالم', '日本語のレポート', 'Ελληνικά'] },
  allZeroTeams: { rows: ['Team A', 'Team B', 'Team C'].map(name => ({ cells: [name, '0', 'N/A'] })) as TableRow[] },
} as const
