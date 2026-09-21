import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const topBar = readFileSync('components/sidebar/TopBar.web.tsx', 'utf8');
const pullTab = readFileSync('components/sidebar/TopBarPullTab.web.tsx', 'utf8');
const island = readFileSync('components/island/DynamicIsland.web.tsx', 'utf8');
const retractable = readFileSync('components/sidebar/RetractableTopBar.web.tsx', 'utf8');
const guideRegistry = readFileSync('lib/contextualGuides.ts', 'utf8');
const coachMark = readFileSync('components/guides/GuideCoachMark.web.tsx', 'utf8');
const helpButton = readFileSync('components/guides/GuideHelpButton.tsx', 'utf8');

assert.equal((topBar.match(/id="top-bar:navigation"/g) ?? []).length, 1, 'TopBar registers one navigation anchor');
assert.match(topBar, /<GuideAnchor id="top-bar:navigation"[\s\S]*?(?:openPalette|PinnedShortcuts|TimelineStrip)/, 'navigation anchor covers real navigation controls');
assert.equal((island.match(/id="top-bar:activity"/g) ?? []).length, 1, 'DynamicIsland registers one activity anchor');
assert.match(island, /<GuideAnchor id="top-bar:activity"[\s\S]*?data-island-anchor/, 'activity anchor covers the rendered island');
assert.match(pullTab, /<DynamicIsland[\s\S]*leading=/, 'pull tab renders the activity island');
assert.equal((retractable.match(/<TopBarPullTab\b/g) ?? []).length, 1, 'responsive top bar mounts a single pull-tab island');
assert.match(topBar, /<GuideHelpButton guideId="top-bar"\s*\/>/, 'TopBar Help launches the registered guide');
assert.equal((topBar.match(/<GuideHelpButton\b/g) ?? []).length, 1, 'TopBar has one contextual Help launcher');
assert.match(helpButton, /min-h-\[44px\].*min-w-\[44px\]/, 'shared Help launcher keeps a 44px minimum target');
assert.match(guideRegistry, /id: 'top-bar',[\s\S]*anchorId: 'top-bar:navigation'[\s\S]*anchorId: 'top-bar:activity'/, 'both anchors remain registered in the top-bar guide');
assert.doesNotMatch(coachMark, /<Popup\b|components\/common\/Popup/, 'contextual guide does not open a centered modal or backdrop');
assert.match(coachMark, /right-4 top-\[76px\]/, 'contextual guide stays aligned beneath the right-side launchers');

console.log('topBarContextualGuide.check: ok');
