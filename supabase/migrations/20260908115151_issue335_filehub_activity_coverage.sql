-- FileHub activity coverage (#335). Keep verbs stable: readers render these
-- values directly and metadata is intentionally small/non-secret.
ALTER TABLE public.filehub_activity
  DROP CONSTRAINT IF EXISTS filehub_activity_action_check;

ALTER TABLE public.filehub_activity
  ADD CONSTRAINT filehub_activity_action_check
  CHECK (action IN (
    'upload', 'download', 'view', 'delete', 'share',
    'rename', 'move', 'restore', 'share_revoke',
    'folder_create', 'folder_delete'
  ));
