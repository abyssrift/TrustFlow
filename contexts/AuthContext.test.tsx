import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Platform: { OS: 'web' },
}));

const state = {
  profile: { id: 'user-1', company_id: null as string | null, is_owner: false },
  permissions: [] as { key: string }[],
  roles: [] as { id: string }[],
};

const supabase = {
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@/lib/supabase', () => ({
  supabase,
  setAuthErrorCallback: vi.fn(),
}));

const { AuthProvider, useAuth } = await import('./AuthContext');

describe('AuthProvider company refresh', () => {
  beforeEach(() => {
    state.profile = { id: 'user-1', company_id: null, is_owner: false };
    state.permissions = [];
    state.roles = [];

    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'owner@example.test' } } },
      error: null,
    });
    supabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
    supabase.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.profile, error: null }),
        }),
      }),
    }));
    supabase.rpc.mockImplementation(async (name: string) => {
      if (name === 'get_my_permissions') return { data: state.permissions, error: null };
      if (name === 'get_my_roles') return { data: state.roles, error: null };
      return { data: null, error: null };
    });
  });

  it('refreshes permissions and roles after the profile joins a company', async () => {
    let context: ReturnType<typeof useAuth> | null = null;
    function Probe() {
      context = useAuth();
      return null;
    }

    await act(async () => {
      TestRenderer.create(
        <AuthProvider>
          <Probe />
        </AuthProvider>,
      );
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    state.profile = { id: 'user-1', company_id: 'company-1', is_owner: true };
    state.permissions = [{ key: 'role.manage' }, { key: 'task.create' }];
    state.roles = [{ id: 'owner-role' }];

    await act(async () => {
      await context!.refreshProfile();
    });

    expect(context!.profile?.company_id).toBe('company-1');
    expect(context!.profile?.is_owner).toBe(true);
    expect(context!.permissions).toEqual(['role.manage', 'task.create']);
    expect(context!.roleIds).toEqual(['owner-role']);
  });
});
