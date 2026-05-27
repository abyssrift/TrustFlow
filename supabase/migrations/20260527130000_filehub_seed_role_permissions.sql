-- filehub_seed_role_permissions
-- filehub:view / send / groups → all four system roles
-- filehub:broadcast           → Owner, Admin, Manager only
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name IN ('Owner', 'Admin', 'Manager', 'Personnel')
  AND p.key IN ('filehub:view', 'filehub:send', 'filehub:groups')

UNION ALL

SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name IN ('Owner', 'Admin', 'Manager')
  AND p.key = 'filehub:broadcast'

ON CONFLICT DO NOTHING;
