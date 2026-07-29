-- Mark all File Hub inbox items as read for the current user.

CREATE OR REPLACE FUNCTION public.rpc_filehub_mark_all_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    UPDATE public.filehub_recipients
    SET read_at = COALESCE(read_at, now())
    WHERE user_id = auth.uid()
      AND read_at IS NULL;
END;
$$;