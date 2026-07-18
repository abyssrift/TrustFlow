-- ╔══════════════════════════════════════════════════════════════════════════════╗
-- ║ LOCAL TESTING / DEVELOPMENT ONLY — NOT FOR PRODUCTION USE                   ║
-- ║                                                                             ║
-- ║ This file is a hand-written reconstruction of the database schema that      ║
-- ║ existed before migration tracking was introduced.  It was inferred from     ║
-- ║ seed files, TypeScript types, application code, and the cumulative effect    ║
-- ║ of the migration files.  It is NOT a verified dump of the real schema and   ║
-- ║ is NOT guaranteed to match what runs in production.                         ║
-- ║                                                                             ║
-- ║ Purpose: makes `supabase db reset` work in local dev so that the new RLS    ║
-- ║ migration (20260721_rls_tasks_core) can be validated end-to-end.            ║
-- ║ Do NOT run this file against any real or shared Supabase project.           ║
-- ╚══════════════════════════════════════════════════════════════════════════════╝

create extension if not exists pg_cron with schema cron;

-- 1. companies
CREATE TABLE IF NOT EXISTS public.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    website TEXT,
    logo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. permissions
CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    description TEXT,
    category TEXT,
    is_system BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. roles
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT false,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. role_permissions (junction)
CREATE TABLE IF NOT EXISTS public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 5. users
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    email TEXT,
    full_name TEXT,
    display_name TEXT,
    avatar_url TEXT,
    job_title TEXT,
    department TEXT,
    is_owner BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    onboarded_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. pipelines
CREATE TABLE IF NOT EXISTS public.pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    visibility_permissions TEXT[],
    task_visibility_mode TEXT,
    require_time_approval BOOLEAN,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. teams (self-referential via parent_team_id)
CREATE TABLE IF NOT EXISTS public.teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    manager_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    parent_team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
    color TEXT,
    icon TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. projects
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    description TEXT,
    status TEXT DEFAULT 'active',
    expiry_date TIMESTAMPTZ,
    pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE SET NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    is_featured BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. pipeline_stages
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    description TEXT,
    position INTEGER NOT NULL,
    is_initial BOOLEAN DEFAULT false,
    is_terminal BOOLEAN DEFAULT false,
    terminal_type TEXT,
    requires_submission BOOLEAN DEFAULT false,
    requires_attachments BOOLEAN DEFAULT false,
    requires_timer BOOLEAN DEFAULT false,
    use_business_hours BOOLEAN DEFAULT false,
    min_timer_seconds INTEGER NOT NULL DEFAULT 300 CHECK (min_timer_seconds >= 0),
    linked_pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE SET NULL,
    child_inherits_submission BOOLEAN NOT NULL DEFAULT false,
    ui_metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. tasks (self-referential via parent_task_id)
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'open',
    category TEXT,
    weight BIGINT DEFAULT 0,
    due_date TIMESTAMPTZ,
    start_date TIMESTAMPTZ,
    estimated_hours NUMERIC(6,2),
    completed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    manager_id UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    pipeline_id UUID REFERENCES public.pipelines(id) ON DELETE SET NULL,
    current_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
    parent_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    is_recurring BOOLEAN,
    visibility_permission TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 11. pipeline_stage_transitions
CREATE TABLE IF NOT EXISTS public.pipeline_stage_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    to_stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    required_permission TEXT,
    transition_type TEXT DEFAULT 'neutral',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 12. pipeline_stage_actions
CREATE TABLE IF NOT EXISTS public.pipeline_stage_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    action_type TEXT NOT NULL,
    label TEXT NOT NULL,
    icon TEXT,
    style TEXT DEFAULT 'primary',
    required_role TEXT DEFAULT 'any',
    precondition TEXT,
    transition_id UUID REFERENCES public.pipeline_stage_transitions(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0,
    requires_timer BOOLEAN DEFAULT false,
    use_business_hours BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 13. task_assignments (XOR constraint: user or team, not both)
CREATE TABLE IF NOT EXISTS public.task_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    assignee_user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    assignee_team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_assignments_member_xor CHECK ((assignee_user_id IS NOT NULL) <> (assignee_team_id IS NOT NULL))
);

-- 14. task_comments (self-referential via parent_id for threaded replies)
CREATE TABLE IF NOT EXISTS public.task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    parent_id UUID REFERENCES public.task_comments(id) ON DELETE CASCADE,
    is_system BOOLEAN DEFAULT false,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 15. task_mention_acks
CREATE TABLE IF NOT EXISTS public.task_mention_acks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    mentioned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 16. task_attachments
CREATE TABLE IF NOT EXISTS public.task_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    category TEXT,
    storage_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 17. task_submissions
CREATE TABLE IF NOT EXISTS public.task_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    submitted_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    assignment_id UUID REFERENCES public.task_assignments(id) ON DELETE SET NULL,
    content TEXT,
    stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    revision_count INTEGER NOT NULL DEFAULT 1,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_notes TEXT
);

-- 18. submission_attachments
CREATE TABLE IF NOT EXISTS public.submission_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES public.task_submissions(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size BIGINT,
    mime_type TEXT,
    category TEXT,
    storage_path TEXT
);

