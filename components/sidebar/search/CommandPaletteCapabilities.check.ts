import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('components/sidebar/search/CommandPalette.web.tsx', 'utf8');
const expected = [
  'task.create',
  'project.create',
  'portfolio.create',
  'report.generate',
  'role.create',
  'upload.create',
];

const actionBlock = source.match(/const all: CreateAction\[\] = \[([\s\S]*?)\n    \];/)?.[1];
assert.ok(actionBlock, 'create action registry should be present');
for (const capability of expected) {
  assert.match(actionBlock, new RegExp(`capability: '${capability}'`), `${capability} action must declare its capability`);
}
assert.equal((actionBlock.match(/capability:/g) ?? []).length, expected.length, 'every create action must declare exactly one capability');
assert.doesNotMatch(actionBlock, /permission:/, 'create actions must not carry a parallel permission gate');
assert.match(source, /all\.filter\(\(a\) => capabilities\[a\.capability\]\?\.allowed === true\)/, 'action visibility must use only the declared capability decision');
assert.doesNotMatch(actionBlock, /report\.view/, 'report actions must not have an extra report.view gate');

for (const [capability, summon] of [
  ['task.create', 'create-task'],
  ['project.create', 'create-project'],
  ['portfolio.create', 'create-portfolio'],
  ['report.generate', 'generate-report'],
  ['role.create', 'new-role'],
  ['upload.create', 'upload'],
] as const) {
  const escaped = capability.replace('.', '\\.');
  assert.match(actionBlock, new RegExp(`capabilities\\['${escaped}'\\]\\?\\.allowed === true\\) summon\\('${summon}'\\)`), `${summon} run handler must recheck ${capability}`);
}

assert.match(source, /input\.mode === 'create-task'[\s\S]*?capabilities\['task\.create'\]\?\.allowed === true/, 'task prefix visibility must require task.create');
assert.match(source, /input\.mode === 'create-project'[\s\S]*?capabilities\['project\.create'\]\?\.allowed === true/, 'project prefix visibility must require project.create');
assert.match(source, /const capability = entity === 'task' \? 'task\.create' : 'project\.create';\s*if \(capabilities\[capability\]\?\.allowed !== true\) return;/, 'inline create runner must fail closed against its matching capability');
assert.match(source, /const showCreateHint =[\s\S]*?capabilities\['task\.create'\]\?\.allowed === true/, 'no-results fallback visibility must require task.create');
assert.match(source, /else if \(showCreateHint\) \{[\s\S]*?if \(capabilities\['task\.create'\]\?\.allowed === true\) \{\s*summon\('create-task'\)/, 'keyboard fallback invocation must recheck task.create');
assert.match(source, /onPress=\{\(\) => \{\s*if \(capabilities\['task\.create'\]\?\.allowed === true\) \{\s*summon\('create-task'\)/, 'click fallback invocation must recheck task.create');

console.log('CommandPalette capability checks passed');
