import { FilePreviewModal, getPreviewKind, type PreviewKind } from '@/components/common/FilePreview';
import { FilePreviewGrid, type FileTile } from '@/components/common/FilePreviewCard';
import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { useToast } from '@/contexts/ToastContext';
import { EntityGlyph, type EntityKind } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatFileSize } from '@/lib/uploadHelpers';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

// Issue #174 (Projects Phase 4, plan §6 / §13.11). Surfaces the client's
// standing files (input, persists across years -- clients.standing_folder_id)
// alongside this project's sealed deliverable (output, one year --
// projects.deliverable_folder_id), per §6's split: never copies one into the
// other, both are read through rpc_project_files (which itself reuses
// rpc_filehub_folder_versions for the version list -- no new listing RPC).
//
// The deliverable folder is created LAZILY server-side on first harvest
// (fn_project_ensure_deliverable_folder, fired by the per-stage
// harvests_to_deliverable toggle) -- there is deliberately no "create
// deliverable folder" button here. The standing folder IS user-creatable on
// demand (rpc_client_ensure_standing_folder), since nothing else populates it.
//
// File upload/picking is explicitly out of scope here -- routes through
// contexts/UploadManagerContext.tsx when that's needed, never a new path.

type FileRow = {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number;
  bucket: string;
  storage_path: string;
  created_at: string;
};

type VersionRow = {
  batch_id: string;
  seq: number;
  created_at: string;
  files_touched: number;
  files_added: number;
  files_replaced: number;
  live_files: number;
  is_effective: boolean;
  actor: { id: string; full_name: string | null; avatar_url: string | null } | null;
};

type ProjectFilesData = {
  deliverable_folder_id: string | null;
  deliverable_files: FileRow[];
  deliverable_versions: VersionRow[];
  client_id: string | null;
  client_name: string | null;
  standing_folder_id: string | null;
  standing_files: FileRow[];
};

function toTile(file: FileRow, onPress: () => void): FileTile {
  return {
    key: file.id,
    fileName: file.name,
    mimeType: file.mime_type,
    subtitle: formatFileSize(file.size_bytes),
    sizeBytes: file.size_bytes,
    onPress,
  };
}

