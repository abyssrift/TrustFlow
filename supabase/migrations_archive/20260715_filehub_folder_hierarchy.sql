-- 20260715_filehub_folder_hierarchy.sql
-- FileHub folders: flat -> hierarchical (parent_id self-reference, Windows-Explorer style).
-- No folder "move" yet — a folder's parent is fixed at creation time, so the
-- tree can't develop a cycle and no recursive cycle-check RPC is needed.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. SCHEMA
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.filehub_folders
    ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.filehub_folders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_filehub_folders_parent ON public.filehub_folders(parent_id);

-- Old constraint was UNIQUE (company_id, name); replace with two partial
-- indexes so the same name can be reused under different parents.
ALTER TABLE public.filehub_folders DROP CONSTRAINT IF EXISTS filehub_folders_company_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_filehub_folders_unique_root
    ON public.filehub_folders(company_id, name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_filehub_folders_unique_child
    ON public.filehub_folders(company_id, parent_id, name) WHERE parent_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RPCs
-- ────────────────────────────────────────────────────────────────────────────

-- rpc_filehub_folder_create gains p_parent_id. Old 1-arg signature is dropped
-- (not just replaced) so it doesn't linger as a dead overload.
DROP FUNCTION IF EXISTS public.rpc_filehub_folder_create(TEXT);

CREATE FUNCTION public.rpc_filehub_folder_create(p_name TEXT, p_parent_id UUID DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_id         UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    IF p_parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders WHERE id = p_parent_id AND company_id = v_company_id
    ) THEN
        RAISE EXCEPTION 'Parent folder does not exist in this company.';
    END IF;
    INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id)
    VALUES (v_company_id, trim(p_name), v_user_id, p_parent_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_create(TEXT, UUID) TO authenticated;

-- rpc_filehub_folder_delete is unchanged (still deletes by id + company_id).
-- Subfolders now cascade-delete via the parent_id FK, and each deleted
-- folder's own files still fall back to unfiled via the pre-existing
-- filehub_files.folder_id ON DELETE SET NULL — Postgres walks both FKs
-- recursively, no PL/pgSQL recursion required.
