-- Seed the company.billing permission and assign it to Owner + Admin system roles.
-- The permission key is already referenced in _can_manage_billing() but was never
-- inserted into the permissions table, so role assignment had no effect.

INSERT INTO public.permissions (key, label, description, category)
VALUES ('company.billing', 'Manage Billing', 'View and manage the company subscription, plan limits, and billing history.', 'company')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = true
  AND r.name IN ('Owner', 'Admin')
  AND p.key = 'company.billing'
ON CONFLICT DO NOTHING;
