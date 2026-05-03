import { supabase } from '@/lib/supabase';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

// ── Types ──────────────────────────────────────────────────

export type User = {
  id: string;
  email: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  department: string | null;
};

export type Team = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_system: boolean;
  is_default: boolean;
  permissionIds?: string[]; // Hydrated in refreshData
};

export type Permission = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  category: string;
};

export type UserRole = {
  user_id: string;
  role_id: string;
  revoked_at: string | null;
};

export type TeamRole = {
  team_id: string;
  role_id: string;
};

export type TeamMember = {
  team_id: string;
  user_id: string;
  removed_at: string | null;
};

type RoleManagerState = {
  users: User[];
  teams: Team[];
  roles: Role[];
  permissions: Permission[];
  userRoles: UserRole[];
  teamRoles: TeamRole[];
  teamMembers: TeamMember[];
  loading: boolean;
  error: string | null;
  refreshAll: () => Promise<void>;
  createRole: (name: string, description: string, color: string, permissions: string[]) => Promise<string | null>;
  updateRole: (id: string, name: string, description: string, color: string, permissions: string[]) => Promise<boolean>;
  deleteRole: (id: string) => Promise<boolean>;
  updateUserAssignments: (userId: string, roleIds: string[], teamIds: string[]) => Promise<boolean>;
  updateTeamAssignments: (teamId: string, roleIds: string[]) => Promise<boolean>;
  createTeam: (name: string, description: string, color: string) => Promise<string | null>;
};

const RoleManagerContext = createContext<RoleManagerState | null>(null);

export function useRoleManager() {
  const ctx = useContext(RoleManagerContext);
  if (!ctx) throw new Error('useRoleManager must be used within RoleManagerProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────

export function RoleManagerProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [teamRoles, setTeamRoles] = useState<TeamRole[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        usersResult,
        teamsResult,
        rolesResult,
        permsResult,
        userRolesResult,
        teamRolesResult,
        membersResult,
        rolePermsResult
      ] = await Promise.all([
        supabase.from('users').select('id, email, full_name, display_name, avatar_url, job_title, department').is('deleted_at', null).order('full_name'),
        supabase.from('teams').select('*').is('deleted_at', null).order('name'),
        supabase.from('roles').select('*').is('deleted_at', null).order('name'),
        supabase.from('permissions').select('*').order('category, key'),
        supabase.from('user_roles').select('user_id, role_id, revoked_at').is('revoked_at', null),
        supabase.from('team_roles').select('team_id, role_id'),
        supabase.from('team_members').select('team_id, user_id, removed_at').is('removed_at', null),
        supabase.from('role_permissions').select('role_id, permission_id')
      ]);

      if (usersResult.error) throw usersResult.error;
      if (teamsResult.error) throw teamsResult.error;
      if (rolesResult.error) throw rolesResult.error;
      if (permsResult.error) throw permsResult.error;
      if (userRolesResult.error) throw userRolesResult.error;
      if (teamRolesResult.error) throw teamRolesResult.error;
      if (membersResult.error) throw membersResult.error;
      if (rolePermsResult.error) throw rolePermsResult.error;

      setUsers(usersResult.data || []);
      setTeams(teamsResult.data || []);
      setPermissions(permsResult.data || []);
      setUserRoles(userRolesResult.data || []);
      setTeamRoles(teamRolesResult.data || []);
      setTeamMembers(membersResult.data || []);

      // Hydrate roles with their permission IDs
      const permissionsByRole = (rolePermsResult.data || []).reduce((acc: any, curr) => {
        if (!acc[curr.role_id]) acc[curr.role_id] = [];
        acc[curr.role_id].push(curr.permission_id);
        return acc;
      }, {});

      setRoles((rolesResult.data || []).map(r => ({
        ...r,
        permissionIds: permissionsByRole[r.id] || []
      })));

    } catch (e: any) {
      setError(e.message);
      console.error('RoleManager error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const createRole = useCallback(async (name: string, description: string, color: string, permissions: string[]) => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('rpc_create_role', {
        p_name: name,
        p_description: description,
        p_color: color,
        p_permissions: permissions
      });
      if (e) throw e;
      await refreshAll();
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  const updateRole = useCallback(async (id: string, name: string, description: string, color: string, permissions: string[]) => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_update_role', {
        p_role_id: id,
        p_name: name,
        p_description: description,
        p_color: color,
        p_permissions: permissions
      });
      if (e) throw e;
      await refreshAll();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  const deleteRole = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const { error: e } = await supabase.from('roles').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (e) throw e;
      await refreshAll();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  const updateUserAssignments = useCallback(async (userId: string, roleIds: string[], teamIds: string[]) => {
    setLoading(true);
    try {
      // Run both sync RPCs
      const [roleRes, teamRes] = await Promise.all([
        supabase.rpc('rpc_assign_user_roles', { p_user_id: userId, p_role_ids: roleIds }),
        supabase.rpc('rpc_assign_user_teams', { p_user_id: userId, p_team_ids: teamIds })
      ]);
      
      if (roleRes.error) throw roleRes.error;
      if (teamRes.error) throw teamRes.error;

      await refreshAll();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  const updateTeamAssignments = useCallback(async (teamId: string, roleIds: string[]) => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_assign_team_roles', {
        p_team_id: teamId,
        p_role_ids: roleIds
      });
      if (e) throw e;
      await refreshAll();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  const createTeam = useCallback(async (name: string, description: string, color: string) => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('rpc_create_team', {
        p_name: name,
        p_description: description,
        p_color: color
      });
      if (e) throw e;
      await refreshAll();
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshAll]);

  return (
    <RoleManagerContext.Provider
      value={{
        users, teams, roles, permissions, userRoles, teamRoles, teamMembers,
        loading, error,
        refreshAll,
        createRole, updateRole, deleteRole,
        updateUserAssignments, updateTeamAssignments, createTeam
      }}
    >
      {children}
    </RoleManagerContext.Provider>
  );
}
