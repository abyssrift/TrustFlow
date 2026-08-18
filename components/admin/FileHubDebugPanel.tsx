// Debug-only panel (app/admin/dev-tools) surfacing FileHub/upload internals
// that would otherwise require Supabase Studio queries or DevTools network
// throttling to observe: live upload job state, a one-shot simulated network
// drop to exercise the retry-on-reconnect path, and a raw filehub_files
// inspector with a client-side "shared object" dedupe indicator + storage
// quota gauge. Shared between dev-tools.tsx (native) and dev-tools.web.tsx —
// RN primitives only, no DOM APIs, so it renders identically on both hosts.

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { supabase } from '@/lib/supabase';
import { debugSimulateNetworkDrop, formatFileSize } from '@/lib/uploadHelpers';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

type FileRow = {
  id: string;
  original_name: string;
  visibility: string;
  storage_path: string;
  bucket: string;
  size_bytes: number;
  task_id: string | null;
  folder_id: string | null;
  created_at: string;
};

export default function FileHubDebugPanel() {
  const { jobsStore } = useUploadManager();
  const jobs = useSyncExternalStore(jobsStore.subscribe, () => jobsStore.getAllJobs());
  const { profile } = useAuth();
  const { infoToast, errorToast } = useToast();

  const [files, setFiles] = useState<FileRow[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [quota, setQuota] = useState<{ used: number; max: number | null } | null>(null);

  const refresh = useCallback(async () => {
    setFilesLoading(true);
    try {
      const [{ data: fileRows, error: filesErr }, { data: limits }, { data: billing }] = await Promise.all([
        supabase
          .from('filehub_files')
          .select('id, original_name, visibility, storage_path, bucket, size_bytes, task_id, folder_id, created_at')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase.rpc('rpc_my_plan_limits'),
        profile?.company_id
          ? supabase.from('company_billing').select('storage_used_bytes').eq('company_id', profile.company_id).maybeSingle()
          : Promise.resolve({ data: null } as any),
      ]);
      if (filesErr) throw filesErr;
      setFiles(fileRows || []);
      setQuota({ used: billing?.storage_used_bytes ?? 0, max: limits?.max_storage_bytes ?? null });
    } catch (e: any) {
      errorToast(e?.message || 'Could not load FileHub debug data.');
    } finally {
      setFilesLoading(false);
    }
  }, [profile?.company_id, errorToast]);

  useEffect(() => { refresh(); }, [refresh]);

  // Rows sharing a storage_path point at the same physical object — should
  // only count once toward quota. This is the client-side visualization of
  // that dedupe fix.
  const pathCounts = useMemo(() => {
    const m = new Map<string, number>();
    files.forEach(f => m.set(f.storage_path, (m.get(f.storage_path) ?? 0) + 1));
    return m;
  }, [files]);

  const handleSimulateDrop = () => {
    debugSimulateNetworkDrop();
    infoToast('Next upload will simulate a dropped connection.', 'Network drop armed');
  };

  const quotaPct = quota?.max ? Math.min(1, quota.used / quota.max) : 0;

  return (
    <View className="mb-6">
      <Text className="text-typography-main font-black text-sm mb-3">🛠 FileHub & Upload Debug</Text>

      {/* 1. Live upload job monitor */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-4 mb-3">
        <Text className="text-typography-main font-bold text-xs mb-2">Active Upload Jobs</Text>
        {jobs.length === 0 ? (
          <Text className="text-typography-muted text-xs">No active uploads</Text>
        ) : (
          <View className="gap-2">
            {jobs.map(job => (
              <View key={job.jobId} className="bg-surface-background rounded-lg border border-surface-border p-2.5">
                <View className="flex-row items-center justify-between">
                  <Text className="text-typography-main font-bold text-xs">{job.jobId.slice(0, 8)}</Text>
                  <Text className="text-typography-muted text-[10px] uppercase font-bold">{job.status}</Text>
                </View>
                <Text className="text-typography-muted text-[11px] mt-1">
                  {job.progress}% · {job.done}/{job.total} · {job.subtitle}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 2. Simulate network drop */}
      <TouchableOpacity
        onPress={handleSimulateDrop}
        className="rounded-xl border-2 border-amber-500 bg-amber-500/10 p-4 mb-3"
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text className="text-amber-600 font-bold">⚡ Simulate network drop on next upload</Text>
            <Text className="text-amber-600/70 text-xs mt-1">
              Tap this, then start any FileHub upload — it should show &quot;Connection lost — retrying…&quot; and recover automatically instead of failing.
            </Text>
          </View>
          <FontAwesome name="bolt" size={12} color="#d97706" />
        </View>
      </TouchableOpacity>

      {/* 3a. Storage quota gauge */}
      {quota && (
        <View className="bg-surface-card rounded-2xl border border-surface-border p-4 mb-3">
          <View className="flex-row items-end justify-between mb-1.5">
            <Text className="text-typography-muted text-[11px] font-bold uppercase tracking-widest">Storage Quota</Text>
            <Text className="text-typography-main text-xs font-black">
              {formatFileSize(quota.used)}{quota.max != null ? ` / ${formatFileSize(quota.max)}` : ' (unlimited)'}
            </Text>
          </View>
          {quota.max != null && (
            <View className="h-2 rounded-full bg-surface-background overflow-hidden">
              <View
                className={`h-full rounded-full ${quotaPct >= 1 ? 'bg-state-danger' : quotaPct >= 0.8 ? 'bg-state-warning' : 'bg-brand-primary'}`}
                style={{ width: `${Math.round(quotaPct * 100)}%` }}
              />
            </View>
          )}
        </View>
      )}

      {/* 3b. Raw files inspector */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-typography-main font-bold text-xs">Raw filehub_files (latest 50)</Text>
          <TouchableOpacity onPress={refresh} disabled={filesLoading} className="flex-row items-center gap-1.5">
            {filesLoading ? <ActivityIndicator size="small" color="#6366f1" /> : <FontAwesome name="refresh" size={11} color="#6366f1" />}
            <Text className="text-brand-primary text-[11px] font-bold">Refresh</Text>
          </TouchableOpacity>
        </View>
        {files.length === 0 && !filesLoading ? (
          <Text className="text-typography-muted text-xs">No files found</Text>
        ) : (
          <View className="gap-1.5">
            {files.map(f => {
              const sharedCount = (pathCounts.get(f.storage_path) ?? 1) - 1;
              return (
                <View key={f.id} className="bg-surface-background rounded-lg border border-surface-border p-2.5">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-typography-main font-bold text-xs flex-1 mr-2" numberOfLines={1}>{f.original_name}</Text>
                    <Text className="text-typography-muted text-[10px] uppercase font-bold">{f.visibility}</Text>
                  </View>
                  <Text className="text-typography-muted text-[11px] mt-0.5">
                    {formatFileSize(f.size_bytes)} · {new Date(f.created_at).toLocaleDateString()}
                  </Text>
                  {sharedCount > 0 && (
                    <Text className="text-amber-600 text-[10px] font-bold mt-1">
                      ⚠ shared with {sharedCount} other row{sharedCount === 1 ? '' : 's'} — counted once
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}
