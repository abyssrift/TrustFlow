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
        <FontAwesome name="lock" size={40} color={colors.textMuted} />
        <Text className="text-typography-main text-lg font-black mt-4">Restricted</Text>
        <Text className="text-typography-muted text-sm text-center mt-2">Only workspace admins can export company data.</Text>
      </View>
    );
  }

  const handleExportEntity = async (key: EntityKey, label: string) => {
    setBusyKey(key);
    try {
      let rows: Record<string, any>[];
      let columns: readonly string[];
      if (key === 'tasks') {
        rows = buildExportRows(await fetchExportTasks());
        columns = TASK_COLUMNS;
      } else if (key === 'projects') {
        rows = buildProjectExportRows(await fetchExportProjects());
        columns = PROJECT_COLUMNS;
      } else {
        rows = buildTimeTrackingExportRows(await fetchExportSessions());
        columns = TIME_TRACKING_COLUMNS;
      }

      if (rows.length === 0) {
        infoToast(`No ${label.toLowerCase()} to export.`);
        return;
      }

      const bytes = await sheetsToWorkbookBytes([{ name: label, rows, columns }], format);
      const saved = await saveBytes(`${key}_export_${stamp()}.${format}`, bytes, MIME[format]);
      if (saved) {
        successToast(
          Platform.OS === 'web' ? `Exported ${rows.length} ${label.toLowerCase()}.` : `Exported ${rows.length} ${label.toLowerCase()} to ${saved}`,
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
      const [tasks, projects, sessions] = await Promise.all([fetchExportTasks(), fetchExportProjects(), fetchExportSessions()]);
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
        successToast(Platform.OS === 'web' ? 'Exported all company data.' : `Exported all company data to ${saved}`, 'Export complete');
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

  const entities: { key: EntityKey; label: string; icon: keyof typeof FontAwesome.glyphMap; count: number; hint: string }[] = [
    { key: 'tasks', label: 'Tasks', icon: 'tasks', count: counts.tasks, hint: 'Title, priority, pipeline, assignees, dates.' },
    { key: 'projects', label: 'Projects', icon: 'folder-open-o', count: counts.projects, hint: 'Name, status, pipeline, dates.' },
    { key: 'sessions', label: 'Time Tracking', icon: 'clock-o', count: counts.sessions, hint: 'Work sessions — who, what, when, how long.' },
  ];

  return (
    <View className="flex-1">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 48 }}>
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

        {/* Entity cards */}
        <View className={isWide ? 'flex-row flex-wrap gap-3 mb-5' : 'gap-3 mb-5'}>
          {entities.map(e => (
            <View key={e.key} className={`bg-surface-card border border-surface-border rounded-2xl p-5 flex-row items-center ${isWide ? 'w-[32%]' : ''}`}>
              <View className="w-11 h-11 rounded-xl bg-brand-primary/10 items-center justify-center mr-4">
                <FontAwesome name={e.icon} size={16} color={colors.primary} />
              </View>
              <View className="flex-1 mr-3">
                <View className="flex-row items-center gap-2">
                  <Text className="text-typography-main font-black text-sm">{e.label}</Text>
                  <Text className="text-typography-muted text-[11px] font-bold">{loadingCounts ? '…' : e.count}</Text>
                </View>
                <Text className="text-typography-muted text-[11px] mt-0.5" numberOfLines={1}>{e.hint}</Text>
              </View>
              <TouchableOpacity
                onPress={() => handleExportEntity(e.key, e.label)}
                disabled={busyKey !== null || loadingCounts}
                className="px-4 py-2.5 rounded-xl bg-brand-primary flex-row items-center gap-2"
              >
                {busyKey === e.key ? <ActivityIndicator color="#fff" size="small" /> : <FontAwesome name="download" size={12} color="#fff" />}
                <Text className="text-white font-black text-[10px] uppercase tracking-widest">Export</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Export everything as one workbook */}
        <View className={`bg-surface-card border border-surface-border rounded-2xl p-5 ${isWide ? 'max-w-2xl' : ''}`}>
          <Text className="text-brand-primary text-[10px] font-black uppercase mb-2 tracking-widest">Everything, one file</Text>
          <Text className="text-typography-muted text-xs leading-5 mb-4">
            Bundle Tasks, Projects, and Time Tracking into a single Excel workbook with one sheet per entity.
          </Text>
          <TouchableOpacity
            onPress={handleExportAll}
            disabled={busyKey !== null || loadingCounts}
            className="bg-brand-primary py-4 rounded-xl items-center flex-row justify-center gap-2"
          >
            {busyKey === 'all' ? <ActivityIndicator color="#fff" /> : <FontAwesome name="download" size={14} color="#fff" />}
            <Text className="text-white font-black text-[11px] uppercase tracking-widest">Export All (.xlsx)</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
