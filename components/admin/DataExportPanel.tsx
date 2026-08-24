import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { saveBytes } from '@/lib/fileTransfer';
import { buildExportRows, fetchExportTasks, TASK_COLUMNS, type SpreadsheetFormat } from '@/lib/taskMobility';
import {
  buildProjectExportRows,
  buildTimeTrackingExportRows,
  sheetsToWorkbookBytes,
  PROJECT_COLUMNS,
  TIME_TRACKING_COLUMNS,
  type ExportProject,
  type ExportTimeSession,
} from '@/lib/companyExport';

type EntityKey = 'tasks' | 'projects' | 'sessions';

const MIME: Record<SpreadsheetFormat, string> = {
  csv: 'text/csv;charset=utf-8;',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function fetchExportProjects(): Promise<ExportProject[]> {
  const [projsRes, pipesRes] = await Promise.all([
    supabase
      .from('projects')
      .select('name, description, status, pipeline_id, created_at, expiry_date, is_featured')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('pipelines').select('id, name'),
  ]);
  if (projsRes.error) throw projsRes.error;

  const pipeName = new Map((pipesRes.data || []).map((p: any) => [p.id, p.name]));
  return (projsRes.data || []).map((p: any) => ({
    name: p.name,
    description: p.description,
    status: p.status,
    pipelineName: p.pipeline_id ? pipeName.get(p.pipeline_id) ?? null : null,
    created_at: p.created_at,
    expiry_date: p.expiry_date,
    is_featured: p.is_featured,
  }));
}

async function fetchExportSessions(): Promise<ExportTimeSession[]> {
  const [sessRes, tasksRes, usersRes, stagesRes] = await Promise.all([
    supabase
      .from('task_work_sessions')
      .select('task_id, user_id, stage_id, started_at, completed_at, total_seconds_spent, status, notes')
      .order('started_at', { ascending: false }),
    supabase.from('tasks').select('id, title'),
    supabase.from('users').select('id, email'),
    supabase.from('stages').select('id, name'),
  ]);
  if (sessRes.error) throw sessRes.error;

  const taskTitle = new Map((tasksRes.data || []).map((t: any) => [t.id, t.title]));
  const userEmail = new Map((usersRes.data || []).map((u: any) => [u.id, u.email]));
  const stageName = new Map((stagesRes.data || []).map((s: any) => [s.id, s.name]));

  return (sessRes.data || []).map((s: any) => ({
    taskTitle: s.task_id ? taskTitle.get(s.task_id) ?? null : null,
    userEmail: s.user_id ? userEmail.get(s.user_id) ?? null : null,
    stageName: s.stage_id ? stageName.get(s.stage_id) ?? null : null,
    started_at: s.started_at,
    completed_at: s.completed_at,
    total_seconds_spent: s.total_seconds_spent,
    status: s.status,
    notes: s.notes,
  }));
}

const stamp = () => new Date().toISOString().slice(0, 10);

const ENTITY_CONFIG: Record<EntityKey, { label: string; icon: keyof typeof FontAwesome.glyphMap; hint: string; columns: readonly string[] }> = {
  tasks: { label: 'Tasks', icon: 'tasks', hint: 'Title, priority, pipeline, assignees, dates.', columns: TASK_COLUMNS },
  projects: { label: 'Projects', icon: 'folder-open-o', hint: 'Name, status, pipeline, dates.', columns: PROJECT_COLUMNS },
  sessions: { label: 'Time Tracking', icon: 'clock-o', hint: 'Work sessions — who, what, when, how long.', columns: TIME_TRACKING_COLUMNS },
};

const buildRowsForEntity = async (key: EntityKey): Promise<Record<string, any>[]> => {
  if (key === 'tasks') return buildExportRows(await fetchExportTasks());
  if (key === 'projects') return buildProjectExportRows(await fetchExportProjects());
  return buildTimeTrackingExportRows(await fetchExportSessions());
};

export default function DataExportPanel() {
  const colors = useThemeColors();
  const { profile, hasPermission } = useAuth();
  const { successToast, errorToast, infoToast } = useToast();
  const { width } = useWindowDimensions();
  const isWide = Platform.OS === 'web' && width >= 1024;

  const canManage = !!profile?.is_owner || hasPermission('company.settings') || hasPermission('data.export');

  const [format, setFormat] = useState<SpreadsheetFormat>('xlsx');
  const [loadingCounts, setLoadingCounts] = useState(true);
  const [counts, setCounts] = useState({ tasks: 0, projects: 0, sessions: 0 });
  const [busyKey, setBusyKey] = useState<EntityKey | 'all' | null>(null);
  const [lastExport, setLastExport] = useState<{ key: EntityKey | 'all'; rows: number; format: SpreadsheetFormat } | null>(null);

  const loadCounts = useCallback(async () => {
    setLoadingCounts(true);
    try {
      const [t, p, s] = await Promise.all([
        supabase.from('tasks').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('projects').select('id', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('task_work_sessions').select('id', { count: 'exact', head: true }),
      ]);
      setCounts({ tasks: t.count ?? 0, projects: p.count ?? 0, sessions: s.count ?? 0 });
    } catch (e: any) {
      errorToast(e?.message || 'Could not load export counts.');
    } finally {
      setLoadingCounts(false);
    }
  }, [errorToast]);

  useEffect(() => {
    if (canManage) loadCounts();
    else setLoadingCounts(false);
  }, [canManage, loadCounts]);

  if (!canManage) {
    return (
      <View className="flex-1 items-center justify-center p-10">
        <FontAwesome name="lock" size={48} color={colors.textMuted} />
        <Text className="text-typography-main text-xl font-black mt-4">Export Restricted</Text>
        <Text className="text-typography-muted text-sm text-center mt-2 max-w-xs leading-5">
          Only workspace admins and users with the Data Export permission can download company data.
        </Text>
      </View>
    );
  }

  const handleExportEntity = async (key: EntityKey) => {
    const cfg = ENTITY_CONFIG[key];
    setBusyKey(key);
    try {
      const rows = await buildRowsForEntity(key);

      if (rows.length === 0) {
        infoToast(`No ${cfg.label.toLowerCase()} to export.`);
        return;
      }

      const bytes = await sheetsToWorkbookBytes([{ name: cfg.label, rows, columns: cfg.columns }], format);
      const saved = await saveBytes(`${key}_export_${stamp()}.${format}`, bytes, MIME[format]);
      if (saved) {
        setLastExport({ key, rows: rows.length, format });
        successToast(
          Platform.OS === 'web'
            ? `Exported ${rows.length} ${cfg.label.toLowerCase()} (${format.toUpperCase()}).`
            : `Exported ${rows.length} ${cfg.label.toLowerCase()} to ${saved}`,
          'Export complete'
        );
      } else {
        errorToast('Could not save the export file.');
      }
    } catch (e: any) {
      console.error('[DataExport] entity export failed', e);
      errorToast(e?.message || 'Export failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleExportAll = async () => {
    setBusyKey('all');
    try {
      const [tasks, projects, sessions] = await Promise.all([
        fetchExportTasks(),
        fetchExportProjects(),
        fetchExportSessions(),
      ]);
      const bytes = await sheetsToWorkbookBytes(
        [
          { name: 'Tasks', rows: buildExportRows(tasks), columns: TASK_COLUMNS },
          { name: 'Projects', rows: buildProjectExportRows(projects), columns: PROJECT_COLUMNS },
          { name: 'Time Tracking', rows: buildTimeTrackingExportRows(sessions), columns: TIME_TRACKING_COLUMNS },
        ],
        'xlsx'
      );
      const saved = await saveBytes(`company_export_${stamp()}.xlsx`, bytes, MIME.xlsx);
      if (saved) {
        const totalRows = tasks.length + projects.length + sessions.length;
        setLastExport({ key: 'all', rows: totalRows, format: 'xlsx' });
        successToast(Platform.OS === 'web' ? `Exported all company data (${totalRows} rows, XLSX).` : `Exported all company data to ${saved}`, 'Export complete');
      } else {
        errorToast('Could not save the export file.');
      }
    } catch (e: any) {
      console.error('[DataExport] export all failed', e);
      errorToast(e?.message || 'Export failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const totalCount = counts.tasks + counts.projects + counts.sessions;
  const hasData = totalCount > 0;

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
        {/* Header */}
        {!isWide && (
          <View className="mb-6 px-1">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.25em] mb-1">Data Portability</Text>
            <Text className="text-typography-main text-2xl font-black tracking-tight">Export Company Data</Text>
            <Text className="text-typography-muted text-xs mt-2 leading-5 max-w-xl">
              Download a clean copy of everything in your workspace — for backups, reporting, or moving to another tool.
            </Text>
          </View>
        )}

        {/* Format toggle */}
        <View className="flex-row gap-2 mb-5">
          {(['xlsx', 'csv'] as SpreadsheetFormat[]).map(f => {
            const active = format === f;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setFormat(f)}
                disabled={busyKey !== null}
                className={`flex-1 py-3 rounded-xl border items-center ${active ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-card'}`}
              >
                <Text className={`font-black text-xs uppercase tracking-widest ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>
                  {f === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Entity cards — grid on desktop, stacked on mobile */}
        <View className={isWide ? 'flex-row flex-wrap gap-3 mb-5' : 'gap-3 mb-5'}>
          {(Object.keys(ENTITY_CONFIG) as EntityKey[]).map(key => {
            const cfg = ENTITY_CONFIG[key];
            const count = counts[key];
            const isBusy = busyKey === key;
            const isLoading = loadingCounts;

            return (
              <View
                key={key}
                className={`bg-surface-card border border-surface-border rounded-2xl p-5 ${isWide ? 'w-[32%] flex-col items-stretch' : 'flex-row items-center'}`}
              >
                <View className="w-11 h-11 rounded-xl bg-brand-primary/10 items-center justify-center mb-3">
                  <FontAwesome name={cfg.icon} size={18} color={colors.primary} />
                </View>
                <View className="flex-1 mb-3">
                  <View className="flex-row items-center gap-2 mb-1">
                    <Text className="text-typography-main font-black text-base">{cfg.label}</Text>
                    <Text className="text-typography-muted text-[11px] font-bold">{isLoading ? '…' : count}</Text>
                  </View>
                  <Text className="text-typography-muted text-[11px] leading-5" numberOfLines={2}>{cfg.hint}</Text>
                </View>
                {!isWide && (
                  <View className="w-full mt-2">
                    <TouchableOpacity
                      onPress={() => handleExportEntity(key)}
                      disabled={busyKey !== null || isLoading || count === 0}
                      className="w-full py-3 rounded-xl bg-brand-primary items-center justify-center gap-2 flex-row"
                      style={{ opacity: (busyKey !== null || isLoading || count === 0) ? 0.5 : 1 }}
                    >
                      {isBusy ? <ActivityIndicator color="#fff" size="small" /> : <FontAwesome name="download" size={14} color="#fff" />}
                      <Text className="text-white font-black text-[11px] uppercase tracking-widest">Export {cfg.label}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {isWide && (
                  <TouchableOpacity
                    onPress={() => handleExportEntity(key)}
                    disabled={busyKey !== null || isLoading || count === 0}
                    className="mt-auto py-3 rounded-xl bg-brand-primary items-center justify-center gap-2 flex-row"
                    style={{ opacity: (busyKey !== null || isLoading || count === 0) ? 0.5 : 1 }}
                  >
                    {isBusy ? <ActivityIndicator color="#fff" size="small" /> : <FontAwesome name="download" size={14} color="#fff" />}
                    <Text className="text-white font-black text-[10px] uppercase tracking-widest">Export</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>

        {/* Export everything as one workbook — primary action */}
        <View className={`bg-surface-card border border-surface-border rounded-2xl p-5 mb-5 ${isWide ? 'max-w-2xl' : ''}`}>
          <View className="flex-row items-center justify-between mb-3">
            <View>
              <Text className="text-brand-primary text-[10px] font-black uppercase mb-1 tracking-widest">Primary Action</Text>
              <Text className="text-typography-main text-lg font-black">Export All Data</Text>
            </View>
            <View className="px-3 py-1 rounded-full bg-brand-primary/10 border border-brand-primary/30">
              <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">XLSX Only</Text>
            </View>
          </View>
          <Text className="text-typography-muted text-xs leading-5 mb-4">
            Bundle Tasks ({counts.tasks}), Projects ({counts.projects}), and Time Tracking ({counts.sessions}) into a single Excel workbook with one sheet per entity.
          </Text>
          {!hasData ? (
            <Text className="text-typography-muted text-sm text-center py-2">
              No data to export — all entity counts are zero.
            </Text>
          ) : (
            <TouchableOpacity
              onPress={handleExportAll}
              disabled={busyKey !== null || loadingCounts}
              className="w-full py-4 rounded-xl bg-brand-primary items-center justify-center gap-2 flex-row"
              style={{ opacity: (busyKey !== null || loadingCounts) ? 0.5 : 1 }}
            >
              {busyKey === 'all' ? <ActivityIndicator color="#fff" /> : <FontAwesome name="download" size={16} color="#fff" />}
              <Text className="text-white font-black text-[11px] uppercase tracking-widest">Export All ({totalCount} rows, .xlsx)</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Last export confirmation */}
        {lastExport && (
          <View className={`bg-state-success/10 border border-state-success/30 rounded-2xl p-4 ${isWide ? 'max-w-2xl' : ''}`}>
            <View className="flex-row items-center gap-3">
              <FontAwesome name="check-circle" size={18} color={colors.success} />
              <View className="flex-1">
                <Text className="text-state-success font-black text-sm">
                  {lastExport.key === 'all' ? 'All data exported' : `${lastExport.rows} ${ENTITY_CONFIG[lastExport.key as EntityKey].label.toLowerCase()} exported`}
                </Text>
                <Text className="text-typography-muted text-[11px]">
                  Format: {lastExport.format.toUpperCase()} · {new Date().toLocaleTimeString()}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setLastExport(null)}
                className="p-1"
              >
                <FontAwesome name="times" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Empty state */}
        {!hasData && !loadingCounts && !lastExport && (
          <View className={`bg-surface-background border border-surface-border rounded-2xl p-8 items-center ${isWide ? 'max-w-2xl' : ''}`}>
            <FontAwesome name="inbox" size={32} color={colors.textMuted} />
            <Text className="text-typography-main font-black text-base mt-3">No data to export</Text>
            <Text className="text-typography-muted text-xs mt-1 text-center max-w-xs leading-5">
              Your workspace doesn't have any tasks, projects, or time tracking sessions yet.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}