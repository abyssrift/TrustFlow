import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const variant of ['desktop', 'adaptive'] as const) {
  const source = readFileSync(`components/intelligence/_filehub_${variant}.tsx`, 'utf8');
  const label = `${variant} File Hub`;

  assert.equal((source.match(/id="filehub:navigation"/g) ?? []).length, 1, `${label} has one navigation anchor`);
  assert.equal((source.match(/id="filehub:primary-action"/g) ?? []).length, 1, `${label} has one primary action anchor`);
  assert.match(source, /GuideHelpButton[\s\S]*guideId="filehub"/, `${label} exposes the File Hub guide`);
  assert.match(source, /<GuideAnchor id="filehub:navigation"[\s\S]*?(?:tabs\.map|<ScrollView horizontal)/, `${label} navigation anchor covers browsing navigation`);
  assert.match(source, /canUpload\s*&&[\s\S]{0,180}<GuideAnchor id="filehub:primary-action"/, `${label} primary action anchor keeps the existing upload capability gate`);
}

console.log('File Hub contextual guide checks passed.');
