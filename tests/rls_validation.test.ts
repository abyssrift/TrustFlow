import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ── Local-only connection (refuses to run against production) ──────
// Well-known Supabase local dev values from `supabase start`.
const SUPABASE_URL = process.env.LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = process.env.LOCAL_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// Generate a service-role JWT signed with the local Gotrue secret.  The old
// hardcoded demo JWT no longer works with Supabase CLI v2.97+ local stacks.
function buildServiceRoleJwt(): string {
  const secret = process.env.LOCAL_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
  const b64url = (v: string) => Buffer.from(v).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: 'http://127.0.0.1:54321/auth/v1',
    sub: '00000000-0000-0000-0000-000000000000',
    aud: 'authenticated',
    role: 'service_role',
    exp: Math.floor(Date.now() / 1000) + 36000,
    iat: Math.floor(Date.now() / 1000),
  }));
  const sig = crypto.createHmac('sha256', secret).update(header + '.' + payload).digest('base64url');
  return header + '.' + payload + '.' + sig;
}
const SUPABASE_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_KEY || buildServiceRoleJwt();

// Guard: never run this file against a real Supabase project.
if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
  throw new Error(`Refusing to run RLS tests against a non-local Supabase URL: ${SUPABASE_URL}`);
}

const createTestClient = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const createAdminClient = () => createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

