import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');
const block = fs.readFileSync(path.join(root, 'components/common/Block.tsx'), 'utf8');
const entity = fs.readFileSync(path.join(root, 'components/entities/EntityUI.tsx'), 'utf8');
const retention = fs.readFileSync(path.join(root, 'components/admin/RetentionPanel.tsx'), 'utf8');

for (const token of ['title?: string', 'hint?: string', 'icon?: React.ReactNode', 'right?: React.ReactNode', 'accent?: string', 'rounded-2xl', 'p-4 md:p-5']) {
  if (!block.includes(token)) throw new Error(`Block API/default missing: ${token}`);
}
if (!entity.includes("<Block") || !entity.includes('eyebrow={kind ? <EntityTag kind={kind} /> : undefined}')) {
  throw new Error('SectionCard is not backed by Block with entity compatibility composition');
}
if (!fs.readFileSync(path.join(root, 'components/intelligence/ProjectLens.tsx'), 'utf8').includes('eyebrow={<EntityTag kind="portfolio" />}')) {
  throw new Error('ProjectLens must preserve entity eyebrow semantics when adopting Block');
}
if ((retention.match(/<Block/g) || []).length !== 4) throw new Error('RetentionPanel should adopt all four top-level blocks');
if (retention.includes('bg-surface-card border border-surface-border rounded-2xl p-5')) throw new Error('RetentionPanel retains an ad-hoc top-level shell');
for (const title of ['title="Policy"', 'title="Inactive members"', 'title="Danger Zone"']) {
  if (!retention.includes(title)) throw new Error(`Retention header missing Block API: ${title}`);
}

console.log('Block.check.ts: OK');
