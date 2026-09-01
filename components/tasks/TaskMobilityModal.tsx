import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Platform, TextInput } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { saveBytes, pickSpreadsheet } from '@/lib/fileTransfer';
import {
  buildExportRows,
  fetchExportTasks,
  rowsToBytes,
  bytesToRows,
  buildTemplateBytes,
  parseImportRows,
  type SpreadsheetFormat,
  type ImportLookups,
  type ParsedTaskRow,
} from '@/lib/taskMobility';
import { isJiraExport, mapJiraRow } from '@/lib/jiraImport';
import {
  listImporters, startOAuthFlow, connectViaProxy, guessStageMapping, getConnection,
  readConnectionMeta, listConnections, getLastUsedImport, setLastUsedImport,
} from '@/lib/imports';
import type { ImporterAdapter, ImportedTask, AuthPayload, ConnectionMeta, StoredConnection } from '@/lib/imports';
import { formatRelative } from '@/lib/time';

type Props = {
  visible: boolean;
  onClose: () => void;
  onImported?: () => void;
  // The board this modal was opened from — imported tasks land here.
  pipelineId?: string;
};

type Tab = 'export' | 'import';
type ImportStep = 'picker' | 'auth' | 'source' | 'preview';

// Connector-sourced steps only — the picker and the file-upload path don't
// have a linear connect/select/review progression worth numbering.
const CONNECTOR_STEP_LABELS: Record<'auth' | 'source' | 'preview', string> = {
  auth: 'Step 1 of 3 · Connect',
  source: 'Step 2 of 3 · Select project',
  preview: 'Step 3 of 3 · Review',
};

