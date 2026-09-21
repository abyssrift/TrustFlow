import { describe, expect, it, vi } from 'vitest';
vi.mock('@react-native-community/netinfo', () => ({ default: {} }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
import { computeSHA256 } from './uploadHelpers';

describe('computeSHA256', () => {
  it('hashes native byte sources when WebCrypto subtle is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    const bytes = new TextEncoder().encode('abc');
    await expect(computeSHA256({
      name: 'native.bin',
      type: 'application/octet-stream',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes.buffer,
    } as File)).resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    vi.unstubAllGlobals();
  });
});
