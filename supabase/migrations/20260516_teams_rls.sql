-- Enable Row Level Security for teams and related tables
-- Ensures teams, team_members and team_roles are scoped to the caller's company

BEGIN;

-- Teams table: restrict all operations to the caller's company
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teams: select by company" ON public.teams
  FOR SELECT USING (company_id = public.my_company_id());

CREATE POLICY "Teams: insert only in company" ON public.teams
  FOR INSERT WITH CHECK (company_id = public.my_company_id());

CREATE POLICY "Teams: update by company" ON public.teams
  FOR UPDATE USING (company_id = public.my_company_id()) WITH CHECK (company_id = public.my_company_id());

CREATE POLICY "Teams: delete by company" ON public.teams
  FOR DELETE USING (company_id = public.my_company_id());

-- Team members: only visible/usable when the team belongs to the caller's company
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TeamMembers: select when team in company" ON public.team_members
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = public.team_members.team_id AND t.company_id = public.my_company_id())
  );

CREATE POLICY "TeamMembers: insert only for company teams" ON public.team_members
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.company_id = public.my_company_id())
  );

CREATE POLICY "TeamMembers: update/delete when team in company" ON public.team_members
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = public.team_members.team_id AND t.company_id = public.my_company_id())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.company_id = public.my_company_id())
  );

-- Team roles: only visible/usable when the team belongs to the caller's company
ALTER TABLE public.team_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TeamRoles: select when team in company" ON public.team_roles
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = public.team_roles.team_id AND t.company_id = public.my_company_id())
  );

CREATE POLICY "TeamRoles: insert only for company teams" ON public.team_roles
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.company_id = public.my_company_id())
  );

CREATE POLICY "TeamRoles: update/delete when team in company" ON public.team_roles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = public.team_roles.team_id AND t.company_id = public.my_company_id())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.teams t WHERE t.id = team_id AND t.company_id = public.my_company_id())
  );

COMMIT;

-- Notes:
-- * This migration assumes the helper function `public.my_company_id()` exists and returns
--   the UUID of the company associated with the current `auth.uid()`. If your environment
--   requires a different mechanism, adjust the policy predicates accordingly.
