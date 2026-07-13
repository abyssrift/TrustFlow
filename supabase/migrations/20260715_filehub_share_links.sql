-- 20260715_filehub_share_links.sql
-- Read-only, expiring share links for FileHub files (public, no login required).
--
-- Security model: this table + these RPCs never hand out file bytes directly.
-- Creating/revoking/listing links requires an authenticated session and file
-- ownership (same rule as rpc_filehub_delete/rpc_filehub_file_move). Resolving
-- a token into an actual downloadable URL is NOT done here — that's the
-- filehub-share-resolve Edge Function, which runs with the service role and
-- is the only code path that ever serves file bytes to a logged-out visitor.
-- Every check that matters (expiry, revocation, soft-delete) lives there too.

CREATE TABLE public.filehub_share_links (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id        UUID NOT NULL REFERENCES public.filehub_files(id) ON DELETE CASCADE,
    company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    token          TEXT NOT NULL,
    created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,
    view_count     INT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX idx_filehub_share_links_token ON public.filehub_share_links(token);
CREATE INDEX idx_filehub_share_links_file ON public.filehub_share_links(file_id);

ALTER TABLE public.filehub_share_links ENABLE ROW LEVEL SECURITY;

-- Only the creator can see their own links via the normal client (the
-- Edge Function bypasses this with the service role, which is required
-- since the visitor clicking the link has no session at all).
CREATE POLICY "filehub_share_links_select_own" ON public.filehub_share_links
    FOR SELECT USING (created_by = auth.uid());

CREATE FUNCTION public.rpc_filehub_share_link_create(p_file_id UUID, p_expires_in_hours INT DEFAULT 168)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_token      TEXT;
    v_expires_at TIMESTAMPTZ;
    v_id         UUID;
BEGIN
    IF p_expires_in_hours NOT BETWEEN 1 AND 720 THEN
        RAISE EXCEPTION 'Expiry must be between 1 hour and 30 days.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_files
        WHERE id = p_file_id AND company_id = v_company_id AND uploaded_by = v_user_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;

    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires_at := now() + (p_expires_in_hours || ' hours')::interval;

    INSERT INTO public.filehub_share_links (file_id, company_id, token, created_by, expires_at)
    VALUES (p_file_id, v_company_id, v_token, v_user_id, v_expires_at)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_share_link_create(UUID, INT) TO authenticated;

CREATE FUNCTION public.rpc_filehub_share_link_revoke(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.filehub_share_links
    SET revoked_at = now()
    WHERE id = p_id AND created_by = auth.uid() AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Share link not found or already revoked.';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_share_link_revoke(UUID) TO authenticated;

CREATE FUNCTION public.rpc_filehub_share_link_list(p_file_id UUID)
RETURNS TABLE (
    id UUID, token TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, view_count INT, last_viewed_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id, token, created_at, expires_at, revoked_at, view_count, last_viewed_at
    FROM public.filehub_share_links
    WHERE file_id = p_file_id AND created_by = auth.uid()
    ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_share_link_list(UUID) TO authenticated;
