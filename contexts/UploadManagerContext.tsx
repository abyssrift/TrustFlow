// ====================================================================
// UploadManagerContext — background FileHub uploads
// ====================================================================
//
// The upload engine used to live inside the desktop FileHub upload modal's
// component state, so closing the modal (or navigating away) unmounted it and
// killed the upload. This lifts the whole engine — the 4-worker pool, the
// duplicate / name-conflict handling, the per-file commit — into a global
// provider mounted once at the app root. The modal is now just a launcher: it
// gathers the draft and calls `startUpload`, then it's free to close while the
// job keeps running.
//
// Each job publishes an activity to IslandContext (progress ring, ETA, a
// cancel button). Conflicts can't fall back to the modal's in-place dialog
// anymore (it may be gone), so they surface as island DECISIONS — the job
// pauses that file and waits for the user to answer from the island itself.
//
// Cancellation is cooperative: an AbortController flips a flag the worker loop
// checks before each file and before each commit. An in-flight storage PUT
// isn't force-killed (supabase-js has no clean abort for it), but no further
// files start, and a byte batch that already landed without committing is
// removed so it can't orphan.
// ====================================================================

import { useIsland, type IslandActivity, type IslandDecision } from '@/contexts/IslandContext';
import { useToast } from '@/contexts/ToastContext';
import type { FileHubFolder } from '@/contexts/FileHubContext';
import { relDir, resolveExistingFolderLeaf } from '@/lib/filehubFolderTree';
import { randomId } from '@/lib/randomId';
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { computeSHA256, formatEta, formatFileSize, isNetworkError, uploadFileToStorage, waitForReconnect } from '@/lib/uploadHelpers';
import { useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

export type UploadVisibility = 'direct' | 'broadcast' | 'group';

export type UploadJobInput = {
  files: File[];
  companyId: string;
  visibility: UploadVisibility;
  folderId: string | null;
  recipientIds: string[];
  groupId: string | null;
  tags: string[];
  caption: string | null;
  maxFileSizeBytes: number | null;
  // Snapshot of the target scope's folders at launch — used only for the
  // pre-upload dup/conflict checks (which need a folder id when the sub-folder
  // already exists). The real sub-tree is get-or-created server-side at commit.
  scopedFolders: FileHubFolder[];
  label?: string; // "Direct" / "Broadcast" / channel name — island subtitle flavour
};

// Live, per-job snapshot the upload modal reads to render its in-modal progress
// UI. Kept in a ref-backed external store (not React state) so the ~10Hz
// progress ticks re-render ONLY the modal that subscribes — not the whole app
// under this root-level provider.
export type UploadJobState = {
  jobId: string;
  status: 'uploading' | 'done' | 'partial' | 'error' | 'cancelled';
  progress: number; // 0..100
  done: number;     // files committed
  total: number;
  okCount: number;
  errorCount: number;
  title: string;
  subtitle: string;
  // Mirror of any island prompt (dup/name conflict) this job is parked on, so
  // the modal can show it inline while it's open — otherwise the prompt lives in
  // the island, which is occluded behind the modal. Same objects, same resolve.
  decisions?: IslandDecision[];
};

type UploadManagerValue = {
  startUpload: (job: UploadJobInput) => string;
  cancelUpload: (jobId: string) => void;
  activeCount: number;
  // Bumped whenever any job finishes so a mounted FileHub screen can refresh.
  lastCompletedAt: number;
  // External store for per-job live state (see useUploadJob).
  jobsStore: {
    subscribe: (cb: () => void) => () => void;
    getJob: (jobId: string) => UploadJobState | undefined;
  };
};

const UploadManagerContext = createContext<UploadManagerValue | null>(null);

const SAFE_NAME = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

export function UploadManagerProvider({ children }: { children: React.ReactNode }) {
  const { publish, update, remove } = useIsland();
  const { successToast, errorToast, infoToast } = useToast();
  const router = useRouter();

  const [activeCount, setActiveCount] = useState(0);
  const [lastCompletedAt, setLastCompletedAt] = useState(0);

  // Warn on tab close while any upload is in flight. Killing the tab between a
  // file's storage PUT and its commit strands bytes in the bucket (the daily
  // filehub-orphan-sweep reaps them, but the user also loses the rest of the
  // batch). The modal used to own this guard; the manager owns it now that the
  // work outlives the modal.
  useEffect(() => {
    if (activeCount === 0 || typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activeCount]);

  // Per-job control: abort flag, a hook to force-resolve a pending decision so
  // a cancel unwinds a worker parked on the user, and the live XHRs so cancel
  // can hard-abort in-flight transfers.
  const controllers = useRef<Record<string, {
    aborted: boolean;
    resolvePending: ((v: string) => void) | null;
    xhrs: Set<XMLHttpRequest>;
  }>>({});

  // Ref-backed external store for per-job live state (drives the modal UI).
  const jobsRef = useRef<Record<string, UploadJobState>>({});
  const jobListeners = useRef(new Set<() => void>());
  const emitJobs = useCallback(() => { jobListeners.current.forEach(l => l()); }, []);
  const setJob = useCallback((jobId: string, patch: Partial<UploadJobState>) => {
    const prev = jobsRef.current[jobId];
    jobsRef.current = { ...jobsRef.current, [jobId]: { ...(prev as UploadJobState), ...patch } };
    emitJobs();
  }, [emitJobs]);
  const jobsStore = useMemo(() => ({
    subscribe: (cb: () => void) => { jobListeners.current.add(cb); return () => { jobListeners.current.delete(cb); }; },
    getJob: (jobId: string) => jobsRef.current[jobId],
  }), []);

  const cancelUpload = useCallback((jobId: string) => {
    const id = `upload:${jobId}`;
    const ctrl = controllers.current[jobId];
    if (ctrl) {
      ctrl.aborted = true;
      ctrl.resolvePending?.('cancel_all'); // release a parked worker
      ctrl.xhrs.forEach(x => { try { x.abort(); } catch { /* already settled */ } });
    }
    if (jobsRef.current[jobId]) setJob(jobId, { status: 'cancelled', subtitle: 'Stopping…' });
    update(id, {
      accent: 'warning',
      title: 'Upload cancelled',
      subtitle: 'Stopping…',
      decisions: [],
      progress: null,
      pulse: false,
      actions: [],
    }, { bump: true });
    setTimeout(() => remove(id), 2500);
  }, [update, remove, setJob]);

  const startUpload = useCallback((job: UploadJobInput): string => {
    const jobId = randomId();
    const islandId = `upload:${jobId}`;
    controllers.current[jobId] = { aborted: false, resolvePending: null, xhrs: new Set() };
    setActiveCount(n => n + 1);

    const total = job.files.length;
    const totalBytes = job.files.reduce((s, f) => s + f.size, 0);
    const scopeLabel = job.label || (job.visibility === 'group' ? 'Channel' : job.visibility === 'broadcast' ? 'Broadcast' : 'Direct');

    // Seed the modal-facing job snapshot.
    jobsRef.current = {
      ...jobsRef.current,
      [jobId]: {
        jobId,
        status: 'uploading',
        progress: 0,
        done: 0,
        total,
        okCount: 0,
        errorCount: 0,
        title: `Uploading ${total} file${total === 1 ? '' : 's'}`,
        subtitle: `${scopeLabel} · starting…`,
      },
    };
    emitJobs();

    // Initial descriptor.
    publish({
      id: islandId,
      kind: 'upload',
      icon: 'cloud-upload',
      accent: 'primary',
      compactLabel: '0%',
      progress: 0,
      pulse: true,
      title: `Uploading ${total} file${total === 1 ? '' : 's'}`,
      subtitle: `${scopeLabel} · starting…`,
      onPress: () => router.push('/filehub' as any),
      actions: [{ key: 'cancel', icon: 'times', label: 'Cancel upload', tone: 'danger', onPress: () => cancelUpload(jobId) }],
    });

    // Fire-and-forget; the provider stays mounted so this outlives any screen.
    void runJob(jobId, islandId, job, { total, totalBytes, scopeLabel });
    return jobId;

    async function runJob(
      jobId: string,
      islandId: string,
      job: UploadJobInput,
      meta: { total: number; totalBytes: number; scopeLabel: string },
    ) {
      const ctrl = controllers.current[jobId];
      const errors: string[] = [];
      let dupeAll: string | null = null;
      let conflictAll: string | null = null;
      // One id for this whole upload job. Every version row it produces carries
      // it, which is what makes the destination folder read as a single new
      // version instead of N unrelated file changes. Generated here (not per
      // file) precisely so the 4 parallel workers all stamp the same batch.
      const batchId = randomId();
      let done = 0;
      let bytesDone = 0; // bytes from fully-committed files
      const startedAt = Date.now();

      // Live per-file byte counters (keyed by file index) so the ring moves
      // smoothly WITHIN a single big file, not just when a whole file lands.
      const inFlight = new Map<number, number>();
      let lastEmit = 0;
      let lastPct = -1;

      const computeSync = (force: boolean) => {
        let live = bytesDone;
        inFlight.forEach(v => { live += v; });
        const pct = meta.totalBytes > 0
          ? Math.min(100, Math.max(1, Math.round((live / meta.totalBytes) * 100)))
          : Math.min(100, Math.max(1, Math.round((done / meta.total) * 100)));
        // Throttle: island/store churn only on a whole-percent change or ~120ms.
        const now = Date.now();
        if (!force && pct === lastPct && now - lastEmit < 120) return;
        lastPct = pct; lastEmit = now;

        const elapsed = (now - startedAt) / 1000;
        const rate = live > 0 && elapsed > 0 ? live / elapsed : 0;
        const remaining = rate > 0 ? (meta.totalBytes - live) / rate : null;
        const eta = formatEta(remaining);
        const subtitle = `${done}/${meta.total}${eta ? ` · ${eta}` : ''}`;
        update(islandId, { compactLabel: `${pct}%`, progress: pct, subtitle }, { bump: false });
        setJob(jobId, { progress: pct, done, subtitle });
      };
      const syncProgress = () => computeSync(true);
      const onFileProgress = (idx: number, loaded: number) => { inFlight.set(idx, loaded); computeSync(false); };

      // One decision on screen at a time; workers queue behind this chain and
      // re-check the remembered "…for all" answer once it's their turn.
      let dialogQueue: Promise<unknown> = Promise.resolve();
      const askQueued = (remembered: () => string | null, show: () => Promise<string>): Promise<string> => {
        const turn = dialogQueue.then(() => remembered() ?? show());
        dialogQueue = turn.catch(() => {});
        return turn;
      };

      // Surface a conflict/dup prompt as an island decision and await the click.
      const askDecision = (title: string, message: string, options: IslandDecision['options']): Promise<string> =>
        new Promise<string>(resolve => {
          if (ctrl.aborted) { resolve('cancel_all'); return; }
          const decisionId = randomId();
          const finish = (value: string) => {
            ctrl.resolvePending = null;
            update(islandId, { decisions: [] }, { bump: false });
            setJob(jobId, { decisions: [], subtitle: `${done}/${meta.total} · resuming…` });
            resolve(value);
          };
          ctrl.resolvePending = finish;
          const decision: IslandDecision = { id: decisionId, title, message, options, resolve: finish };
          update(islandId, { decisions: [decision] }); // bump → grabs the idle slot + auto-expands
          // Mirror into the modal-facing snapshot and flag the pause so the
          // in-modal view stops implying progress while it waits on the user.
          setJob(jobId, { decisions: [decision], subtitle: 'Waiting for you…' });
        });

      // One storage PUT with byte progress + hard-abort registration. Shared by
      // the normal-commit path and the replace path.
      const putToStorage = async (path: string, file: File, idx: number) => {
        const { data: sess } = await supabase.auth.getSession();
        const accessToken = sess.session?.access_token;
        if (!accessToken) throw new Error('Not signed in.');
        await uploadFileToStorage({
          baseUrl: supabaseUrl,
          anonKey: supabaseAnonKey,
          accessToken,
          bucket: 'filehub-files',
          path,
          file,
          onProgress: (loaded) => onFileProgress(idx, loaded),
          registerXhr: (xhr) => { if (xhr) ctrl.xhrs.add(xhr); },
        });
      };

      const uploadOne = async (file: File, idx: number, isRetry = false): Promise<void> => {
        if (ctrl.aborted) return;
        const relDirPath = relDir((file as any).webkitRelativePath);
        const existingLeaf = relDirPath
          ? resolveExistingFolderLeaf(job.folderId, relDirPath, job.scopedFolders)
          : job.folderId;
        const folderIsNew = relDirPath !== '' && existingLeaf === null;
        const checkFolderId = existingLeaf ?? job.folderId;
        try {
          if (job.maxFileSizeBytes != null && file.size > job.maxFileSizeBytes) {
            errors.push(`${file.name}: exceeds your plan's ${formatFileSize(job.maxFileSizeBytes)} file size limit.`);
            return;
          }
          const contentHash = await computeSHA256(file);
          if (ctrl.aborted) return;

          if (!folderIsNew) {
            const { data: dupData } = await supabase.rpc('rpc_filehub_check_duplicate', { p_content_hash: contentHash, p_folder_id: checkFolderId });
            const dupes = dupData || [];
            if (dupes.length > 0) {
              let proceed = await askQueued(() => dupeAll, () => askDecision(
                'Possible duplicate',
                `"${dupes[0].original_name}" has the same content as "${file.name}". Upload anyway?`,
                [
                  { label: 'Skip', value: 'cancel', tone: 'neutral' },
                  { label: 'Skip all', value: 'cancel_all', tone: 'neutral' },
                  { label: 'Upload', value: 'proceed', tone: 'primary' },
                  { label: 'Upload all', value: 'proceed_all', tone: 'primary' },
                ],
              ));
              if (proceed.endsWith('_all')) { proceed = proceed.slice(0, -4); dupeAll = proceed; }
              if (proceed !== 'proceed') return;
            }
          }
          if (ctrl.aborted) return;

          const groupId = job.visibility === 'group' ? (job.groupId ?? null) : null;
          const conflict = folderIsNew ? null : (await supabase.rpc('rpc_filehub_check_name_conflict', {
            p_name: file.name, p_visibility: job.visibility, p_group_id: groupId, p_folder_id: checkFolderId,
          })).data ?? null;
          if (conflict) {
            let choice = await askQueued(() => conflictAll, () => askDecision(
              'File already exists',
              `"${file.name}" already exists here (uploaded by ${conflict.uploader_name}). Replace it, or keep both?`,
              [
                { label: 'Skip', value: 'cancel', tone: 'neutral' },
                { label: 'Skip all', value: 'cancel_all', tone: 'neutral' },
                { label: 'Keep both', value: 'keep', tone: 'primary' },
                { label: 'Replace', value: 'replace', tone: 'warning' },
                { label: 'Replace all', value: 'replace_all', tone: 'warning' },
              ],
            ));
            if (choice.endsWith('_all')) { choice = choice.slice(0, -4); conflictAll = choice; }
            if (choice === 'cancel') return;
            if (choice === 'replace') {
              if (ctrl.aborted) return;
              const replacePath = `${job.companyId}/${randomId()}/${SAFE_NAME(file.name)}`;
              await putToStorage(replacePath, file, idx);
              if (ctrl.aborted) {
                await supabase.storage.from('filehub-files').remove([replacePath]).catch(() => {});
                return;
              }
              const { error: replaceErr } = await supabase.rpc('rpc_filehub_replace_file', {
                p_target_id: conflict.id,
                p_storage_path: replacePath,
                p_size_bytes: file.size,
                p_content_hash: contentHash,
                p_mime_type: file.type || null,
                p_caption: job.caption || null,
                p_batch_id: batchId,
              });
              if (replaceErr) {
                await supabase.storage.from('filehub-files').remove([replacePath]).catch(() => {});
                throw replaceErr;
              }
              return;
            }
            // 'keep' falls through to the normal commit (server auto-renames).
          }
          if (ctrl.aborted) return;

          const storagePath = `${job.companyId}/${randomId()}/${SAFE_NAME(file.name)}`;
          await putToStorage(storagePath, file, idx);

          // Cancelled after the PUT but before commit → drop the bytes so they
          // don't orphan, and stop.
          if (ctrl.aborted) {
            await supabase.storage.from('filehub-files').remove([storagePath]).catch(() => {});
            return;
          }

          const { error: rpcError } = await supabase.rpc('rpc_filehub_upload_commit', {
            p_storage_path: storagePath,
            p_visibility: job.visibility,
            p_recipient_ids: job.visibility === 'direct' ? job.recipientIds : [],
            p_folder_id: job.folderId,
            p_tags: job.tags,
            p_caption: job.caption || null,
            p_original_name: file.name,
            p_mime_type: file.type || null,
            p_size_bytes: file.size,
            p_content_hash: contentHash,
            p_replaces_file_id: null,
            p_group_id: groupId,
            p_rel_dir: relDirPath || null,
            p_batch_id: batchId,
          });
          if (rpcError) {
            await supabase.storage.from('filehub-files').remove([storagePath]).catch(() => {});
            throw rpcError;
          }
        } catch (e: any) {
          // A cancel aborts the in-flight XHR, which rejects with 'aborted' —
          // that's expected teardown, not a per-file failure to report.
          if (ctrl.aborted) return;
          if (!isRetry && isNetworkError(e)) {
            const subtitle = `Connection lost — retrying "${file.name}" when back online…`;
            setJob(jobId, { subtitle });
            update(islandId, { subtitle }, { bump: false });
            infoToast(`Connection dropped mid-upload — retrying "${file.name}"…`, 'Retrying');
            await waitForReconnect(() => ctrl.aborted);
            if (!ctrl.aborted) return uploadOne(file, idx, true);
          }
          errors.push(`${file.name}: ${e?.message || 'Unknown error'}`);
        }
      };

      // Fixed pool of 4 (same as before). Bytes drive the progress ring so a
      // couple of big files don't make it lurch.
      let nextIdx = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, meta.total) }, async () => {
          for (;;) {
            if (ctrl.aborted) break;
            const i = nextIdx++;
            if (i >= meta.total) break;
            const file = job.files[i];
            await uploadOne(file, i);
            inFlight.delete(i); // fold its partial bytes into the committed total
            done++;
            bytesDone += file.size;
            syncProgress();
          }
        }),
      );

      // Wrap up.
      delete controllers.current[jobId];
      setActiveCount(n => Math.max(0, n - 1));
      setLastCompletedAt(Date.now());
      // Drop the modal-facing snapshot a while after the island clears itself so
      // jobsRef doesn't accumulate across a long session.
      setTimeout(() => {
        if (jobsRef.current[jobId]) {
          const { [jobId]: _gone, ...rest } = jobsRef.current;
          jobsRef.current = rest;
          emitJobs();
        }
      }, 15000);

      if (ctrl.aborted) {
        setJob(jobId, { status: 'cancelled', title: 'Upload cancelled', subtitle: `${done}/${meta.total} committed` });
        update(islandId, { title: 'Upload cancelled', subtitle: `${done}/${meta.total} committed`, accent: 'warning', progress: null, pulse: false, decisions: [], actions: [] }, { bump: true });
        setTimeout(() => remove(islandId), 2500);
        return;
      }

      const okCount = meta.total - errors.length;
      const allFailed = errors.length === meta.total && meta.total > 0;
      const hasErrors = errors.length > 0;
      // On failure the island shows the actual reason (first error), not just a
      // count — and forces itself open so a background failure isn't missed.
      const reason = hasErrors
        ? (allFailed ? errors[0] : `${okCount} uploaded · ${errors[0]}`)
        : meta.scopeLabel;
      setJob(jobId, {
        status: allFailed ? 'error' : hasErrors ? 'partial' : 'done',
        progress: 100,
        done: meta.total,
        okCount,
        errorCount: errors.length,
        title: allFailed ? 'Upload failed' : `Uploaded ${okCount} file${okCount === 1 ? '' : 's'}`,
        subtitle: reason,
      });
      update(islandId, {
        icon: allFailed ? 'exclamation-triangle' : hasErrors ? 'exclamation-circle' : 'check',
        accent: allFailed ? 'danger' : hasErrors ? 'warning' : 'success',
        compactLabel: allFailed ? 'Failed' : hasErrors ? 'Partial' : 'Done',
        progress: 100,
        pulse: false,
        title: allFailed ? 'Upload failed' : hasErrors ? `Uploaded ${okCount} of ${meta.total}` : `Uploaded ${okCount} file${okCount === 1 ? '' : 's'}`,
        subtitle: reason,
        attention: hasErrors, // pop the island open on any failure
        decisions: [],
        actions: [{ key: 'dismiss', icon: 'times', label: 'Dismiss', tone: 'neutral', onPress: () => remove(islandId) }],
      }, { bump: true });

      if (allFailed) {
        errorToast(`Upload failed: ${errors[0]}`);
      } else if (hasErrors) {
        errorToast(`${okCount} uploaded, ${errors.length} failed.`);
        // Failures linger longer than a clean run so there's time to read them.
        setTimeout(() => remove(islandId), 12000);
      } else {
        successToast(`Uploaded ${okCount} file${okCount === 1 ? '' : 's'}.`);
        setTimeout(() => remove(islandId), 4000);
      }
    }
  }, [publish, update, remove, router, cancelUpload, successToast, errorToast, infoToast, emitJobs, setJob]);

  const value = useMemo(
    () => ({ startUpload, cancelUpload, activeCount, lastCompletedAt, jobsStore }),
    [startUpload, cancelUpload, activeCount, lastCompletedAt, jobsStore],
  );

  return <UploadManagerContext.Provider value={value}>{children}</UploadManagerContext.Provider>;
}

export function useUploadManager(): UploadManagerValue {
  const ctx = useContext(UploadManagerContext);
  if (!ctx) throw new Error('useUploadManager must be used within UploadManagerProvider');
  return ctx;
}

// Subscribe to ONE job's live state (progress, counts, status). Backed by the
// manager's external store so only this consumer re-renders on progress ticks,
// not the whole app under the root provider. Pass null to observe nothing.
export function useUploadJob(jobId: string | null): UploadJobState | undefined {
  const { jobsStore } = useUploadManager();
  return useSyncExternalStore(
    jobsStore.subscribe,
    () => (jobId ? jobsStore.getJob(jobId) : undefined),
    () => undefined,
  );
}
