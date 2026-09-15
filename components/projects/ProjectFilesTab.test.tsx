import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'components/projects/ProjectFilesTab.tsx'), 'utf8');

describe('ProjectFilesTab', () => {
  it('composes the portable shell while retaining domain-owned project authorities', () => {
    assert.match(source, /ExplorerInspectorShell/);
    assert.match(source, /ExplorerCollection/);
    assert.match(source, /ProjectFileInspector/);
    assert.match(source, /selectedFile \? <ProjectFileInspector/);
    assert.match(source, /mobilePane=\{selectedFile \? 'inspector' : 'collection'\}/);
    assert.match(source, /onRequestCollection=\{\(\) => \{/);
    assert.match(source, /setSelectedFile\(null\)/);
    assert.match(source, /resolveProjectFileHubDeepLink/);
    assert.match(source, /capabilities\?\.create/);
    assert.match(source, /projectCapabilities\.restore === true/);
    assert.match(source, /summon\('upload'/);
    assert.match(source, /showConfirm/);
    assert.match(source, /standing_files/);
    assert.match(source, /deliverable_files/);
    assert.doesNotMatch(source, /LegacyProjectFileDetail|ProjectFileDetail/);
    assert.doesNotMatch(source, /canView:\s*true|canVersion:\s*true/);
  });
});