describe('Task RLS Enforcement', () => {
  let admin: SupabaseClient;

  // Two companies, each with four user types
  const companies: Record<string, {
    founder: SupabaseClient;
    admin: SupabaseClient;
    assigned: SupabaseClient;
    plain: SupabaseClient;
  }> = {};

  const userIds: Record<string, string> = {};
  const pipelineIds: Record<string, { normal: string; assignedOnly: string }> = {};
  const taskIds: Record<string, string> = {};
  const createdAuthIds: string[] = [];

  const suffix = Date.now().toString(36);
  const password = 'Password123!';

  async function createCompanyUser(
    adminClient: SupabaseClient,
    co: string,
    role: string,
    companyId: string,
    permissions?: string[],
  ): Promise<SupabaseClient> {
    const email = `rls-${co}-${role}-${suffix}@local.test`;
    const { data: uAuth, error: uErr } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (uErr) throw new Error(`Create ${co}/${role} failed: ${uErr.message}`);
    createdAuthIds.push(uAuth!.user!.id);

    await adminClient.from('users').insert({
      id: uAuth!.user!.id, email, company_id: companyId, full_name: `${co} ${role}`,
      is_active: true,
    }).select().single();
    userIds[`${co}_${role}`] = uAuth!.user!.id;

    if (permissions && permissions.length > 0) {
      const { data: roleData, error: roleErr } = await adminClient.from('roles').insert({
        name: `rls-test-${role}-${suffix}`, description: 'RLS test role', is_system: false,
      }).select('id').single();
      if (roleErr) throw new Error(`Create role failed: ${roleErr.message}`);
      const { error: urErr } = await adminClient.from('user_roles').insert({
        user_id: uAuth!.user!.id, role_id: roleData!.id, company_id: companyId,
      });
      if (urErr) throw new Error(`Create user_roles failed: ${urErr.message}`);
      for (const permKey of permissions) {
        const { data: perm, error: permErr } = await adminClient.from('permissions').upsert({
          key: permKey, label: permKey, is_system: true,
        }, { onConflict: 'key' }).select('id').single();
        if (permErr) throw new Error(`Upsert perm ${permKey} failed: ${permErr.message}`);
        const { error: rpErr } = await adminClient.from('role_permissions').upsert({
          role_id: roleData!.id, permission_id: perm!.id,
        }).select().single();
        if (rpErr) throw new Error(`Upsert role_permissions failed: ${rpErr.message}`);
      }
    }

    const client = createTestClient();
    const { error: sErr } = await client.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(`Sign in ${co}/${role} failed: ${sErr.message}`);
    return client;
  }

  beforeAll(async () => {
    admin = createAdminClient();

    for (const co of ['A', 'B'] as const) {
      const prefix = `rls-${co.toLowerCase()}-${suffix}`;
      const founderEmail = `${prefix}-founder@local.test`;

      // Create founder via admin API (bypass signup — no auto-insert trigger exists)
      const { data: fAuth, error: fErr } = await admin.auth.admin.createUser({
        email: founderEmail, password, email_confirm: true,
      });
      if (fErr) throw new Error(`Company ${co} founder create: ${fErr.message}`);
      createdAuthIds.push(fAuth!.user!.id);

      // Insert user row and create company manually
      await admin.from('users').insert({
        id: fAuth!.user!.id, email: founderEmail, full_name: `${co} Founder`,
        is_active: true, is_owner: true,
      }).select().single();

      const { data: newCo } = await admin.from('companies').insert({
        name: `${co} Company`,
        slug: `${co.toLowerCase()}-${suffix}`,
      }).select('id').single();
      const companyId = newCo!.id;

      await admin.from('users').update({ company_id: companyId }).eq('id', fAuth!.user!.id);

      // Sign in as founder
      const founderClient = createTestClient();
      const { error: sErr } = await founderClient.auth.signInWithPassword({
        email: founderEmail, password,
      });
      if (sErr) throw new Error(`Sign in ${co}/founder failed: ${sErr.message}`);
      userIds[`${co}_founder`] = fAuth!.user!.id;
      companies[co] = { founder: founderClient } as any;

      // Normal pipeline
      const { data: pNorm, error: pnErr } = await founderClient.rpc('rpc_create_pipeline', {
        p_name: `${co} Normal`,
        p_description: 'normal',
        p_stages: [
          { name: 'Open', color: '#6b7280', position: 1, is_initial: true, is_terminal: false, requires_submission: false },
          { name: 'Done', color: '#10b981', position: 2, is_initial: false, is_terminal: true, terminal_type: 'success', requires_submission: false },
        ],
        p_transitions: [{ from_position: 1, to_position: 2, label: 'Complete' }],
      });
      if (pnErr) throw new Error(`Pipeline normal create failed: ${pnErr.message}`);

      // Assigned-only pipeline
      const { data: pAssigned, error: paErr } = await founderClient.rpc('rpc_create_pipeline', {
        p_name: `${co} AssignedOnly`,
        p_description: 'assigned_only',
        p_stages: [
          { name: 'Open', color: '#6b7280', position: 1, is_initial: true, is_terminal: false, requires_submission: false },
          { name: 'Done', color: '#10b981', position: 2, is_initial: false, is_terminal: true, terminal_type: 'success', requires_submission: false },
        ],
        p_transitions: [{ from_position: 1, to_position: 2, label: 'Complete' }],
      });
      if (paErr) throw new Error(`Pipeline assignedOnly create failed: ${paErr.message}`);

      if (pAssigned) {
        await founderClient.from('pipelines').update({ task_visibility_mode: 'assigned_only' }).eq('id', pAssigned);
      }

      pipelineIds[co] = { normal: pNorm!, assignedOnly: pAssigned! };

      // Create users
      companies[co].admin = await createCompanyUser(admin, co, 'admin', companyId, ['task.view_all']);
      companies[co].assigned = await createCompanyUser(admin, co, 'assigned', companyId);
      companies[co].plain = await createCompanyUser(admin, co, 'plain', companyId);

      // Tasks
      async function createTask(title: string, pipelineId: string) {
        const { data: tId, error: tErr } = await founderClient.rpc('rpc_create_task', {
          p_title: title, p_description: '', p_pipeline_id: pipelineId,
        });
        if (tErr) throw new Error(`Create task "${title}" failed: ${tErr.message}`);
        return tId;
      }

      taskIds[`${co}_normal`] = await createTask(`${co} Task Normal`, pNorm!);

      const tAssigned = await createTask(`${co} Task Assigned`, pAssigned!);
      taskIds[`${co}_assigned`] = tAssigned;
      if (tAssigned) {
        const { error: aaErr } = await founderClient.rpc('rpc_assign_task', {
          p_task_id: tAssigned, p_target_user_id: userIds[`${co}_assigned`],
        });
        if (aaErr) throw new Error(`Assign task failed: ${aaErr.message}`);
      }

      const tUnassigned = await createTask(`${co} Task Unassigned`, pAssigned!);
      taskIds[`${co}_unassigned`] = tUnassigned;

      const tManaged = await createTask(`${co} Task Managed`, pAssigned!);
      taskIds[`${co}_managed`] = tManaged;
      if (tManaged) {
        await admin.from('tasks').update({ manager_id: userIds[`${co}_assigned`] }).eq('id', tManaged);
      }
    }
  }, 120000);

  afterAll(async () => {
    // Clean up: delete all auth users created during the test.
    // We iterate in reverse so child entities are removed first.
    for (const uid of createdAuthIds.reverse()) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  }, 15000);

  // ═══════════════════════════════════════════════════════════════
  // Cross-company isolation
  // ═══════════════════════════════════════════════════════════════

  it('must not leak tasks across companies (plain user)', async () => {
    const { data: tasks, error: err } = await companies.A.plain
      .from('tasks').select('title');
    expect(err).toBeNull();
    const titles = (tasks || []).map((t: any) => t.title);
    expect(titles).toContain('A Task Normal');
    expect(titles).not.toContain('B Task Normal');
  });

  it('must not leak tasks across companies (admin user)', async () => {
    const { data: tasks } = await companies.A.admin
      .from('tasks').select('title');
    const titles = (tasks || []).map((t: any) => t.title);
    expect(titles).toContain('A Task Normal');
    expect(titles).toContain('A Task Assigned');
    expect(titles).toContain('A Task Unassigned');
    expect(titles).toContain('A Task Managed');
    expect(titles).not.toContain('B Task Normal');
  });

  it('must not leak pipelines across companies', async () => {
    const { data: pipes } = await companies.A.plain
      .from('pipelines').select('name');
    const names = (pipes || []).map((p: any) => p.name);
    expect(names).toContain('A Normal');
    expect(names).not.toContain('B Normal');
  });

  it('must not leak pipeline_stages across companies', async () => {
    const { data: stages } = await companies.A.plain
      .from('pipeline_stages').select('pipeline_id');
    const pipeIds = [...new Set((stages || []).map((s: any) => s.pipeline_id))];
    expect(pipeIds).toContain(pipelineIds.A.normal);
    expect(pipeIds).not.toContain(pipelineIds.B.normal);
  });

  it('must not leak task_assignments across companies', async () => {
    const { data: assigns } = await companies.A.plain
      .from('task_assignments').select('task_id');
    const tIds = (assigns || []).map((a: any) => a.task_id);
    expect(tIds).not.toContain(taskIds.B_assigned);
  });

  // ═══════════════════════════════════════════════════════════════
  // assigned_only visibility
  // ═══════════════════════════════════════════════════════════════

  it('plain user must not see unassigned tasks in assigned_only pipeline', async () => {
    const { data: tasks } = await companies.A.plain.from('tasks').select('title');
    const titles = (tasks || []).map((t: any) => t.title);
    expect(titles).toContain('A Task Normal');
    expect(titles).not.toContain('A Task Unassigned');
  });

  it('assigned user must see own tasks in assigned_only pipeline', async () => {
    const { data: tasks } = await companies.A.assigned.from('tasks').select('title');
    const titles = (tasks || []).map((t: any) => t.title);
    expect(titles).toContain('A Task Assigned');
    expect(titles).toContain('A Task Managed'); // manager_id matches
    expect(titles).not.toContain('A Task Unassigned');
  });

  it('admin user must see all tasks regardless of assigned_only', async () => {
    const { data: tasks } = await companies.A.admin.from('tasks').select('title');
    const titles = (tasks || []).map((t: any) => t.title);
    expect(titles).toContain('A Task Normal');
    expect(titles).toContain('A Task Assigned');
    expect(titles).toContain('A Task Unassigned');
    expect(titles).toContain('A Task Managed');
  });

  // ═══════════════════════════════════════════════════════════════
  // Direct query bypass (smart search vulnerability)
  // ═══════════════════════════════════════════════════════════════

  it('plain user must get zero rows querying another company\'s tasks directly', async () => {
    const otherTaskIds = Object.entries(taskIds)
      .filter(([k]) => k.startsWith('B_'))
      .map(([, v]) => v)
      .filter(Boolean);
    if (otherTaskIds.length === 0) return; // skip if no IDs to query

    const { data: tasks } = await companies.A.plain
      .from('tasks').select('id').in('id', otherTaskIds);
    expect(tasks).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════
  // task_mention_acks
  // ═══════════════════════════════════════════════════════════════

  it('user must see own mention acks', async () => {
    const myId = userIds.A_assigned;
    await admin.from('task_mention_acks').insert({
      task_id: taskIds.A_assigned, user_id: myId,
    });
    const { data: acks } = await companies.A.assigned
      .from('task_mention_acks').select('task_id, user_id').eq('task_id', taskIds.A_assigned);
    expect(acks).toBeDefined();
    expect(acks!.length).toBeGreaterThanOrEqual(1);
  });

  it('must not leak mention acks from other companies', async () => {
    // Insert a mention ack for a Company B task first
    await admin.from('task_mention_acks').insert({
      task_id: taskIds.B_assigned, user_id: userIds.B_assigned,
    });
    const { data: acks } = await companies.A.plain
      .from('task_mention_acks').select('task_id');
    const taskIdSet = new Set((acks || []).map((a: any) => a.task_id));
    for (const key of Object.keys(taskIds)) {
      if (key.startsWith('B_')) {
        expect(taskIdSet.has(taskIds[key])).toBe(false);
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // task_comments
  // ═══════════════════════════════════════════════════════════════

  it('must not leak task_comments across companies', async () => {
    await admin.from('task_comments').insert({
      task_id: taskIds.B_normal, author_id: userIds.B_founder, content: 'B-only comment',
    });
    const { data: comments } = await companies.A.plain
      .from('task_comments').select('id, task_id').eq('task_id', taskIds.B_normal);
    expect(comments).toEqual([]);
  });

  it('plain user must not see comments on unassigned task in assigned_only pipeline', async () => {
    await admin.from('task_comments').insert({
      task_id: taskIds.A_unassigned, author_id: userIds.A_founder, content: 'restricted comment',
    });
    const { data: comments } = await companies.A.plain
      .from('task_comments').select('id').eq('task_id', taskIds.A_unassigned);
    expect(comments).toEqual([]);
  });

  it('assigned user must see comments on their own assigned task', async () => {
    await admin.from('task_comments').insert({
      task_id: taskIds.A_assigned, author_id: userIds.A_founder, content: 'visible comment',
    });
    const { data: comments } = await companies.A.assigned
      .from('task_comments').select('id').eq('task_id', taskIds.A_assigned);
    expect(comments!.length).toBeGreaterThanOrEqual(1);
  });
});
