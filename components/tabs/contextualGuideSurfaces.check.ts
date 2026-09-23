import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profile = readFileSync('app/(tabs)/profile.tsx', 'utf8');
const profileDesktop = readFileSync('components/tabs/_profile_desktop.tsx', 'utf8');
const profileAdaptive = readFileSync('components/tabs/_profile_adaptive.tsx', 'utf8');
const desktop = readFileSync('components/tabs/_tasks_desktop.tsx', 'utf8');
const adaptive = readFileSync('components/tabs/_tasks_adaptive.tsx', 'utf8');
const nativeLayout = readFileSync('app/_layout.tsx', 'utf8');
const webLayout = readFileSync('app/_layout.web.tsx', 'utf8');

assert.doesNotMatch(profile, /GuideHelpButton/, 'profile has no per-screen Help launcher');
assert.doesNotMatch(profile, /id="profile:identity"/, 'identity anchor belongs to the details section, not the screen wrapper');
assert.equal((profileDesktop.match(/id="profile:identity"/g) ?? []).length, 1, 'desktop profile has exactly one identity anchor');
assert.equal((profileAdaptive.match(/id="profile:identity"/g) ?? []).length, 1, 'adaptive profile has exactly one identity anchor');

for (const [name, source] of [['desktop', desktop], ['adaptive', adaptive]] as const) {
  assert.doesNotMatch(source, /GuideHelpButton/, `${name} has no per-screen Help launcher`);
  assert.match(source, /GuideAnchor[\s\S]*id="tasks:board"/, `${name} board anchor`);
  assert.equal((source.match(/id="tasks:move"/g) ?? []).length, 1, `${name} tasks screen has exactly one movement anchor`);
  assert.match(source, /<GuideAnchor id="tasks:move" className="flex-1">[\s\S]*?(?:<ScrollView|<HorizontalScroll)/, `${name} movement anchor preserves board sizing`);
  assert.doesNotMatch(source, /\{tasks\.length\s*>\s*0\s*&&\s*<GuideAnchor id="tasks:move"/, `${name} movement anchor remains available on an empty board`);
  assert.doesNotMatch(source.match(/const renderTaskCard[\s\S]*?\n  };/)?.[0] ?? '', /id="tasks:move"/, `${name} task cards do not duplicate the movement anchor`);
}

assert.match(nativeLayout, /TAB_BAR_HEIGHT\.native\s*\+\s*16/);
assert.match(webLayout, /TAB_BAR_HEIGHT\.web\s*\+\s*16/);
for (const [name, source] of [['native', nativeLayout], ['web', webLayout]] as const) {
  assert.match(source, /width\s*<\s*768[\s\S]{0,180}TAB_BAR_HEIGHT/, `${name} launcher is placed above the mobile nav`);
  assert.match(source, /launcherBottom=\{width\s*<\s*768\s*\?\s*TAB_BAR_HEIGHT\.(?:native|web)\s*\+\s*16\s*:\s*undefined\}/, `${name} launcher leaves desktop on the host's quiet default placement`);
}
