import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import DraggableSheet from '@/components/common/DraggableSheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called after a successful import so the board can refresh. */
  onImported?: () => void;
};

type Tab = 'export' | 'import';

const MIME: Record<SpreadsheetFormat, string> = {
  csv: 'text/csv;charset=utf-8;',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export default function TaskMobilityModal({ visible, onClose, onImported }: Props) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { hasPermission } = useAuth();
  const { successToast, errorToast, infoToast } = useToast();

  const canImport = hasPermission('task.create') || hasPermission('tasks.create');

  const [tab, setTab] = useState<Tab>('export');
  const [format, setFormat] = useState<SpreadsheetFormat>('xlsx');
  const [busy, setBusy] = useState(false);

  // Import state
  const [parsed, setParsed] = useState<ParsedTaskRow[] | null>(null);
  const [parsedFileName, setParsedFileName] = useState<string>('');
  const [skipped, setSkipped] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [detectedJira, setDetectedJira] = useState(false);

  const resetImport = () => {
    setParsed(null);
    setParsedFileName('');
    setSkipped(0);
    setProgress(null);
    setDetectedJira(false);
  };

  const handleClose = () => {
    if (busy) return;
    resetImport();
    onClose();
  };

  // ── Export ──────────────────────────────────────────────
  const handleExport = async () => {
    setBusy(true);
    try {
      const tasks = await fetchExportTasks();

      if (tasks.length === 0) {
        infoToast('No tasks to export.');
        return;
      }

      const bytes = await rowsToBytes(buildExportRows(tasks), format);
      const stamp = new Date().toISOString().slice(0, 10);
      const saved = await saveBytes(`tasks_export_${stamp}.${format}`, bytes, MIME[format]);
      if (saved) {
        successToast(
          Platform.OS === 'web'
            ? `Exported ${tasks.length} tasks.`
            : `Exported ${tasks.length} tasks to ${saved}`,
          'Export complete'
        );
      } else {
        errorToast('Could not save the export file.');
      }
    } catch (e: any) {
      console.error('[TaskMobility] export failed', e);
      errorToast(e?.message || 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleTemplate = async () => {
    setBusy(true);
    try {
      const bytes = await buildTemplateBytes(format);
      const saved = await saveBytes(`task_import_template.${format}`, bytes, MIME[format]);
      if (saved) infoToast(Platform.OS === 'web' ? 'Template downloaded.' : `Template saved to ${saved}`);
    } catch (e: any) {
      errorToast(e?.message || 'Could not create template.');
    } finally {
      setBusy(false);
    }
  };

  // ── Import ──────────────────────────────────────────────
  const handlePick = async () => {
    setBusy(true);
    try {
      const file = await pickSpreadsheet();
      if (!file) return;

      const rawRows = await bytesToRows(file.bytes);
      if (rawRows.length === 0) {
        errorToast('That file has no readable rows.');
        return;
      }

      const fromJira = isJiraExport(rawRows);
      const sourceRows = fromJira ? rawRows.map(mapJiraRow) : rawRows;

      // Build company lookups for name/email resolution.
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
      if (rows.length === 0) {
        errorToast('No rows with a Title were found.');
        return;
      }
      setParsed(rows);
      setParsedFileName(file.name);
      setSkipped(sk);
      setDetectedJira(fromJira);
    } catch (e: any) {
      console.error('[TaskMobility] pick/parse failed', e);
      errorToast(e?.message || 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!parsed) return;
    setBusy(true);
    setProgress({ done: 0, total: parsed.length });
    let created = 0;
    try {
      for (let i = 0; i < parsed.length; i++) {
        const r = parsed[i];
        const { data: taskId, error } = await supabase.rpc('rpc_create_task', {
          p_title: r.title,
          p_description: r.description,
          p_priority: r.priorityDb,
          p_due_date: r.dueDate,
          p_category: r.category,
          p_weight: r.weight,
          p_pipeline_id: r.pipelineId,
          p_project_id: r.projectId,
          p_start_date: r.startDate,
          p_estimated_hours: r.estimatedHours,
        });
        if (error) {
          console.error('[TaskMobility] row import failed', r.rowNumber, error);
        } else {
          created++;
          if (r.assigneeUserIds.length > 0) {
            await supabase.rpc('rpc_update_task_assignments', {
              p_task_id: taskId,
              p_user_ids: r.assigneeUserIds,
              p_team_ids: [],
            }).then(({ error: e }) => { if (e) console.error('assign error', e); });
          }
        }
        setProgress({ done: i + 1, total: parsed.length });
      }

      if (created > 0) {
        successToast(`Imported ${created} task${created === 1 ? '' : 's'}.`, 'Import complete');
        onImported?.();
      }
      if (created < parsed.length) {
        errorToast(`${parsed.length - created} row${parsed.length - created === 1 ? '' : 's'} failed to import.`);
      }
      resetImport();
    } catch (e: any) {
      console.error('[TaskMobility] import failed', e);
      errorToast(e?.message || 'Import failed.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const warningCount = parsed?.reduce((n, r) => n + r.warnings.length, 0) ?? 0;

  // ── UI ──────────────────────────────────────────────────
  const FormatToggle = (
    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
      {(['xlsx', 'csv'] as SpreadsheetFormat[]).map(f => {
        const active = format === f;
        return (
          <TouchableOpacity
            key={f}
            onPress={() => setFormat(f)}
            disabled={busy}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 14,
              borderWidth: 1,
              alignItems: 'center',
              borderColor: active ? colors.primary : colors.border,
              backgroundColor: active ? `${colors.primary}1A` : colors.background,
            }}
          >
            <Text style={{ color: active ? colors.primary : colors.textMuted, fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
              {f === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)'}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const body = (
        <>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 8 }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ color: colors.textMuted, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 3, marginBottom: 2 }}>Task Data Mobility</Text>
              <Text style={{ color: colors.textMain, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 }}>Import / Export</Text>
            </View>
            <TouchableOpacity onPress={handleClose} disabled={busy} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}>
              <FontAwesome name="times" size={15} color={colors.textMain} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 6 }}>
            {(['export', 'import'] as Tab[]).map(t => {
              const active = tab === t;
              const disabled = t === 'import' && !canImport;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => { if (!disabled) { setTab(t); resetImport(); } }}
                  disabled={busy || disabled}
                  style={{
                    flex: 1,
                    paddingVertical: 11,
                    borderRadius: 12,
                    alignItems: 'center',
                    backgroundColor: active ? colors.primary : colors.background,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    opacity: disabled ? 0.4 : 1,
                  }}
                >
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
                <TouchableOpacity
                  onPress={handleExport}
                  disabled={busy}
                  style={{ paddingVertical: 16, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <FontAwesome name="download" size={15} color="#fff" />}
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Export Tasks</Text>
                </TouchableOpacity>

                {canImport && (
                  <TouchableOpacity
                    onPress={handleTemplate}
                    disabled={busy}
                    style={{ marginTop: 12, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                  >
                    <FontAwesome name="file-text-o" size={14} color={colors.textMuted} />
                    <Text style={{ color: colors.textMuted, fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Download Import Template</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <>
                {!parsed ? (
                  <>
                    <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 8 }}>
                      Pick a .csv or .xlsx file. Each row with a <Text style={{ color: colors.textMain, fontWeight: '800' }}>Title</Text> becomes a new task. Pipeline / Project are matched by name and assignees by email.
                    </Text>
                    <Text style={{ color: colors.textDim, fontSize: 11, lineHeight: 17, marginBottom: 18 }}>
                      Import only creates new tasks — it never edits or deletes existing ones. A Jira issue export is detected automatically and mapped onto these same fields.
                    </Text>
                    {FormatToggle}
                    <TouchableOpacity
                      onPress={handlePick}
                      disabled={busy}
                      style={{ paddingVertical: 16, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                    >
                      {busy ? <ActivityIndicator color="#fff" /> : <FontAwesome name="upload" size={15} color="#fff" />}
                      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Choose File</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {/* Preview summary */}
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
                          <Text style={{ color: colors.primary, fontWeight: '900', fontSize: 22 }}>{parsed.length}</Text>
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
                        {parsed.flatMap(r => r.warnings.map((w, i) => (
                          <Text key={`${r.rowNumber}-${i}`} style={{ color: colors.textMuted, fontSize: 11, lineHeight: 17 }}>
                            Row {r.rowNumber}: {w}
                          </Text>
                        ))).slice(0, 20)}
                        {warningCount > 20 && (
                          <Text style={{ color: colors.textDim, fontSize: 11, marginTop: 4 }}>…and {warningCount - 20} more.</Text>
                        )}
                      </View>
                    )}

                    {progress && (
                      <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 12 }}>
                        Importing {progress.done} / {progress.total}…
                      </Text>
                    )}

                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <TouchableOpacity
                        onPress={resetImport}
                        disabled={busy}
                        style={{ flex: 1, paddingVertical: 15, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, alignItems: 'center' }}
                      >
                        <Text style={{ color: colors.textMuted, fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Back</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleConfirmImport}
                        disabled={busy}
                        style={{ flex: 2, paddingVertical: 15, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 }}
                      >
                        {busy && <ActivityIndicator color="#fff" />}
                        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                          Create {parsed.length} Task{parsed.length === 1 ? '' : 's'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </>
  );

  if (Platform.OS !== 'web') {
    return (
      <DraggableSheet
        visible={visible}
        onClose={handleClose}
        dimBackdrop
        maxHeight="88%"
        containerStyle={{ backgroundColor: colors.card, borderColor: colors.border }}
        containerClassName="rounded-t-[28px] border-t overflow-hidden"
      >
        {body}
      </DraggableSheet>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: 460,
            maxHeight: '100%',
            backgroundColor: colors.card,
            borderRadius: 28,
            borderWidth: 1,
            borderColor: colors.border,
            overflow: 'hidden',
          }}
        >
          {body}
        </View>
      </View>
    </Modal>
  );
}
