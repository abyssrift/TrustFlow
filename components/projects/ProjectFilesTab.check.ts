import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'components/projects/ProjectFilesTab.tsx'), 'utf8');
const route = readFileSync(join(process.cwd(), 'app/projects/[id].tsx'), 'utf8');

assert.match(source, /useModalDispatch/);
assert.match(source, /summon\('upload',\s*\{\s*destination:/s);
assert.match(source, /kind: 'project'/);
assert.match(source, /ExplorerCollection/);
assert.doesNotMatch(source, /expo-document-picker/);
assert.doesNotMatch(source, /startUpload|waitForUpload|projectUploadTarget/);
assert.match(source, /resolveProjectFileHubDeepLink/);
assert.match(route, /tab\?: string/);
assert.match(route, /folder\?: string/);
assert.match(route, /file\?: string/);
assert.match(route, /tabParam.*folderParam.*fileParam/s);
assert.match(route, /<ProjectFilesTab[^>]*folderParam=/s);
assert.match(route, /folderParam.*fileParam/s);
assert.doesNotMatch(source, /<MultiViewList/);

console.log('ProjectFilesTab: source checks passed');