-- 19. pipeline_stage_history
CREATE TABLE IF NOT EXISTS public.pipeline_stage_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    pipeline_id UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
    from_stage_id UUID REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
    to_stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    transitioned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    from_stage_name TEXT,
    to_stage_name TEXT NOT NULL,
    submission_id UUID REFERENCES public.task_submissions(id) ON DELETE SET NULL,
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_reversal BOOLEAN DEFAULT false
);

-- 20. user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 21. team_members
CREATE TABLE IF NOT EXISTS public.team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    role_id UUID REFERENCES public.roles(id) ON DELETE SET NULL,
    removed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 22. task_participants (junction: tracks which users are involved in a task)
CREATE TABLE IF NOT EXISTS public.task_participants (
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, user_id)
);

-- 23. team_roles (junction)
CREATE TABLE IF NOT EXISTS public.team_roles (
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, role_id)
);

-- 24. activity_events (audit trail / activity feed)
CREATE TABLE IF NOT EXISTS public.activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    user_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 25. storage_archive_queue (async archive/purge queue)
CREATE TABLE IF NOT EXISTS public.storage_archive_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    storage_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 26. pipeline_stage_targets (per-stage targets/goals)
CREATE TABLE IF NOT EXISTS public.pipeline_stage_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    stage_id UUID NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_quantity INTEGER NOT NULL,
    target_deadline TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 27. analytics_snapshots (cached analytics data)
CREATE TABLE IF NOT EXISTS public.analytics_snapshots (
    company_id UUID NOT NULL,
    snapshot_type TEXT NOT NULL,
    subject_id UUID NOT NULL,
    period_type TEXT NOT NULL,
    period_start DATE NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT analytics_snapshots_snapshot_type_check CHECK (snapshot_type IN ('user_performance', 'pipeline_performance'))
);

-- Create a pipeline with stages and transitions (pre-migration RPC)
CREATE OR REPLACE FUNCTION public.rpc_create_pipeline(
    p_name text,
    p_description text,
    p_stages jsonb,
    p_transitions jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id uuid;
    v_pipeline_id uuid;
    v_stage_id uuid;
    v_stage record;
    v_transition record;
    v_stage_ids uuid[] := ARRAY[]::uuid[];
    v_idx int := 1;
BEGIN
    SELECT company_id INTO v_company_id FROM public.users WHERE id = auth.uid();
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'No company context'; END IF;

    INSERT INTO public.pipelines (company_id, name, description)
    VALUES (v_company_id, p_name, p_description)
    RETURNING id INTO v_pipeline_id;
    FOR v_stage IN SELECT * FROM jsonb_to_recordset(p_stages) AS x(
        name text, color text, position int, is_initial bool, is_terminal bool,
        terminal_type text, requires_submission bool
    )
    LOOP
        INSERT INTO public.pipeline_stages (
            pipeline_id, name, color, position, is_initial, is_terminal,
            terminal_type, requires_submission
        ) VALUES (
            v_pipeline_id, v_stage.name, v_stage.color, v_stage.position,
            COALESCE(v_stage.is_initial, false), COALESCE(v_stage.is_terminal, false),
            v_stage.terminal_type, COALESCE(v_stage.requires_submission, false)
        ) RETURNING id INTO v_stage_id;
        v_stage_ids := array_append(v_stage_ids, v_stage_id);
        v_idx := v_idx + 1;
    END LOOP;

    FOR v_transition IN SELECT * FROM jsonb_to_recordset(p_transitions) AS x(
        from_position int, to_position int, label text
    )
    LOOP
        INSERT INTO public.pipeline_stage_transitions (
            from_stage_id, to_stage_id, label
        ) VALUES (
            v_stage_ids[v_transition.from_position],
            v_stage_ids[v_transition.to_position],
            v_transition.label
        );
    END LOOP;

    RETURN v_pipeline_id;
END;
$$;

-- Assign a user to a task (pre-migration RPC)
CREATE OR REPLACE FUNCTION public.rpc_assign_task(
    p_task_id uuid,
    p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM public.tasks WHERE id = p_task_id;
    INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
    VALUES (p_task_id, v_company_id, p_target_user_id, auth.uid());
END;
$$;

-- Audit log helper (pre-migration, referenced by rpc_create_task and others)
CREATE OR REPLACE FUNCTION public.log_event(
    p_company_id uuid,
    p_user_id uuid,
    p_entity_type text,
    p_entity_id uuid,
    p_event_type text,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.activity_events (company_id, user_id, entity_type, entity_id, event_type, metadata)
    VALUES (p_company_id, p_user_id, p_entity_type, p_entity_id, p_event_type, p_metadata)
$$;

-- Helper: returns the current user's company_id
create or replace function public.my_company_id()
returns uuid
language sql stable
as $$
  select company_id from public.users where id = auth.uid()
$$;

-- Helper: reusable permission check (used in RLS + RPCs)
create or replace function public.has_permission(p_key text)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid()
      and ur.revoked_at is null
      and p.key = p_key
    union all
    select 1
    from public.team_members tm
    join public.team_roles tr on tr.team_id = tm.team_id
    join public.role_permissions rp on rp.role_id = tr.role_id
    join public.permissions p on p.id = rp.permission_id
    where tm.user_id = auth.uid()
      and tm.removed_at is null
      and p.key = p_key
  )
$$;

-- Standard Supabase role grants (lost when public schema is dropped/recreated)
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
