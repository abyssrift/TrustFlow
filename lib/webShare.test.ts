import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEB_SHARE_MAX_BYTES, canCopyImage, shareFileViaWeb } from './webShare';

const FILE = { name: 'report.pdf', mimeType: 'application/pdf' };

function stubNavigator(over: { share?: any; canShare?: any } | null) {
  vi.stubGlobal('navigator', over === null ? undefined : { share: vi.fn(), canShare: () => true, ...over });
}

function stubFetch(ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, blob: async () => new Blob(['x'], { type: 'application/pdf' }) })));
}

afterEach(() => vi.unstubAllGlobals());

describe('shareFileViaWeb', () => {
  it('is unsupported where the browser has no share API (Firefox)', async () => {
    stubNavigator({ share: undefined, canShare: undefined });
    stubFetch();
    expect(await shareFileViaWeb('https://x/f', FILE)).toBe('unsupported');
  });

  it('is unsupported above the in-memory size cap, without fetching', async () => {
    const fetchSpy = vi.fn();
    stubNavigator({});
    vi.stubGlobal('fetch', fetchSpy);
    const big = { ...FILE, sizeBytes: WEB_SHARE_MAX_BYTES + 1 };
    expect(await shareFileViaWeb('https://x/f', big)).toBe('unsupported');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shares the file when the browser accepts it', async () => {
    const share = vi.fn(async (_data: any) => {});
    stubNavigator({ share });
    stubFetch();
    expect(await shareFileViaWeb('https://x/f', FILE)).toBe('shared');
    expect(share.mock.calls[0][0].files[0].name).toBe('report.pdf');
  });

  it('is unsupported when canShare rejects the file type', async () => {
    stubNavigator({ canShare: () => false });
    stubFetch();
    expect(await shareFileViaWeb('https://x/f', FILE)).toBe('unsupported');
  });

  it('is unsupported when the signed URL fetch fails', async () => {
    stubNavigator({});
    stubFetch(false);
    expect(await shareFileViaWeb('https://x/f', FILE)).toBe('unsupported');
  });

  // The two failure modes that must NOT be conflated: a dismissed sheet is the
  // user's decision (stop), a dropped gesture is Safari's (fall back to a link).
  it('reports a dismissed share sheet as cancelled, not unsupported', async () => {
    stubNavigator({ share: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }) });
    stubFetch();
    expect(await shareFileViaWeb('https://x/f', FILE)).toBe('cancelled');
  });

  it('falls back when Safari drops the transient activation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubNavigator({ share: vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); }) });
    stubFetch();
    expect(await shareFileViaWeb('https://x/f', FILE)).toBe('unsupported');
  });
});

describe('canCopyImage', () => {
  const withClipboard = () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
    vi.stubGlobal('ClipboardItem', class {});
  };

  it('accepts images when the clipboard can take them', () => {
    withClipboard();
    expect(canCopyImage('image/jpeg')).toBe(true);
  });

  it('rejects non-images — the web cannot put arbitrary files on the clipboard', () => {
    withClipboard();
    expect(canCopyImage('application/pdf')).toBe(false);
    expect(canCopyImage(null)).toBe(false);
  });

  it('rejects when the browser has no ClipboardItem', () => {
    vi.stubGlobal('navigator', { clipboard: { write: vi.fn() } });
    vi.stubGlobal('ClipboardItem', undefined);
    expect(canCopyImage('image/png')).toBe(false);
  });
});
