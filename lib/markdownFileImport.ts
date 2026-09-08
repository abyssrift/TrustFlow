/** Pure, local markdown-file intake. No filesystem, network, or UI imports. */

export const MARKDOWN_MAX_BYTES = 1 * 1024 * 1024;
export const MARKDOWN_MAX_CHARS = 100_000;

export type MarkdownImportSelection = { start: number; end: number };

/** Insert a complete Markdown document without joining its edge lines to prose. */
export function mergeMarkdownAtSelection(
  value: string,
  selection: MarkdownImportSelection,
  source: string,
): { value: string; selection: MarkdownImportSelection } {
  const start = Math.max(0, Math.min(selection.start, selection.end, value.length));
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), value.length));
  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix = before && !before.endsWith('\n') ? '\n' : '';
  const suffix = after && !after.startsWith('\n') ? '\n' : '';
  const inserted = `${prefix}${source}${suffix}`;
  const caret = before.length + inserted.length;
  return { value: `${before}${inserted}${after}`, selection: { start: caret, end: caret } };
}

export type MarkdownUnsupportedConstruct =
  | 'frontmatter'
  | 'raw-html'
  | 'image'
  | 'html-comment';

export type MarkdownImportErrorCode =
  | 'unsupported-extension'
  | 'too-large'
  | 'too-many-characters'
  | 'malformed-utf8'
  | 'unsupported-encoding'
  | 'binary-content'
  | 'nul-byte';

export type MarkdownImportFailure = {
  ok: false;
  code: MarkdownImportErrorCode;
  message: string;
};

export type MarkdownImportSuccess = {
  ok: true;
  name: string;
  source: string;
  /** Constructs that may need review by a richer markdown renderer. */
  unsupported: MarkdownUnsupportedConstruct[];
};

export type MarkdownImportResult = MarkdownImportSuccess | MarkdownImportFailure;

const decoder = (encoding: 'utf-8' | 'utf-16le' | 'utf-16be'): TextDecoder =>
  new TextDecoder(encoding, { fatal: true });

function extensionIsMarkdown(name: string): boolean {
  return /\.(?:md|markdown)$/i.test(name.trim());
}

function decode(bytes: Uint8Array): { source: string } | MarkdownImportFailure {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    try { return { source: decoder('utf-16le').decode(bytes.subarray(2)) }; }
    catch { return { ok: false, code: 'malformed-utf8', message: 'The UTF-16LE markdown file is malformed.' }; }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try { return { source: decoder('utf-16be').decode(bytes.subarray(2)) }; }
    catch { return { ok: false, code: 'malformed-utf8', message: 'The UTF-16BE markdown file is malformed.' }; }
  }
  // A UTF-16 stream without its BOM is intentionally not guessed: guessing
  // makes binary files look like text and can silently corrupt content.
  if (bytes.length >= 2 && ((bytes[0] === 0x00 && bytes[1] !== 0x00) || (bytes[1] === 0x00 && bytes[0] !== 0x00))) {
    return { ok: false, code: 'unsupported-encoding', message: 'Markdown must be UTF-8, or UTF-16 with a BOM.' };
  }
  try {
    const value = decoder('utf-8').decode(bytes);
    return { source: value.charCodeAt(0) === 0xfeff ? value.slice(1) : value };
  } catch {
    return { ok: false, code: 'malformed-utf8', message: 'The markdown file is not valid UTF-8.' };
  }
}

function unsupported(source: string): MarkdownUnsupportedConstruct[] {
  const found: MarkdownUnsupportedConstruct[] = [];
  if (/^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.test(source)) found.push('frontmatter');
  if (/<!--[\s\S]*?-->/m.test(source)) found.push('html-comment');
  if (/<\/?[A-Za-z][^>]*>/m.test(source)) found.push('raw-html');
  if (/!\[[^\]]*\]\([^\n)]*\)/.test(source) || /!\[[^\]]*\]\[[^\]]*\]/.test(source)) found.push('image');
  return found;
}

/** Validate and normalize one locally-picked markdown file. */
export function importMarkdownFile(name: string, bytes: Uint8Array): MarkdownImportResult {
  if (!extensionIsMarkdown(name)) return { ok: false, code: 'unsupported-extension', message: 'Choose a .md or .markdown file.' };
  if (bytes.byteLength > MARKDOWN_MAX_BYTES) return { ok: false, code: 'too-large', message: 'Markdown files must be 1 MiB or smaller.' };
  // A zero byte in an unmarked stream is never valid UTF-8 markdown. Check it
  // before the no-BOM UTF-16 heuristic so the rejection remains explicit.
  const hasUtf16Bom = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff);
  if (!hasUtf16Bom && bytes.includes(0)) return { ok: false, code: 'nul-byte', message: 'The markdown file contains a NUL byte.' };
  const decoded = decode(bytes);
  if ('ok' in decoded && !decoded.ok) return decoded;
  let source = (decoded as { source: string }).source;
  if (source.includes('\u0000')) return { ok: false, code: 'nul-byte', message: 'The markdown file contains a NUL byte.' };
  // Reject control characters that are characteristic of binary content while
  // retaining the text controls markdown legitimately uses (tab/newline/CR).
  if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source)) {
    return { ok: false, code: 'binary-content', message: 'The selected file appears to be binary.' };
  }
  if (source.length > MARKDOWN_MAX_CHARS) return { ok: false, code: 'too-many-characters', message: 'Markdown files must contain 100,000 characters or fewer.' };
  source = source.replace(/\r\n?/g, '\n');
  return { ok: true, name, source, unsupported: unsupported(source) };
}

export const intakeMarkdownFile = importMarkdownFile;
