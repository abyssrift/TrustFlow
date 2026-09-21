import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  NativeModules: {},
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {},
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('@/hooks/useStagedFileLifecycle', () => ({
  useStagedFileLifecycle: vi.fn(),
}));

vi.mock('@/lib/pasteImage', () => ({
  revokeStagedFiles: vi.fn(),
}));

vi.mock('@/contexts/UploadManagerContext', () => ({
  useUploadManager: () => ({ startUpload: vi.fn(), waitForUpload: vi.fn() }),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ successToast: vi.fn(), errorToast: vi.fn(), infoToast: vi.fn() }),
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

import { taskDraftStorageKey } from './TaskCreationContext';

describe('taskDraftStorageKey', () => {
  it('isolates drafts by authenticated user and company', () => {
    expect(taskDraftStorageKey('user-1', 'company-1')).not.toBe(
      taskDraftStorageKey('user-1', 'company-2'),
    );
    expect(taskDraftStorageKey('user-1', 'company-1')).not.toBe(
      taskDraftStorageKey('user-2', 'company-1'),
    );
  });

  it('does not hydrate a draft without both identity boundaries', () => {
    expect(taskDraftStorageKey(null, 'company-1')).toBeNull();
    expect(taskDraftStorageKey('user-1', null)).toBeNull();
  });
});
