import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'components/projects/ProjectFileInspector.tsx'), 'utf8');

describe('ProjectFileInspector', () => {
  it('keeps project preview, metadata, history, and capability boundaries in the inspector', () => {
    assert.match(source, /ExplorerDetailPane/);
    assert.match(source, /useFileViewer/);
    assert.match(source, /FilePreview/);
    assert.match(source, /details.*versions.*activity/s);
    assert.match(source, /projectFileVersions/);
    assert.match(source, /fileActivity/);
    assert.match(source, /showConfirm/);
    assert.match(source, /canRestore/);
    assert.doesNotMatch(source, /FileHubContext/);
    assert.match(source, /canRestore && !version\.is_current/);
  });
});
