-- 20260714_archive_delete_grant_existing_roles.sql
-- archive.delete was seeded with no role grants, so it never showed up in
-- get_my_permissions() for anyone (including the Owner system role) even
-- though the RPC itself already allows owners through. Mirror whatever
-- roles currently hold archive.restore, since that's the existing bar for
-- "can manage cold storage archives".

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT rp.role_id, dp.id
FROM public.role_permissions rp
JOIN public.permissions sp ON sp.id = rp.permission_id AND sp.key = 'archive.restore'
JOIN public.permissions dp ON dp.key = 'archive.delete'
ON CONFLICT DO NOTHING;
