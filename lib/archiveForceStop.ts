import { supabase } from '@/lib/supabase';

type ArchiveBlockDetail = { session_id: string; holder: string; is_stale: boolean };

function parseBlockDetail(err: any): ArchiveBlockDetail | null {
  try {
    return err?.details ? JSON.parse(err.details) : null;
  } catch {
    return null;
  }
}

type ShowConfirm = (
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel?: () => void,
  confirmText?: string,
  cancelText?: string,
  confirmStyle?: 'default' | 'destructive'
) => void;

/**
 * #162: rpc_archive_task's DETAIL carries the blocking session id when a
 * dead (stale-heartbeat) timer is refusing the archive. If the caller can
 * force-stop it, offer that instead of a dead-end error.
 *
 * Returns true if it handled the error (a confirm dialog was shown) — the
 * caller should skip its normal error toast in that case.
 */
export function offerForceStopOnArchiveError(
  err: any,
  opts: {
    hasPermission: (perm: string) => boolean;
    showConfirm: ShowConfirm;
    errorToast: (message: string, title?: string) => void;
    retry: () => void;
  }
): boolean {
  const blocker = parseBlockDetail(err);
  const canForceStop = !!blocker?.is_stale
    && (opts.hasPermission('archive:create') || opts.hasPermission('pipeline.edit'));

  if (!canForceStop) return false;

  opts.showConfirm(
    'Stale timer blocking archive',
    `${blocker!.holder}'s timer has gone stale (no activity in a while). Force-stop it and archive this task?`,
    async () => {
      const { error: stopError } = await supabase.rpc('rpc_force_stop_session', {
        p_session_id: blocker!.session_id,
      });
      if (stopError) {
        opts.errorToast(stopError.message || 'Could not force-stop the session.', 'Archival failed');
        return;
      }
      opts.retry();
    },
    undefined,
    'Force-stop & archive',
    'Cancel',
    'destructive'
  );
  return true;
}
