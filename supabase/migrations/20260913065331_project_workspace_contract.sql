-- Issue #420 / Package 1A: project FileHub workspace schema contract.
-- Additive and rerunnable.  Workspace behavior and RPCs are owned by later
-- packages; this migration only establishes durable data invariants.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS workspace_folder_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.projects'::regclass
      AND conname = 'projects_workspace_folder_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_workspace_folder_id_fkey
      FOREIGN KEY (workspace_folder_id)
      REFERENCES public.filehub_folders(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.filehub_folders
  ADD COLUMN IF NOT EXISTS project_root_kind TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.filehub_folders'::regclass
      AND conname = 'filehub_folders_project_root_kind_chk'
  ) THEN
    ALTER TABLE public.filehub_folders
      ADD CONSTRAINT filehub_folders_project_root_kind_chk
      CHECK (
        project_root_kind IS NULL
        OR (
          project_root_kind IN ('workspace', 'deliverable')
          AND scope = 'project'
          AND project_id IS NOT NULL
          AND parent_id IS NULL
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.projects.workspace_folder_id IS
  'Nullable pointer to the live editable project FileHub workspace root.';

COMMENT ON COLUMN public.filehub_folders.project_root_kind IS
  'Classifies a project root as workspace or deliverable; null for nested and non-project folders.';

-- Existing deliverables are the authoritative source for the historical
-- root classification.  This leaves client standing folders untouched.
UPDATE public.filehub_folders f
SET project_root_kind = 'deliverable'
FROM public.projects p
WHERE p.deliverable_folder_id = f.id
  AND f.project_root_kind IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_filehub_folders_project_root_live
  ON public.filehub_folders (project_id, project_root_kind)
  WHERE scope = 'project'
    AND parent_id IS NULL
    AND project_root_kind IS NOT NULL
    AND deleted_at IS NULL;

-- Preserve the existing deliverable helper's body and permissions.  The only
-- behavioral addition is the root classification required by the contract.
CREATE OR REPLACE FUNCTION public.fn_project_ensure_deliverable_folder(p_project_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID;
    v_name       TEXT;
    v_folder_id  UUID;
BEGIN
    SELECT company_id, deliverable_folder_id, left(name, 80)
      INTO v_company_id, v_folder_id, v_name
    FROM public.projects
    WHERE id = p_project_id AND deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_folder_id IS NOT NULL THEN
        RETURN v_folder_id;
    END IF;

    INSERT INTO public.filehub_folders (
        company_id, name, created_by, parent_id, scope, project_id, project_root_kind
    )
    VALUES (v_company_id, v_name, auth.uid(), NULL, 'project', p_project_id, 'deliverable')
    RETURNING id INTO v_folder_id;

    UPDATE public.projects SET deliverable_folder_id = v_folder_id WHERE id = p_project_id;

    RETURN v_folder_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_projects_workspace_folder_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_folder public.filehub_folders%ROWTYPE;
BEGIN
  IF NEW.workspace_folder_id IS NOT NULL THEN
    SELECT * INTO v_folder
    FROM public.filehub_folders
    WHERE id = NEW.workspace_folder_id;

    IF NOT FOUND
       OR v_folder.company_id IS DISTINCT FROM NEW.company_id
       OR v_folder.project_id IS DISTINCT FROM NEW.id
       OR v_folder.scope IS DISTINCT FROM 'project'
       OR v_folder.parent_id IS NOT NULL
       OR v_folder.project_root_kind IS DISTINCT FROM 'workspace'
       OR v_folder.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION
        'workspace_folder_id must reference a live same-company project workspace root';
    END IF;
  END IF;

  IF NEW.deliverable_folder_id IS NOT NULL THEN
    SELECT * INTO v_folder
    FROM public.filehub_folders
    WHERE id = NEW.deliverable_folder_id;

    IF NOT FOUND
       OR v_folder.company_id IS DISTINCT FROM NEW.company_id
       OR v_folder.project_id IS DISTINCT FROM NEW.id
       OR v_folder.scope IS DISTINCT FROM 'project'
       OR v_folder.parent_id IS NOT NULL
       OR v_folder.project_root_kind IS DISTINCT FROM 'deliverable'
       OR v_folder.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION
        'deliverable_folder_id must reference a live same-company project deliverable root';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_workspace_folder_contract ON public.projects;
CREATE CONSTRAINT TRIGGER trg_projects_workspace_folder_contract
AFTER INSERT OR UPDATE ON public.projects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_projects_workspace_folder_contract();

CREATE OR REPLACE FUNCTION public.fn_filehub_folders_project_ancestry_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent public.filehub_folders%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.project_root_kind IS NOT NULL
     AND (
       NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.scope IS DISTINCT FROM OLD.scope
       OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
       OR NEW.project_root_kind IS DISTINCT FROM OLD.project_root_kind
       OR (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'project roots cannot be moved, nested, repurposed, or deleted';
  END IF;

  IF NEW.scope = 'project' AND NEW.parent_id IS NULL
     AND NEW.project_root_kind IS NULL THEN
    RAISE EXCEPTION 'project roots must be classified as workspace or deliverable';
  END IF;

  IF NEW.scope = 'project' AND NEW.parent_id IS NOT NULL THEN
    IF NEW.project_root_kind IS NOT NULL THEN
      RAISE EXCEPTION 'nested project folders cannot have a project root kind';
    END IF;

    SELECT * INTO v_parent
    FROM public.filehub_folders
    WHERE id = NEW.parent_id;

    IF NOT FOUND
       OR v_parent.scope IS DISTINCT FROM 'project'
       OR v_parent.project_id IS DISTINCT FROM NEW.project_id
       OR v_parent.company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION
        'project folder ancestry must remain within the same company and project';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filehub_folders_project_ancestry_contract ON public.filehub_folders;
CREATE TRIGGER trg_filehub_folders_project_ancestry_contract
BEFORE INSERT OR UPDATE OF company_id, project_id, scope, parent_id, project_root_kind, deleted_at
ON public.filehub_folders
FOR EACH ROW
EXECUTE FUNCTION public.fn_filehub_folders_project_ancestry_contract();
