import assert from 'node:assert';
import { importMarkdownFile, MARKDOWN_MAX_BYTES, MARKDOWN_MAX_CHARS, mergeMarkdownAtSelection } from './markdownFileImport';

const bytes = (s: string) => new TextEncoder().encode(s);
const ok = (r: ReturnType<typeof importMarkdownFile>) => { assert.equal(r.ok, true); return r as Extract<typeof r, { ok: true }>; };
const fail = (r: ReturnType<typeof importMarkdownFile>, code: string) => assert.equal(r.ok ? '' : r.code, code);

assert.equal(ok(importMarkdownFile('readme.MD', bytes('\uFEFFa\r\nb\rc'))).source, 'a\nb\nc');
assert.equal(ok(importMarkdownFile('list.md', bytes('1. first\r\n2. second\r3. third'))).source, '1. first\n2. second\n3. third');
assert.equal(ok(importMarkdownFile('a.markdown', new Uint8Array([0xff, 0xfe, 0x61, 0x00]))).source, 'a');
assert.equal(ok(importMarkdownFile('a.md', new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).source, 'a');
fail(importMarkdownFile('a.txt', bytes('x')), 'unsupported-extension');
fail(importMarkdownFile('a.md', new Uint8Array(MARKDOWN_MAX_BYTES + 1)), 'too-large');
fail(importMarkdownFile('a.md', new Uint8Array([0xc3, 0x28])), 'malformed-utf8');
fail(importMarkdownFile('a.md', new Uint8Array([0x61, 0x00, 0x62])), 'nul-byte');
fail(importMarkdownFile('a.md', bytes('a\u0001b')), 'binary-content');
fail(importMarkdownFile('a.md', bytes('x'.repeat(MARKDOWN_MAX_CHARS + 1))), 'too-many-characters');
const flagged = ok(importMarkdownFile('a.md', bytes('---\ntitle: x\n---\n<img src="x">\n![alt](x)\n<!-- c -->')));
assert.deepEqual(flagged.unsupported, ['frontmatter', 'html-comment', 'raw-html', 'image']);
assert.equal(ok(importMarkdownFile('a.md', bytes('--- not frontmatter ---'))).unsupported.length, 0);
assert.deepEqual(
  mergeMarkdownAtSelection('beforeafter', { start: 6, end: 6 }, '# Imported'),
  { value: 'before\n# Imported\nafter', selection: { start: 18, end: 18 } },
);
assert.deepEqual(
  mergeMarkdownAtSelection('replace this', { start: 0, end: 7 }, 'new'),
  { value: 'new\n this', selection: { start: 4, end: 4 } },
);
assert.deepEqual(mergeMarkdownAtSelection('', { start: 0, end: 0 }, 'one\ntwo'), {
  value: 'one\ntwo', selection: { start: 7, end: 7 },
});
console.log('markdownFileImport: all assertions passed');
