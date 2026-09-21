import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const native = readFileSync(join(process.cwd(), 'components/guides/GuideCoachMark.tsx'), 'utf8');
const web = readFileSync(join(process.cwd(), 'components/guides/GuideCoachMark.web.tsx'), 'utf8');

assert.doesNotMatch(web, /from\s+['"]\.\/GuideCoachMark['"]/, 'web must not import its own platform-resolved module');
for (const [platform, source] of [['native', native], ['web', web]] as const) {
  assert.match(source, /import\s*\{\s*GuideCoachPanel\s*\}\s*from\s*['"]\.\/GuideCoachPanel['"]/, `${platform} must import the shared panel`);
  assert.doesNotMatch(source, /components\/common\/Popup/, `${platform} guide card must not use a modal or backdrop`);
  assert.match(source, /right-4 top-\[76px\]/, `${platform} guide card stays at the upper-right beneath its launcher`);
  assert.match(source, /Math\.min\(360, width - 32\)/, `${platform} guide card stays compact and viewport-safe`);
}

console.log('GuideCoachMarkImports.check: ok');