function FileSection({
  title,
  subtitle,
  kind,
  glyphName,
  files,
  emptyLabel,
  headerRight,
  below,
}: {
  title: string;
  /** Says what this pile of files IS — input vs output is the whole §6 split. */
  subtitle: string;
  kind: EntityKind;
  /** Monogram source for the client circle. Without it the glyph renders "?". */
  glyphName?: string | null;
  files: FileRow[];
  emptyLabel: string;
  headerRight?: React.ReactNode;
  below?: React.ReactNode;
}) {
  const colors = useThemeColors();
  const [preview, setPreview] = useState<{ uri: string; name: string; kind: PreviewKind; sizeBytes?: number } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const openFile = useCallback(async (file: FileRow) => {
    setOpening(file.id);
    const { data, error } = await supabase.storage.from(file.bucket).createSignedUrl(file.storage_path, 3600);
    setOpening(null);
    if (error || !data?.signedUrl) return;
    const kind = getPreviewKind(file.mime_type, file.name);
    if (kind) {
      setPreview({ uri: data.signedUrl, name: file.name, kind, sizeBytes: file.size_bytes });
    } else {
      // No inline viewer for this type (e.g. an image) -- hand it to the browser/OS.
      if (typeof window !== 'undefined') window.open(data.signedUrl, '_blank');
    }
  }, []);

  return (
    <View className="mb-7">
      <View className="flex-row items-start justify-between gap-3 mb-3">
        <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
          <EntityGlyph kind={kind} size={28} name={glyphName} />
          <View className="flex-1 min-w-0">
            <View className="flex-row items-center gap-2">
              <Text numberOfLines={1} className="text-typography-main text-sm font-bold flex-shrink">{title}</Text>
              <Text className="text-typography-muted text-xs">
                {files.length} file{files.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Text className="text-typography-muted text-[11px] mt-0.5">{subtitle}</Text>
          </View>
        </View>
        {headerRight}
      </View>

      {below}

      {files.length === 0 ? (
        <View className="bg-surface-card border border-surface-border rounded-xl py-6 px-5 items-center">
          <Text className="text-typography-muted text-xs text-center leading-5" style={{ maxWidth: 460 }}>{emptyLabel}</Text>
        </View>
      ) : (
        <FilePreviewGrid
          items={files.map((f) => toTile(f, () => openFile(f)))}
          minTileWidth={150}
        />
      )}

      {opening && (
        <View className="mt-2 flex-row items-center gap-2">
          <ActivityIndicator size="small" color={colors.textDim} />
          <Text className="text-typography-muted text-xs">Opening…</Text>
        </View>
      )}

      {preview && (
        <FilePreviewModal
          visible
          uri={preview.uri}
          fileName={preview.name}
          kind={preview.kind}
          sizeBytes={preview.sizeBytes}
          onClose={() => setPreview(null)}
        />
      )}
    </View>
  );
}

function VersionHistory({ versions }: { versions: VersionRow[] }) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  if (versions.length === 0) return null;

  return (
    <View className="mb-3">
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        className="flex-row items-center gap-1.5 py-1"
        style={{ minHeight: 44 }}
      >
        <FontAwesome name={expanded ? 'chevron-down' : 'chevron-right'} size={9} color={colors.textDim} />
        <Text className="text-typography-dim text-xs font-semibold">
          {versions.length === 1 ? '1 sealed version' : `${versions.length} sealed versions`}
        </Text>
      </TouchableOpacity>

      {expanded && (
        <View className="ml-4 border-l border-surface-border pl-3 gap-2 mt-1">
          {versions.map((v) => (
            <View key={v.batch_id} className="flex-row items-center gap-2">
              <View
                className="rounded-full px-2 py-0.5"
                style={{ backgroundColor: v.is_effective ? colors.success + '22' : colors.card }}
              >
                <Text className="text-[10px] font-black" style={{ color: v.is_effective ? colors.success : colors.textMuted }}>
                  v{v.seq}
                </Text>
              </View>
              <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
                {v.actor?.full_name || 'Someone'} · {new Date(v.created_at).toLocaleDateString()} ·{' '}
                {v.files_added} added{v.files_replaced ? `, ${v.files_replaced} replaced` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function ProjectFilesTab() {
  const { projectId } = useProjectDetail();
  const colors = useThemeColors();
  const { errorToast, successToast } = useToast();
  const [data, setData] = useState<ProjectFilesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingStanding, setCreatingStanding] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    const { data: res, error } = await supabase.rpc('rpc_project_files', { p_project_id: projectId });
    if (!error && res) setData(res as ProjectFilesData);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const createStandingFolder = useCallback(async () => {
    if (!data?.client_id) return;
    setCreatingStanding(true);
    const { error } = await supabase.rpc('rpc_client_ensure_standing_folder', { p_client_id: data.client_id });
    setCreatingStanding(false);
    if (error) {
      errorToast(error.message || 'Could not create the standing folder.');
      return;
    }
    successToast('Standing folder created.');
    fetchFiles();
  }, [data?.client_id, errorToast, successToast, fetchFiles]);

  if (loading && !data) {
    return (
      <View className="flex-1 items-center justify-center py-24">
        <ActivityIndicator color={colors.textDim} />
      </View>
    );
  }

  if (!data) {
    return (
      <View className="flex-1 items-center justify-center py-24 px-8">
        <Text className="text-typography-main text-sm font-bold">Files couldn’t load</Text>
        <Text className="text-typography-muted text-xs text-center mt-1.5 leading-5" style={{ maxWidth: 380 }}>
          Reload the page. If it keeps happening, the project may have been archived while you were looking at it.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 p-4 md:p-8">
      {/* Client standing files -- input, persists across years */}
      <FileSection
        title={data.client_name ? `${data.client_name} — standing files` : 'Client standing files'}
        subtitle="What the client gave you. Stays put year after year, shared by every project for them."
        kind="client"
        glyphName={data.client_name}
        files={data.standing_files}
        emptyLabel={
          !data.client_id
            ? 'No client is attached to this project, so there is nowhere to keep standing files. Attach a client from Edit project.'
            : data.standing_folder_id
              ? 'The folder exists but is empty. Add the client’s reference material in FileHub and it shows up here.'
              : 'This client has no standing folder yet. Create one and anything you put in it stays available to every future project for them.'
        }
        headerRight={
          data.client_id && !data.standing_folder_id ? (
            <TouchableOpacity
              onPress={createStandingFolder}
              disabled={creatingStanding}
              className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-primary/10"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              {creatingStanding ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <FontAwesome name="plus" size={10} color={colors.primary} />
              )}
              <Text className="text-brand-primary text-xs font-bold">Create folder</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* Project deliverable -- output, sealed per-year via the harvest toggle */}
      <FileSection
        title="Sealed deliverable"
        subtitle="What this project produced. Sealed automatically, one version per round — never edited in place."
        kind="project"
        files={data.deliverable_files}
        below={<VersionHistory versions={data.deliverable_versions} />}
        emptyLabel={
          data.deliverable_folder_id
            ? 'Nothing has been sealed yet. Output lands here the first time a task reaches a stage set to promote its files.'
            : 'No deliverable yet. Files arrive here on their own when a task moves into a stage configured to promote its output — that switch lives in the board’s stage settings.'
        }
      />
    </View>
  );
}
