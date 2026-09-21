import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const native = readFileSync('app/admin/pipelines.tsx', 'utf8');
const web = readFileSync('app/admin/pipelines.web.tsx', 'utf8');
const guideRegistry = readFileSync('lib/contextualGuides.ts', 'utf8');

for (const [name, source] of [['native', native], ['web', web]] as const) {
  assert.equal((source.match(/<GuideAnchor id="workflow-pipelines:list"/g) ?? []).length, 1, `${name} registers one workflow list anchor`);
  assert.equal((source.match(/<GuideAnchor id="workflow-pipelines:configuration"/g) ?? []).length, 1, `${name} registers one configuration anchor`);
  assert.equal((source.match(/<GuideHelpButton\b/g) ?? []).length, 1, `${name} defines one screen Help launcher`);
  assert.match(source, /<GuideHelpButton guideId="workflow-pipelines"\s*\/>/, `${name} Help launches Workflow & Pipelines`);
}

assert.match(native, /<GuideAnchor id="workflow-pipelines:list"[^>]*>\s*<PipelineList\s*\/>\s*<\/GuideAnchor>/, 'native list anchor covers PipelineList');
assert.match(native, /<GuideAnchor id="workflow-pipelines:configuration"[^>]*>[\s\S]*?<StageBuilder\s*\/>[\s\S]*?<\/GuideAnchor>/, 'native configuration anchor covers the selected pipeline editor controls');
assert.match(web, /<GuideAnchor id="workflow-pipelines:list"[^>]*>[\s\S]*?pipelines\.map\(\(p\) => \([\s\S]*?<\/GuideAnchor>/, 'web list anchor covers the actual selectable pipeline rows');
assert.match(web, /<GuideAnchor id="workflow-pipelines:configuration"[^>]*>[\s\S]*?setActiveSection\(s\)[\s\S]*?renderSection\(\)[\s\S]*?<\/GuideAnchor>/, 'web configuration anchor covers section selection and configuration content');
assert.match(web, /\{canEdit && \([\s\S]*?setIsCreateModalOpen/, 'existing edit-capability conditionals remain around pipeline creation');
assert.match(web, /\{showPipelineList && \([\s\S]*?<GuideAnchor id="workflow-pipelines:list"/, 'responsive list visibility still gates the actual list anchor');
assert.match(web, /\{showContentPanel && \([\s\S]*?selectedPipeline && \([\s\S]*?<GuideAnchor id="workflow-pipelines:configuration"/, 'responsive configuration and selected-pipeline gates still wrap the configuration anchor');
assert.match(guideRegistry, /id: 'workflow-pipelines',[\s\S]*anchorId: 'workflow-pipelines:list'[\s\S]*anchorId: 'workflow-pipelines:configuration'/, 'the registry points the guide at both workflow anchors');

console.log('pipelinesContextualGuide.check: ok');
