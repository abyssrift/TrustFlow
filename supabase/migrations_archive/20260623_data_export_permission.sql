-- Permission gating the new company-wide Data Export panel (Tasks/Projects/Time Tracking).
INSERT INTO public.permissions (key, label, description, category)
VALUES ('data.export', 'Export Company Data', 'Download tasks, projects, and time tracking data as CSV/XLSX.', 'company')
ON CONFLICT (key) DO NOTHING;

-- Seed the permission onto system admin roles
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = TRUE AND r.name ILIKE '%admin%'
  AND p.key = 'data.export'
ON CONFLICT DO NOTHING;
