import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync('app/(tabs)/people.tsx', 'utf8');
const grid = readFileSync('components/admin/TeamAssignmentGrid.tsx', 'utf8');
const guideRegistry = readFileSync('lib/contextualGuides.ts', 'utf8');

assert.match(screen, /<WebComponent\s*\/>[\s\S]*<AdaptiveComponent\s*\/>/, 'the reachable People screen keeps its platform switch');
assert.equal((grid.match(/id="team-people:list"/g) ?? []).length, 1, 'the Teams screen registers one list anchor');
assert.match(grid, /<GuideAnchor id="team-people:list" className="flex-1">\s*<MultiViewList/, 'the list anchor covers the actual team list');
assert.equal((grid.match(/id="team-people:primary-action"/g) ?? []).length, 1, 'the Teams screen registers one primary action anchor');
assert.match(grid, /<GuideAnchor id="team-people:primary-action">\s*<View className="flex-row items-center gap-2">[\s\S]*?\{canAssignRoles && selectionMode && selectedTeamIds\.size > 0 \?[\s\S]*?\+ New Team/, 'the primary action anchor covers the existing capability-conditional management actions');
assert.doesNotMatch(grid, /GuideHelpButton/, 'the Teams screen has no per-screen Help launcher');
assert.match(guideRegistry, /id: 'team-people',[\s\S]*anchorId: 'team-people:list'[\s\S]*anchorId: 'team-people:primary-action'/, 'the Team & People guide refers to both registered anchors');

console.log('TeamContextualGuide.check: ok');
