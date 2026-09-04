// Runnable check for highlightRuns — `npx tsx components/sidebar/search/highlight.check.ts`.
import { highlightRuns } from './highlight';

const eq = (a: unknown, b: unknown, m: string) =>
  console.assert(JSON.stringify(a) === JSON.stringify(b), m, a);

eq(highlightRuns('the <b>quick</b> brown <b>fox</b>'), ['the ', 'quick', ' brown ', 'fox', ''], 'basic <b> split');
eq(highlightRuns(''), [''], 'empty -> single empty run');
eq(highlightRuns(null), [''], 'null -> single empty run');
eq(highlightRuns('plain text'), ['plain text'], 'no tags -> one plain run');
eq(highlightRuns('  a\n\n<b>b</b> '), ['a ', 'b', ''], 'whitespace collapse + trim');
eq(highlightRuns('<b>lead</b> tail'), ['', 'lead', ' tail'], 'leading match');

console.log('highlight.check: ok');
