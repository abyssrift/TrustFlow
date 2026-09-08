import assert from 'node:assert/strict';
import { dedupeTaskFilePaste, taskFilePasteIdentity } from './taskFilePaste';

const file = (name: string, size: number, type = 'text/plain', path = '') => ({ name, size, type, webkitRelativePath: path }) as File;
const existing = [file('report.txt', 10)];
const result = dedupeTaskFilePaste([file('report.txt', 10), file('new.txt', 12), file('new.txt', 12)], existing);
assert.strictEqual(result.accepted.length, 1);
assert.strictEqual(result.skipped, 2);
assert.notStrictEqual(taskFilePasteIdentity(file('folder/report.txt', 10, 'text/plain', 'a/report.txt')), taskFilePasteIdentity(file('folder/report.txt', 10, 'text/plain', 'b/report.txt')));
assert.strictEqual(taskFilePasteIdentity(file('report.txt', 10)), taskFilePasteIdentity(file('report.txt', 10)));
assert.strictEqual(taskFilePasteIdentity(file('unknown.bin', 4, '')), taskFilePasteIdentity(file('unknown.bin', 4, 'application/octet-stream')));
console.log('taskFilePaste dedupe check: ok');
