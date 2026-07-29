-- ============================================================
-- Fix: analytics.view and analytics.compare were never
-- assigned to any roles — grant them to all roles that already
-- hold report.view (same audience: managers, leads, admins).
-- analytics.compare is additionally scoped to roles with
-- user.view_all (admin-tier only).
-- ============================================================

-- 1. Ensure the permission rows exist (idempotent)
INSERT INTO public.permissions (key, label)
VALUES
  ('analytics.view',    'View Analytics Dashboard'),
  ('analytics.compare', 'Compare Personnel Performance')
ON CONFLICT (key) DO NOTHING;

-- 2. Grant analytics.view to every role that has report.view
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT
  rp.role_id,
  p_analytics.id
FROM public.role_permissions rp
JOIN public.permissions p_report   ON p_report.id   = rp.permission_id AND p_report.key   = 'report.view'
JOIN public.permissions p_analytics ON p_analytics.key = 'analytics.view'
ON CONFLICT DO NOTHING;

-- 3. Grant analytics.compare to every role that has user.view_all
--    (i.e. admin / company-lead tier)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT
  rp.role_id,
  p_compare.id
FROM public.role_permissions rp
JOIN public.permissions p_admin   ON p_admin.id   = rp.permission_id AND p_admin.key   = 'user.view_all'
JOIN public.permissions p_compare ON p_compare.key = 'analytics.compare'
ON CONFLICT DO NOTHING;