const MIME: Record<SpreadsheetFormat, string> = {
  csv: 'text/csv;charset=utf-8;',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export default function TaskMobilityModal({ visible, onClose, onImported, pipelineId }: Props) {
  const colors = useThemeColors();
  const { hasPermission, user } = useAuth();
  const { successToast, errorToast, infoToast } = useToast();

  const canImport = hasPermission('task.create') || hasPermission('tasks.create');

  const [tab, setTab] = useState<Tab>('export');
  const [format, setFormat] = useState<SpreadsheetFormat>('xlsx');
  const [busy, setBusy] = useState(false);

  const [importStep, setImportStep] = useState<ImportStep>('picker');
  const [selectedAdapter, setSelectedAdapter] = useState<ImporterAdapter | null>(null);
  const [connectorFields, setConnectorFields] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [importedTasks, setImportedTasks] = useState<ImportedTask[] | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [connectionMeta, setConnectionMeta] = useState<ConnectionMeta | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [recentConnections, setRecentConnections] = useState<StoredConnection[]>([]);

  // Existing file import state
  const [parsed, setParsed] = useState<ParsedTaskRow[] | null>(null);
  const [parsedFileName, setParsedFileName] = useState<string>('');
  const [skipped, setSkipped] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [detectedJira, setDetectedJira] = useState(false);

  const resetAll = () => {
    setImportStep('picker');
    setSelectedAdapter(null);
    setConnectorFields({});
    setProjects([]);
    setSelectedProjectId(null);
    setImportedTasks(null);
    setParsed(null);
    setParsedFileName('');
    setSkipped(0);
    setProgress(null);
    setDetectedJira(false);
    setConnectionMeta(null);
    setReconnecting(false);
  };

  // Closing (including an accidental dismiss) does NOT clear in-progress work —
  // only a completed import or an explicit "Start over" does. Reopening the
  // modal picks up exactly where it was left.
  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  // Powers the picker step's "Recently imported from" quick-launch list.
  useEffect(() => {
    if (!visible || tab !== 'import' || importStep !== 'picker') return;
    let cancelled = false;
    listConnections().then(conns => { if (!cancelled) setRecentConnections(conns); }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, tab, importStep]);

  // ── Export ──
  const handleExport = async () => {
    setBusy(true);
    try {
      const tasks = await fetchExportTasks();
      if (tasks.length === 0) { infoToast('No tasks to export.'); return; }
      const bytes = await rowsToBytes(buildExportRows(tasks), format);
      const stamp = new Date().toISOString().slice(0, 10);
      const saved = await saveBytes(`tasks_export_${stamp}.${format}`, bytes, MIME[format]);
      if (saved) successToast(Platform.OS === 'web' ? `Exported ${tasks.length} tasks.` : `Exported ${tasks.length} tasks to ${saved}`, 'Export complete');
      else errorToast('Could not save the export file.');
    } catch (e: any) { errorToast(e?.message || 'Export failed.'); }
    finally { setBusy(false); }
  };

  const handleTemplate = async () => {
    setBusy(true);
    try {
      const bytes = await buildTemplateBytes(format);
      const saved = await saveBytes(`task_import_template.${format}`, bytes, MIME[format]);
      if (saved) infoToast(Platform.OS === 'web' ? 'Template downloaded.' : `Template saved to ${saved}`);
    } catch (e: any) { errorToast(e?.message || 'Could not create template.'); }
    finally { setBusy(false); }
  };

  // Only instanceUrl/db/username are ever safe to remember locally — never the
  // password-type field (the API key / token).
  const sanitizeConnectorFields = (adapter: ImporterAdapter, fields: Record<string, string>) => {
    const secretKeys = new Set((adapter.manifest.authFields || []).filter(f => f.type === 'password').map(f => f.key));
    return Object.fromEntries(Object.entries(fields).filter(([k, v]) => v && !secretKeys.has(k)));
  };

  // ── Platform picker ──
  const handleSelectPlatform = async (adapter: ImporterAdapter) => {
    setSelectedAdapter(adapter);
    setConnectorFields({});
    setProjects([]);
    setSelectedProjectId(null);
    setImportedTasks(null);
    setParsed(null);
    setConnectionMeta(null);
    setReconnecting(false);

    if (adapter.manifest.authType === 'file') {
      handlePick();
      return;
    }

    const providerId = adapter.manifest.providerId || adapter.manifest.id;
    const lastUsed = await getLastUsedImport(providerId);

    if (!adapter.fetchProjects) {
      if (lastUsed?.connectorFields) setConnectorFields(lastUsed.connectorFields);
      setImportStep('auth');
      return;
    }

    // Already connected? Creds are stored server-side, so skip the form and go
    // straight to project selection. (Back on the source step re-opens the form,
    // now showing a "Connected ✓" state instead of a blank one.)
    setBusy(true);
    try {
      const conn = await getConnection(providerId);
      if (!conn) {
        if (lastUsed?.connectorFields) setConnectorFields(lastUsed.connectorFields);
        setImportStep('auth');
        return;
      }
      const meta = await readConnectionMeta(providerId);
      setConnectionMeta(meta);
      setConnectorFields(prefillFromMeta(meta));
      setSourcesLoading(true);
      setImportStep('source');
      const projs = await adapter.fetchProjects({ provider: providerId, instanceUrl: conn.instance_url || undefined });
      setProjects(projs);
      // Re-highlight the previously-imported source, if it's still there.
      if (lastUsed?.projectId && projs.some((p: any) => (p.id || p.key) === lastUsed.projectId)) {
        setSelectedProjectId(lastUsed.projectId);
      }
    } catch (e: any) {
      errorToast(e?.message || 'Failed to load projects.');
      setImportStep('auth');
    } finally {
      setBusy(false);
      setSourcesLoading(false);
    }
  };

  const prefillFromMeta = (meta: ConnectionMeta): Record<string, string> => {
    const fields: Record<string, string> = {};
    if (meta.instanceUrl) fields.instanceUrl = meta.instanceUrl;
    if (meta.db) fields.db = meta.db;
    if (meta.username) fields.username = meta.username;
    return fields;
  };

  // ── Auth / Connect ──
  const handleOAuthConnect = async () => {
    if (!user?.id || !selectedAdapter?.manifest.providerId) return;
    setBusy(true);
    try {
      await startOAuthFlow(selectedAdapter.manifest.providerId, user.id);
      successToast('Connected! Now select a project to import.', 'Connected');
      setReconnecting(false);
      await loadProjects();
    } catch (e: any) { errorToast(e?.message || 'Connection failed.'); }
    finally { setBusy(false); }
  };

  const handleApiKeyConnect = async () => {
    if (!selectedAdapter) return;
    setBusy(true);
    try {
      const auth = buildAuthPayload();
      // Persist the credentials (encrypted, server-side) before fetching.
      await connectViaProxy(auth!.provider, {
        instanceUrl: auth!.instanceUrl,
        db: auth!.db,
        username: auth!.username,
        apiKey: auth!.apiKey,
      });
      const providerId = selectedAdapter.manifest.providerId || selectedAdapter.manifest.id;
      await setLastUsedImport(providerId, { connectorFields: sanitizeConnectorFields(selectedAdapter, connectorFields) });
      setReconnecting(false);
      await loadProjects(auth);
      successToast('Connected! Now select a project to import.', 'Connected');
    } catch (e: any) { errorToast(e?.message || 'Connection failed.'); }
    finally { setBusy(false); }
  };

  const buildAuthPayload = (): AuthPayload | undefined => {
    if (!selectedAdapter) return undefined;
    return {
      provider: selectedAdapter.manifest.providerId || selectedAdapter.manifest.id,
      instanceUrl: connectorFields.instanceUrl,
      db: connectorFields.db,
      username: connectorFields.username,
      apiKey: connectorFields.apiKey,
    };
  };

  const loadProjects = async (auth?: AuthPayload) => {
    if (!selectedAdapter?.fetchProjects) return;
    setSourcesLoading(true);
    try {
      const authPayload = auth || buildAuthPayload();
      const projs = await selectedAdapter.fetchProjects(authPayload!);
      setProjects(projs);
      setImportStep('source');
    } catch (e: any) { errorToast(e?.message || 'Failed to load projects.'); }
    finally { setSourcesLoading(false); }
  };

  // ── Source (project/board) picker ──
  const handleSelectProject = async (projectId: string, projectName?: string) => {
    if (!selectedAdapter?.fetchTasks) return;
    setSelectedProjectId(projectId);
    setBusy(true);
    try {
      const auth = buildAuthPayload();
      const tasks = await selectedAdapter.fetchTasks(auth!, projectId);
      const mapped = selectedAdapter.mapToCanonical(tasks);
      setImportedTasks(mapped);
      setImportStep('preview');
      const providerId = selectedAdapter.manifest.providerId || selectedAdapter.manifest.id;
      await setLastUsedImport(providerId, {
        connectorFields: sanitizeConnectorFields(selectedAdapter, connectorFields),
        projectId,
        projectName: projectName ?? null,
      });
    } catch (e: any) { errorToast(e?.message || 'Failed to fetch tasks.'); }
    finally { setBusy(false); }
  };

  // ── File import (existing, adapted) ──
  const handlePick = async () => {
    setBusy(true);
    try {
      const file = await pickSpreadsheet();
      if (!file) return;

      const rawRows = await bytesToRows(file.bytes);
      if (rawRows.length === 0) { errorToast('That file has no readable rows.'); return; }

      const fromJira = isJiraExport(rawRows);
      const sourceRows = fromJira ? rawRows.map(mapJiraRow) : rawRows;

      const [pipesRes, projsRes, usersRes] = await Promise.all([
        supabase.from('pipelines').select('id, name, is_default').is('deleted_at', null),
        supabase.from('projects').select('id, name'),
        supabase.from('users').select('id, email, full_name, display_name').is('deleted_at', null),
      ]);

      const pipelinesByName = new Map<string, string>();
      let defaultPipelineId: string | null = null;
      (pipesRes.data || []).forEach((p: any) => {
        pipelinesByName.set(String(p.name).toLowerCase(), p.id);
        if (p.is_default && !defaultPipelineId) defaultPipelineId = p.id;
      });
      if (!defaultPipelineId && pipesRes.data?.[0]) defaultPipelineId = pipesRes.data[0].id;

      const usersByName = new Map<string, string>();
      (usersRes.data || []).forEach((u: any) => {
        if (u.full_name) usersByName.set(String(u.full_name).toLowerCase(), u.id);
        if (u.display_name) usersByName.set(String(u.display_name).toLowerCase(), u.id);
      });

      const lookups: ImportLookups = {
        pipelinesByName,
        projectsByName: new Map((projsRes.data || []).map((p: any) => [String(p.name).toLowerCase(), p.id])),
        usersByEmail: new Map((usersRes.data || []).map((u: any) => [String(u.email).toLowerCase(), u.id])),
        usersByName,
        defaultPipelineId,
      };

      const { rows, skipped: sk } = parseImportRows(sourceRows, lookups);
      if (rows.length === 0) { errorToast('No rows with a Title were found.'); return; }

      setParsed(rows);
      setParsedFileName(file.name);
      setSkipped(sk);
      setDetectedJira(fromJira);
      setImportStep('preview');
    } catch (e: any) { errorToast(e?.message || 'Could not read that file.'); }
    finally { setBusy(false); }
  };

  const handleConfirmImport = async () => {
    let rows = parsed;
    // targetStageId per row (API path only); file rows land in the initial stage.
    let stageForRow: (string | null)[] = [];

    if (!rows && importedTasks) {
      // API-sourced tasks arrive as emails/names + source stage names — resolve
      // both against this company before creating, so assignees and status stick.
      const [usersRes, pipesRes] = await Promise.all([
        supabase.from('users').select('id, email, full_name, display_name').is('deleted_at', null),
        supabase.from('pipelines').select('id, is_default').is('deleted_at', null).order('created_at'),
      ]);
      const byEmail = new Map<string, string>();
      const byName = new Map<string, string>();
      (usersRes.data || []).forEach((u: any) => {
        if (u.email) byEmail.set(String(u.email).toLowerCase(), u.id);
        if (u.full_name) byName.set(String(u.full_name).toLowerCase(), u.id);
        if (u.display_name) byName.set(String(u.display_name).toLowerCase(), u.id);
      });
      // Jira gives emails; Odoo gives display names — try email, then name.
      const resolveUser = (s: string) => byEmail.get(s.toLowerCase()) || byName.get(s.toLowerCase()) || null;

      // Target the board this modal was opened from; else the default, else the
      // oldest pipeline. Passed explicitly to rpc_create_task — relying on null
      // (→ server-side default lookup) orphans tasks when there's no is_default.
      const pipes = pipesRes.data || [];
      const targetPipeId = pipelineId || (pipes.find((p: any) => p.is_default) || pipes[0])?.id;
      if (!targetPipeId) { errorToast('No pipeline exists to import into. Create one first.'); return; }

      // Stages must come from the SAME pipeline the tasks are created in, or
      // rpc_import_place_task_stage rejects them as not belonging to it.
      const { data: st } = await supabase.from('pipeline_stages').select('id, name').eq('pipeline_id', targetPipeId);
      const existingStages = (st || []).map((s: any) => ({ id: s.id, name: s.name }));
      const sourceStages = Array.from(new Set(importedTasks.map(t => t.stageName).filter(Boolean))) as string[];
      const stageMap = new Map(guessStageMapping(sourceStages, existingStages).map(m => [m.sourceName, m.targetStageId]));

      rows = importedTasks.map(t => ({
        rowNumber: 0,
        title: t.title,
        description: t.description,
        priorityDb: t.priority,
        category: t.category,
        weight: 0,
        startDate: null,
        dueDate: t.dueDate,
        estimatedHours: null,
        pipelineName: null,
        projectName: null,
        assigneeEmails: t.assigneeEmails,
        pipelineId: targetPipeId,
        projectId: null,
        assigneeUserIds: t.assigneeEmails.map(resolveUser).filter(Boolean) as string[],
        warnings: [],
      }));
      stageForRow = importedTasks.map(t => (t.stageName ? stageMap.get(t.stageName) ?? null : null));
    }
    if (!rows || rows.length === 0) return;

    setBusy(true);
    setProgress({ done: 0, total: rows.length });
    let created = 0;
    try {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const { data: taskId, error } = await supabase.rpc('rpc_create_task', {
          p_title: r.title,
          p_description: r.description,
          p_priority: r.priorityDb || 'medium',
          p_due_date: r.dueDate,
          p_category: r.category,
          p_weight: r.weight ?? 0,
          p_pipeline_id: r.pipelineId,
          p_project_id: r.projectId,
          p_start_date: r.startDate,
          p_estimated_hours: r.estimatedHours,
        });
        if (error) { console.error('[TaskMobility] row import failed', r.rowNumber || i, error); }
        else {
          created++;
          if ((r.assigneeUserIds?.length ?? 0) > 0) {
            await supabase.rpc('rpc_update_task_assignments', {
              p_task_id: taskId,
              p_user_ids: r.assigneeUserIds,
              p_team_ids: [],
            }).then(({ error: e }) => { if (e) console.error('assign error', e); });
          }
          const targetStage = stageForRow[i];
          if (targetStage) {
            await supabase.rpc('rpc_import_place_task_stage', {
              p_task_id: taskId,
              p_stage_id: targetStage,
            }).then(({ error: e }) => { if (e) console.error('stage place error', e); });
          }
        }
        setProgress({ done: i + 1, total: rows.length });
      }
      if (created > 0) { successToast(`Imported ${created} task${created === 1 ? '' : 's'}.`, 'Import complete'); onImported?.(); }
      if (created < rows.length) errorToast(`${rows.length - created} row${rows.length - created === 1 ? '' : 's'} failed to import.`);
      resetAll();
    } catch (e: any) { errorToast(e?.message || 'Import failed.'); }
    finally { setBusy(false); setProgress(null); }
  };

  const warningCount = parsed?.reduce((n, r) => n + r.warnings.length, 0) ?? 0;

  // ── Render ──
  const FormatToggle = (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
      {(['xlsx', 'csv'] as SpreadsheetFormat[]).map(f => {
        const active = format === f;
        return (
          <TouchableOpacity
            key={f}
            onPress={() => setFormat(f)}
            disabled={busy}
            style={{ flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, alignItems: 'center', borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}1A` : colors.background }}
          >
            <Text style={{ color: active ? colors.primary : colors.textMuted, fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              {f === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderImportContent = () => {
    if (importStep === 'picker') {
      const importers = listImporters();
      const recent = recentConnections
        .map(c => ({ conn: c, adapter: importers.find(a => (a.manifest.providerId || a.manifest.id) === c.provider) }))
        .filter((r): r is { conn: StoredConnection; adapter: ImporterAdapter } => !!r.adapter);
      return (
        <>
          {recent.length > 0 && (
            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                Recently imported from
              </Text>
              {recent.map(({ conn, adapter }) => (
                <TouchableOpacity
                  key={`${conn.provider}-${conn.instance_url || ''}`}
                  onPress={() => handleSelectPlatform(adapter)}
                  disabled={busy}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 8 }}
                >
                  <FontAwesome name={adapter.manifest.icon as any} size={18} color={colors.primary} style={{ width: 30 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textMain, fontWeight: '900', fontSize: 12 }}>
                      {adapter.manifest.displayName}
                      {conn.instance_url ? ` — ${conn.instance_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : ''}
                    </Text>
                    <Text style={{ color: colors.textDim, fontSize: 10, marginTop: 2 }}>Used {formatRelative(conn.updated_at)}</Text>
                  </View>
                  <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 18 }}>
            Choose where to import tasks from:
          </Text>
          {importers.map(adapter => (
            <TouchableOpacity
              key={adapter.manifest.id}
              onPress={() => handleSelectPlatform(adapter)}
              disabled={busy}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 10 }}
            >
              <FontAwesome name={adapter.manifest.icon as any} size={20} color={colors.primary} style={{ width: 32 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textMain, fontWeight: '900', fontSize: 13 }}>{adapter.manifest.displayName}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 10, marginTop: 2 }}>
                  {adapter.manifest.authType === 'file' ? 'Upload a spreadsheet' : adapter.manifest.authType === 'oauth2' ? 'Connect via OAuth' : 'Connect via API key'}
                </Text>
              </View>
              <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          ))}
          {!canImport && (
            <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 12, textAlign: 'center' }}>
              You need task.create permission to import.
            </Text>
          )}
        </>
      );
    }

    if (importStep === 'auth' && selectedAdapter) {
      const m = selectedAdapter.manifest;
      const isConnected = !!connectionMeta?.connected;
      const showForm = !isConnected || reconnecting;
      return (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <TouchableOpacity onPress={() => setImportStep('picker')} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <FontAwesome name="chevron-left" size={12} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginLeft: 6 }}>Back</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textDim, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>{CONNECTOR_STEP_LABELS.auth}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <FontAwesome name={m.icon as any} size={22} color={colors.primary} style={{ marginRight: 10 }} />
            <Text style={{ color: colors.textMain, fontWeight: '900', fontSize: 18 }}>Connect {m.displayName}</Text>
          </View>

          {isConnected && !reconnecting && (
            <View style={{ padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <FontAwesome name="check-circle" size={14} color={colors.success} style={{ marginRight: 8 }} />
                <Text style={{ color: colors.textMain, fontWeight: '900', fontSize: 13 }}>Connected</Text>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 11, marginBottom: 14 }} numberOfLines={2}>
                {connectionMeta?.username ? `${connectionMeta.username} · ` : ''}
                {(connectionMeta?.instanceUrl || m.displayName || '').replace(/^https?:\/\//, '')}
              </Text>
              <TouchableOpacity
                onPress={() => loadProjects()}
                disabled={busy}
                style={{ paddingVertical: 14, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 8 }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <FontAwesome name="arrow-right" size={13} color="#fff" />}
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Continue</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setReconnecting(true)} disabled={busy} style={{ alignItems: 'center', paddingVertical: 6 }}>
                <Text style={{ color: colors.textMuted, fontWeight: '800', fontSize: 11 }}>Reconnect with different credentials</Text>
              </TouchableOpacity>
            </View>
          )}

          {showForm && (m.authType === 'oauth2' ? (
            <TouchableOpacity
              onPress={handleOAuthConnect}
              disabled={busy}
              style={{ paddingVertical: 16, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <FontAwesome name="plug" size={15} color="#fff" />}
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                {isConnected ? `Reconnect with ${m.displayName}` : `Connect with ${m.displayName}`}
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              {m.authFields?.map(field => (
                <View key={field.key} style={{ marginBottom: 14 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{field.label}</Text>
                  <TextInput
                    value={connectorFields[field.key] || ''}
                    onChangeText={v => setConnectorFields(p => ({ ...p, [field.key]: v }))}
                    placeholder={field.type === 'password' && isConnected ? 'Required to reconnect' : field.label}
                    placeholderTextColor={colors.textDim}
                    secureTextEntry={field.type === 'password'}
                    autoCapitalize="none"
                    className="rounded-xl px-4 py-3 text-sm"
                    style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, color: colors.textMain }}
                  />
                </View>
              ))}
              <TouchableOpacity
                onPress={handleApiKeyConnect}
                disabled={busy}
                style={{ paddingVertical: 16, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 8 }}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <FontAwesome name="plug" size={15} color="#fff" />}
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {isConnected ? 'Update Connection' : 'Connect'}
                </Text>
              </TouchableOpacity>
              {isConnected && (
                <TouchableOpacity onPress={() => setReconnecting(false)} disabled={busy} style={{ alignItems: 'center', paddingVertical: 10 }}>
                  <Text style={{ color: colors.textMuted, fontWeight: '800', fontSize: 11 }}>Cancel</Text>
                </TouchableOpacity>
              )}
            </>
          ))}
        </>
      );
    }

    if (importStep === 'source') {
      return (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <TouchableOpacity onPress={() => setImportStep('auth')} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <FontAwesome name="chevron-left" size={12} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginLeft: 6 }}>Back</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textDim, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>{CONNECTOR_STEP_LABELS.source}</Text>
          </View>

          <Text style={{ color: colors.textMain, fontWeight: '900', fontSize: 18, marginBottom: 14 }}>
            Select {selectedAdapter?.manifest.displayName} Project
          </Text>

          {sourcesLoading ? (
            <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 30 }} />
          ) : (
            projects.map((proj: any) => {
              const id = proj.id || proj.key || '';
              const name = proj.name || proj.key || id;
              const isLastUsed = id === selectedProjectId;
              return (
                <TouchableOpacity
                  key={id}
                  onPress={() => handleSelectProject(id, name)}
                  disabled={busy}
                  style={{ paddingVertical: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: isLastUsed ? colors.primary : colors.border, backgroundColor: colors.background, marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}
                >
                  <FontAwesome name="folder-o" size={16} color={colors.primary} style={{ marginRight: 12 }} />
                  <Text style={{ color: colors.textMain, fontWeight: '800', fontSize: 13, flex: 1 }}>{name}</Text>
                  {isLastUsed && (
                    <Text style={{ color: colors.primary, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 8 }}>Last used</Text>
                  )}
                  <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              );
            })
          )}
        </>
      );
    }

    // preview step
    if (importedTasks) {
      return (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <TouchableOpacity onPress={() => setImportStep('source')} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <FontAwesome name="chevron-left" size={12} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginLeft: 6 }}>Back</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textDim, fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }}>{CONNECTOR_STEP_LABELS.preview}</Text>
          </View>

          <View style={{ backgroundColor: colors.background, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 22 }}>{importedTasks.length}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>Tasks to import</Text>
          </View>

          {progress && (
            <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
              Importing {progress.done} / {progress.total}...
            </Text>
          )}

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity onPress={resetAll} disabled={busy} style={{ flex: 1, paddingVertical: 15, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center' }}>
              <Text style={{ color: colors.textMuted, fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleConfirmImport} disabled={busy} style={{ flex: 2, paddingVertical: 15, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
              {busy && <ActivityIndicator color="#fff" />}
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                Create {importedTasks.length} Task{importedTasks.length === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }

    // Existing file-based preview
    return (
      <>
        <View style={{ backgroundColor: colors.background, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: colors.textMain, fontWeight: '900', fontSize: 14, flexShrink: 1 }} numberOfLines={1}>{parsedFileName}</Text>
            {detectedJira && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: `${colors.primary}1A` }}>
                <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1 }}>Detected: Jira export</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
            <View>
              <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 22 }}>{parsed?.length ?? 0}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>To create</Text>
            </View>
            {skipped > 0 && (
              <View>
                <Text style={{ color: colors.textMuted, fontWeight: '900', fontSize: 22 }}>{skipped}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>Skipped</Text>
              </View>
            )}
            {warningCount > 0 && (
              <View>
                <Text style={{ color: colors.warning, fontWeight: '900', fontSize: 22 }}>{warningCount}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>Warnings</Text>
              </View>
            )}
          </View>
        </View>

        {warningCount > 0 && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Warnings</Text>
            {parsed?.flatMap(r => r.warnings.map((w, i) => (
              <Text key={`${r.rowNumber}-${i}`} style={{ color: colors.textMuted, fontSize: 11, lineHeight: 17 }}>Row {r.rowNumber}: {w}</Text>
            ))).slice(0, 20)}
            {warningCount > 20 && <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 4 }}>…and {warningCount - 20} more.</Text>}
          </View>
        )}

        {progress && (
          <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
            Importing {progress.done} / {progress.total}…
          </Text>
        )}

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity onPress={resetAll} disabled={busy} style={{ flex: 1, paddingVertical: 15, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center' }}>
            <Text style={{ color: colors.textMuted, fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleConfirmImport} disabled={busy} style={{ flex: 2, paddingVertical: 15, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
              Create {parsed?.length ?? 0} Task{(parsed?.length ?? 0) === 1 ? '' : 's'}
            </Text>
          </TouchableOpacity>
        </View>
      </>
    );
  };

  const body = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 8 }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ color: colors.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 2 }}>Task Data Mobility</Text>
          <Text style={{ color: colors.textMain, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 }}>Import / Export</Text>
        </View>
        <Tooltip label="Close">
          <TouchableOpacity onPress={handleClose} disabled={busy} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
            <FontAwesome name="times" size={15} color={colors.textMain} />
          </TouchableOpacity>
        </Tooltip>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6 }}>
        {(['export', 'import'] as Tab[]).map(t => {
          const active = tab === t;
          const disabled = t === 'import' && !canImport;
          return (
            <TouchableOpacity key={t} onPress={() => { if (!disabled && t !== tab) { setTab(t); resetAll(); } }} disabled={busy || disabled}
              style={{ flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: active ? colors.primary : colors.background, borderWidth: 1, borderColor: active ? colors.primary : colors.border, opacity: disabled ? 0.4 : 1 }}>
              <Text style={{ color: active ? '#fff' : colors.textMuted, fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                {t === 'export' ? 'Export' : 'Import'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={{ padding: 22 }} showsVerticalScrollIndicator={false}>
        {tab === 'export' ? (
          <>
            <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 18 }}>
              Download every task in your workspace as a spreadsheet — useful for backups, reporting, or bulk edits you can re-import.
            </Text>
            {FormatToggle}
            <TouchableOpacity onPress={handleExport} disabled={busy}
              style={{ paddingVertical: 16, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
              {busy ? <ActivityIndicator color="#fff" /> : <FontAwesome name="download" size={15} color="#fff" />}
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Export Tasks</Text>
            </TouchableOpacity>
            {canImport && (
              <TouchableOpacity onPress={handleTemplate} disabled={busy}
                style={{ marginTop: 12, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}>
                <FontAwesome name="file-text-o" size={14} color={colors.textMuted} />
                <Text style={{ color: colors.textMuted, fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Download Import Template</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          renderImportContent()
        )}
      </ScrollView>
    </>
  );

  return (
    <Popup visible={visible} onClose={handleClose} dimBackdrop presentation="auto" maxWidth={420}>
      {body}
    </Popup>
  );
}
