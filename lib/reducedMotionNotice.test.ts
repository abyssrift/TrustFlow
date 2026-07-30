import { beforeEach, describe, expect, it, vi } from 'vitest';

// The whole point of this module is that it fires once and then shuts up, so
// that's what's worth testing: the cooldown, and the persisted timestamp
// surviving a reload.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));

const toast = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: (t: unknown) => toast(t) }));

async function freshModule() {
  vi.resetModules();
  return (await import('./reducedMotionNotice')).noticeReducedMotion;
}

// noticeReducedMotion is fire-and-forget; let its async body settle.
const settle = () => new Promise(r => setTimeout(r, 0));

describe('noticeReducedMotion', () => {
  beforeEach(() => {
    store.clear();
    toast.mockClear();
  });

  it('toasts once and swallows the rest of the burst', async () => {
    const notice = await freshModule();
    notice();
    notice();
    notice();
    await settle();
    notice();
    await settle();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('stays quiet after a reload while the cooldown holds', async () => {
    const notice = await freshModule();
    notice();
    await settle();
    expect(toast).toHaveBeenCalledTimes(1);

    const afterReload = await freshModule();
    afterReload();
    await settle();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('speaks up again once the cooldown has expired', async () => {
    store.set('@TrustFlow_reduced_motion_notice_at', String(Date.now() - 25 * 60 * 60 * 1000));
    const notice = await freshModule();
    notice();
    await settle();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
