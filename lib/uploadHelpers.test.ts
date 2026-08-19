import { afterEach, describe, expect, it, vi } from 'vitest';

// uploadHelpers.ts imports these for the native reconnect path (waitForReconnect),
// which this file doesn't exercise -- stub just enough that the module loads
// under vitest's plain Node environment (no RN/Flow transform configured).
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('@react-native-community/netinfo', () => ({ default: { fetch: vi.fn(), addEventListener: vi.fn() } }));

const { formatEta, formatFileSize, isNetworkError, StorageUploadError } = await import('./uploadHelpers');

afterEach(() => vi.unstubAllGlobals());

describe('isNetworkError', () => {
  it('is true for a status-0 StorageUploadError (XHR onerror / simulated drop)', () => {
    expect(isNetworkError(new StorageUploadError('Network error during upload', 0))).toBe(true);
  });

  it('is false for a real HTTP error response, even with a similar message', () => {
    expect(isNetworkError(new StorageUploadError('Upload failed (413)', 413))).toBe(false);
  });

  it('is false for a non-upload error', () => {
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });

  it('is true when the browser reports itself offline, regardless of error type', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isNetworkError(new Error('anything'))).toBe(true);
  });

  it('is false when online and the error is not network-shaped', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isNetworkError(new Error('validation failed'))).toBe(false);
  });
});

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
    [1024 * 1024 * 1024, '1.0 GB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('formatEta', () => {
  it('is blank for unknown input', () => {
    expect(formatEta(null)).toBe('');
    expect(formatEta(NaN)).toBe('');
    expect(formatEta(-5)).toBe('');
    expect(formatEta(Infinity)).toBe('');
  });

  it('formats sub-minute remaining as seconds', () => {
    expect(formatEta(45)).toBe('~45s');
  });

  it('formats sub-hour remaining as minutes', () => {
    expect(formatEta(125)).toBe('~2m');
  });

  it('formats long remaining as hours', () => {
    expect(formatEta(7200)).toBe('~2.0h');
  });
});
