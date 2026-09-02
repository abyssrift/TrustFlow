// Self-check for matchDestinations — run: npx tsx components/sidebar/palette-destinations.check.ts
// No framework (ponytail): plain asserts. Covers keyword match, permission
// gating, href dedupe, and the empty-query case.
import assert from 'node:assert';
import { fuzzyMatch, matchDestinations, PALETTE_DESTINATIONS } from './constants';

const owner = { hasPermission: () => true, isOwner: true, isMobile: false };
const nobody = { hasPermission: () => false, isOwner: false, isMobile: false };
const analyst = {
  hasPermission: (k: string) => k === 'analytics.view',
  isOwner: false,
  isMobile: false,
};

// 1. "compare" matches Analytics via a synonym (its label is "Analytics", not
//    "compare"), so matchedKeyword is set and the parent breadcrumb comes through.
{
  const m = matchDestinations('compare', owner);
  const analytics = m.find((d) => d.href === '/intelligence/analytics');
  assert.ok(analytics, '"compare" should surface Analytics');
  assert.equal(analytics!.matchedKeyword, 'compare', 'matchedKeyword should be the synonym that hit');
  assert.equal(analytics!.parentLabel, 'Intelligence');
  assert.equal(analytics!.topLevel, false);
}

// 2. A user with no permissions never gets a gated destination.
{
  const m = matchDestinations('roles', nobody);
  assert.ok(!m.some((d) => d.href === '/admin/roles'), 'ungated user must not see /admin/roles');
}

// 3. Same query, permitted user (analytics.view only) gets Analytics but still
//    NOT the role.manage-gated admin route.
{
  const m = matchDestinations('compare', analyst);
  assert.ok(m.some((d) => d.href === '/intelligence/analytics'), 'analyst should see Analytics');
  const roles = matchDestinations('roles', analyst);
  assert.ok(!roles.some((d) => d.href === '/admin/roles'), 'analyst lacks role.manage');
}

// 4. No href appears twice, ever — top-level wins over a sub-destination.
{
  for (const query of ['a', 'e', 'i', 'report', 'team', 'intelligence']) {
    const hrefs = matchDestinations(query, owner).map((d) => d.href);
    assert.equal(new Set(hrefs).size, hrefs.length, `dupe href for query "${query}"`);
  }
}

// 5. Empty query returns only top-level pages (no sub-routes dumped).
{
  const m = matchDestinations('', owner);
  assert.ok(m.length > 0, 'empty query should still list top-level pages');
  assert.ok(m.every((d) => d.topLevel), 'empty query must not include sub-destinations');
  const subHrefs = new Set(PALETTE_DESTINATIONS.map((d) => d.href));
  assert.ok(!m.some((d) => subHrefs.has(d.href)), 'no PALETTE_DESTINATIONS href on empty query');
}

// 6. fuzzyMatch — subsequence typos and the edit-distance fallback.
{
  assert.ok(fuzzyMatch('nwtsk', 'New Task'), '"nwtsk" is a subsequence of "New Task"');
  assert.ok(fuzzyMatch('rols', 'Roles & Permissions'), '"rols" is a subsequence of "Roles..."');
  assert.ok(fuzzyMatch('analitics', 'Analytics'), '"analitics" -> "Analytics" via 1-char edit');
  assert.equal(fuzzyMatch('zzxq', 'Dashboard'), null, 'garbage does not match');
  assert.equal(fuzzyMatch('report', 'Performance'), null, 'not a subsequence, too far to edit');
  // Exact substring outranks a gappy subsequence.
  const exact = fuzzyMatch('task', 'Tasks')!;
  const gappy = fuzzyMatch('task', 'Cold Storage Archive tasks')!;
  assert.ok(exact.score > gappy.score, 'contiguous "task" beats a scattered one');
}

// 7. Fuzzy destination lookups land the right page.
{
  // "analitics" (typo) still reaches an analytics surface — the Intelligence
  // shortcut via its "analytics" keyword, and/or the Analytics sub-route.
  const m = matchDestinations('analitics', owner);
  assert.ok(
    m.some((d) => d.href === '/intelligence' || d.href === '/intelligence/analytics'),
    '"analitics" should surface analytics'
  );
  // "rols" reaches Roles & Permissions for a permitted user, nobody else.
  assert.ok(matchDestinations('rols', owner).some((d) => d.href === '/admin/roles'), 'owner sees Roles via "rols"');
  assert.ok(!matchDestinations('rols', nobody).some((d) => d.href === '/admin/roles'), 'ungated user still gated');
}

// 8. Query present → results are sorted best-match-first.
{
  const m = matchDestinations('report', owner);
  const reportIdx = m.findIndex((d) => /report/i.test(d.label));
  assert.ok(reportIdx === 0, 'the literal "Report" match ranks first for query "report"');
}

console.log('matchDestinations: all checks passed');
