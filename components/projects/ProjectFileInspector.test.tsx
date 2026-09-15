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
    assert.match(source, /capabilities\.restore/);
    assert.doesNotMatch(source, /FileHubContext/);
    assert.match(source, /capabilities\.restore && !version\.is_current/);
    assert.match(source, /capabilities=\{\{ canView: capabilities\.view/);
    assert.match(source, /canVersion: capabilities\.version/);
    assert.doesNotMatch(source, /canView:\s*true|canVersion:\s*true/);
  });

  it('resets selected-file state when the inspector identity changes', () => {
    assert.match(source, /useEffect\(\(\) => \{[\s\S]*setTab\('details'\)[\s\S]*setVersions\(null\)[\s\S]*setActivity\(null\)[\s\S]*\}, \[file\.id\]\)/);
  });

  it('uses the viewer preview URL and exposes gated per-version downloads', () => {
    assert.match(source, /previewUrls\[file\.id\]/);
    assert.match(source, /FilePreviewTeaser[\s\S]*uri=\{previewUrl/);
    assert.match(source, /version\.bucket[\s\S]*version\.storage_path[\s\S]*version\.original_name[\s\S]*version\.mime_type/);
    assert.match(source, /Download/);
    assert.match(source, /capabilities\.restore && !version\.is_current/);
    assert.match(source, /capabilities\.view && version\.bucket/);
    assert.match(source, /requestId === requestIdRef\.current && fileId === file\.id/);
    assert.match(source, /signedUrls\[file\.id\]/);
  });
});
