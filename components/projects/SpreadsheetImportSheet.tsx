// Spreadsheet intake wizard — issue #188 / plan §15 ("Smartness": drop a
// spreadsheet, get a configured portfolio).
//
// Scope (§15.1, hard constraint): this component ONLY produces a projects
// array + resolved client identities. It never inserts a client, project, or
// task — it hands off to the EXISTING BulkCreateProjectsSheet (extended with
// `initialRows`), which is the one caller of rpc_instantiate_template. A
// human still confirms the configure step (template, boards, schedule)
// before anything is written — parsing fills in a form, it never skips one.
//
// Steps: drop -> mapping (find the table + propose columns, §15.2 #1-2) ->
// clients (resolve against existing clients, §15.2 #3, ambiguous = a
// question) -> hands off to BulkCreateProjectsSheet with the resolved rows.
// Template suggestion (§15.2 #4) is explicitly deferred — the user still
// picks a template by hand in the configure step that follows.
//
// File upload goes through the EXISTING UploadManagerContext (see
// BulkCreateProjectsSheet's getOrCreateStandingFolder + handleCreate) — this
// file only reads the dropped File's bytes client-side to parse it; it never
// uploads anything itself.

import BulkCreateProjectsSheet from '@/components/projects/BulkCreateProjectsSheet';
import Popup from '@/components/common/Popup';
import DraggableSheet from '@/components/common/DraggableSheet';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useDropPulse, useFileDrop } from '@/hooks/useWebDnd';
import { computeSHA256 } from '@/lib/uploadHelpers';
import { supabase } from '@/lib/supabase';
import {
  parseSpreadsheetBytes,
  fetchExistingClients,
  resolveClientMatch,
  buildIntakeRows,
  MAPPED_FIELD_LABELS,
  SpreadsheetIntakeError,
  type ParsedSpreadsheet,
  type ColumnMapping,
  type MappedField,
  type ExistingClient,
  type ClientMatch,
  type IntakeRow,
} from '@/lib/imports/spreadsheetIntake';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= 768;
}

const MAPPED_FIELDS: MappedField[] = ['name', 'client_ref', 'client_external_ref', 'start_date'];
const ACCEPT = '.xlsx,.xls,.csv';

// ─── Step 1: drop zone ──────────────────────────────────────────────────────

function DropZone({ onFile, busy }: { onFile: (file: File) => void; busy: boolean }) {
  const c = useThemeColors();
  const { ref, isOver } = useFileDrop(files => { if (files[0]) onFile(files[0]); });
  const { iconScale, glowOpacity } = useDropPulse(isOver);
  const inputRef = React.useRef<any>(null);

  return (
    <View
      // @ts-ignore — ref forwards to the underlying DOM node on web (useFileDrop), no-ops on native.
      ref={ref}
      className={`border-2 border-dashed rounded-2xl items-center justify-center px-6 ${isOver ? 'border-brand-primary' : 'border-surface-border'}`}
      style={{ minHeight: 220, backgroundColor: isOver ? `${c.primary}0d` : c.background }}
    >
      {busy ? (
        <ActivityIndicator color={c.primary} />
      ) : (
        <>
          {Platform.OS === 'web' && (
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              style={{ display: 'none' }}
              onChange={(e: any) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
            />
          )}
          <Animated.View style={Platform.OS === 'web' ? { transform: [{ scale: iconScale }], opacity: glowOpacity } : undefined}>
            <FontAwesome name="file-excel-o" size={40} color={c.primary} />
          </Animated.View>
          <Text className="text-typography-main font-black text-base mt-4">
            {Platform.OS === 'web' ? 'Drag a spreadsheet here' : 'Spreadsheet import'}
          </Text>
          <Text className="text-typography-muted text-xs mt-1 text-center">
            {Platform.OS === 'web'
              ? 'Excel or CSV — clients, a portfolio manifest, or a task list. We’ll find the table for you.'
              : 'Import from spreadsheet is available on web for now.'}
          </Text>
          {Platform.OS === 'web' && (
            <TouchableOpacity
              onPress={() => inputRef.current?.click?.()}
              className="mt-4 px-5 py-2.5 rounded-xl bg-brand-primary"
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text className="text-white text-xs font-black uppercase tracking-wider">Browse Files</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

// react-native's Animated isn't imported above on purpose (avoid pulling it
// into every platform bundle for a web-only pulse) — import lazily here.
import { Animated } from 'react-native';

// ─── Step 2: column mapping ─────────────────────────────────────────────────

function FieldMappingRow({
  field, headers, mapping, confidence, onChange, c,
}: {
  field: MappedField;
  headers: (string | number | boolean | null | undefined)[];
  mapping: ColumnMapping;
  confidence: Partial<Record<MappedField, number>>;
  onChange: (field: MappedField, columnIndex: number | undefined) => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  const [open, setOpen] = useState(false);
  const colIdx = mapping[field];
  const label = colIdx !== undefined ? String(headers[colIdx] ?? `Column ${colIdx + 1}`) : null;
  const conf = confidence[field];
  const isRequired = field === 'name';

  return (
    <View style={{ gap: 6 }}>
      <View className="flex-row items-center justify-between">
        <Text className="text-typography-main text-xs font-bold">
          {MAPPED_FIELD_LABELS[field]}{isRequired ? ' *' : ''}
        </Text>
        {label && conf !== undefined && (
          <Text className={`text-[9px] font-black uppercase ${conf >= 0.8 ? 'text-state-success' : conf >= 0.5 ? 'text-state-warning' : 'text-state-danger'}`}>
            {conf >= 0.8 ? 'Detected' : conf >= 0.5 ? 'Guessed' : 'Low confidence'}
          </Text>
        )}
      </View>
      <TouchableOpacity
        onPress={() => setOpen(v => !v)}
        className={`flex-row items-center justify-between px-3 rounded-lg border ${label ? 'border-surface-border' : isRequired ? 'border-state-danger' : 'border-surface-border'}`}
        style={{ minHeight: 44, backgroundColor: c.background }}
      >
        <Text className={`text-xs font-bold flex-1 ${label ? 'text-typography-main' : 'text-typography-dim'}`} numberOfLines={1}>
          {label || (isRequired ? 'Pick a column (required)' : 'Not mapped')}
        </Text>
        <FontAwesome name={open ? 'chevron-up' : 'chevron-down'} size={10} color={c.textDim} />
      </TouchableOpacity>
      {open && (
        <View className="border border-surface-border rounded-lg" style={{ maxHeight: 200, overflow: 'hidden' }}>
          <ScrollView>
            <TouchableOpacity
              onPress={() => { onChange(field, undefined); setOpen(false); }}
              className="px-3 py-2.5"
            >
              <Text className={`text-xs font-bold ${colIdx === undefined ? 'text-brand-primary' : 'text-typography-muted'}`}>Not mapped</Text>
            </TouchableOpacity>
            {headers.map((h, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => { onChange(field, i); setOpen(false); }}
                className="px-3 py-2.5"
              >
                <Text className={`text-xs font-bold ${colIdx === i ? 'text-brand-primary' : 'text-typography-main'}`} numberOfLines={1}>
                  {String(h ?? '') || `Column ${i + 1}`}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function RowPreviewTable({ rows }: { rows: IntakeRow[] }) {
  const shown = rows.slice(0, 12);
  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <View style={{ gap: 6 }}>
        {shown.map((r, i) => (
          <View key={i} className="bg-surface-background border border-surface-border rounded-lg px-3 py-2">
            <Text className="text-typography-main text-xs font-bold" numberOfLines={1}>{r.name || '(no name)'}</Text>
            <Text className="text-typography-muted text-[10px] mt-0.5" numberOfLines={1}>
              {r.client_ref && r.client_ref !== r.name ? `${r.client_ref} · ` : ''}
              {r.client_external_ref ? `${r.client_external_ref} · ` : ''}
              {r.start_date ? new Date(r.start_date).toLocaleDateString() : (r.start_date_raw ? `unparsed: "${r.start_date_raw}"` : 'no date')}
            </Text>
          </View>
        ))}
        {rows.length > shown.length && (
          <Text className="text-typography-dim text-[10px] text-center py-1">+{rows.length - shown.length} more rows</Text>
        )}
      </View>
    </ScrollView>
  );
}

// ─── Step 3: client resolution ──────────────────────────────────────────────

type Decision = { rowIndex: number; kind: 'existing'; client: ExistingClient } | { rowIndex: number; kind: 'new' };

function AmbiguousRow({
  row, match, decision, onDecide, c,
}: {
  row: IntakeRow;
  match: Extract<ClientMatch, { kind: 'ambiguous' }>;
  decision: Decision | undefined;
  onDecide: (d: Decision) => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View className="bg-surface-background border border-state-warning rounded-2xl p-3" style={{ gap: 8 }}>
      <View className="flex-row items-center gap-2">
        <FontAwesome name="question-circle" size={12} color={c.warning} />
        <Text className="text-typography-main text-xs font-black flex-1" numberOfLines={1}>
          Row {row.rowNumber}: "{row.client_ref}" — which client is this?
        </Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {match.candidates.map(cand => (
          <TouchableOpacity
            key={cand.id}
            onPress={() => onDecide({ rowIndex: row.rowNumber, kind: 'existing', client: cand })}
            className={`px-3 py-2 rounded-lg border ${decision?.kind === 'existing' && decision.client.id === cand.id ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text className={`text-xs font-bold ${decision?.kind === 'existing' && decision.client.id === cand.id ? 'text-white' : 'text-typography-main'}`}>
              Use "{cand.name}"
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={() => onDecide({ rowIndex: row.rowNumber, kind: 'new' })}
          className={`px-3 py-2 rounded-lg border ${decision?.kind === 'new' ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text className={`text-xs font-bold ${decision?.kind === 'new' ? 'text-white' : 'text-typography-main'}`}>
            Actually a new client
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Main wizard ─────────────────────────────────────────────────────────────

type WizStep = 'drop' | 'mapping' | 'clients';

export default function SpreadsheetImportSheet({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated?: (result: { portfolio_id: string; projects_created: number; tasks_created: number }) => void;
}) {
  const c = useThemeColors();
  const isDesktop = useIsDesktop();

  const [wizStep, setWizStep] = useState<WizStep>('drop');
  const [mobilePage, setMobilePage] = useState<'mapping' | 'preview'>('mapping');

  const [file, setFile] = useState<File | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});

  const [existingClients, setExistingClients] = useState<ExistingClient[] | null>(null);
  const [decisions, setDecisions] = useState<Map<number, Decision>>(new Map());

  // Idempotency (plan §15.3 "re-importing the same file is a no-op"). Checked
  // client-side (fast UX — skip the whole wizard) AND, redundantly but
  // load-bearingly, server-side by rpc_instantiate_template's existing
  // idempotency_key short-circuit — this pre-check is a courtesy, not the
  // correctness guarantee.
  const [alreadyImported, setAlreadyImported] = useState<{ name: string; createdAt: string } | null>(null);

  const [handoff, setHandoff] = useState(false); // true once client resolution is confirmed -> render BulkCreateProjectsSheet

  useEffect(() => {
    if (!visible) return;
    setWizStep('drop');
    setMobilePage('mapping');
    setFile(null);
    setContentHash(null);
    setBusy(false);
    setError(null);
    setParsed(null);
    setMapping({});
    setExistingClients(null);
    setDecisions(new Map());
    setAlreadyImported(null);
    setHandoff(false);
  }, [visible]);

  const handleFile = async (f: File) => {
    setBusy(true);
    setError(null);
    try {
      const hash = await computeSHA256(f);
      const idempotencyKey = `spreadsheet:${hash}`;

      // Fast path: same file dropped twice -> no-op, skip straight to a
      // confirmation instead of re-running the whole wizard.
      const { data: existingPortfolio } = await supabase
        .from('portfolios')
        .select('name, created_at')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existingPortfolio) {
        setFile(f);
        setContentHash(hash);
        setAlreadyImported({ name: existingPortfolio.name, createdAt: existingPortfolio.created_at });
        setBusy(false);
        return;
      }

      const bytes = new Uint8Array(await f.arrayBuffer());
      const [result, clients] = await Promise.all([parseSpreadsheetBytes(bytes), fetchExistingClients()]);

      setFile(f);
      setContentHash(hash);
      setParsed(result);
      setMapping(result.mapping);
      setExistingClients(clients);
      setWizStep('mapping');
    } catch (e: any) {
      setError(e instanceof SpreadsheetIntakeError ? e.message : (e?.message || 'Could not read this file.'));
    } finally {
      setBusy(false);
    }
  };

  const setMappingField = (field: MappedField, columnIndex: number | undefined) => {
    setMapping(prev => {
      const next = { ...prev };
      if (columnIndex === undefined) delete next[field];
      else next[field] = columnIndex;
      return next;
    });
  };

  // Re-derive rows whenever the (possibly user-edited) mapping changes, so
  // everything downstream — preview, client resolution, the final payload —
  // reflects the mapping actually confirmed, never a stale auto-proposal.
  const liveRows = useMemo(() => {
    if (!parsed) return [];
    return buildIntakeRows(parsed.aoa, parsed.headerRowIndex, mapping);
  }, [parsed, mapping]);

  const nameMapped = mapping.name !== undefined;

  const matches = useMemo(() => {
    if (!existingClients) return new Map<number, ClientMatch>();
    const out = new Map<number, ClientMatch>();
    liveRows.forEach(row => out.set(row.rowNumber, resolveClientMatch(row, existingClients)));
    return out;
  }, [liveRows, existingClients]);

  const ambiguousRows = useMemo(
    () => liveRows.filter(r => matches.get(r.rowNumber)?.kind === 'ambiguous'),
    [liveRows, matches],
  );
  const blankRows = useMemo(() => liveRows.filter(r => matches.get(r.rowNumber)?.kind === 'blank'), [liveRows, matches]);
  const unparsedDateRows = useMemo(
    () => liveRows.filter(r => !r.start_date && r.start_date_raw),
    [liveRows],
  );
  const readyRows = useMemo(
    () => liveRows.filter(r => { const m = matches.get(r.rowNumber); return m && m.kind !== 'ambiguous' && m.kind !== 'blank'; }),
    [liveRows, matches],
  );

  const allAmbiguousDecided = ambiguousRows.every(r => decisions.has(r.rowNumber));
  const canContinueToClients = nameMapped;
  const canFinishClients = allAmbiguousDecided;

  // Final payload for BulkCreateProjectsSheet — one place where every
  // resolution collapses into the {name, client_ref, external_ref,
  // start_date} shape rpc_instantiate_template's p_projects expects.
  // CORRECTNESS NOTE: for a 'ref' or 'exact_name' (or user-confirmed
  // 'ambiguous') match, client_ref is set to the EXISTING client's canonical
  // name from the DB, not the row's raw text — the RPC resolves by-name via
  // `c.name = i.client_ref`, which is case-SENSITIVE, so sending the row's
  // raw casing back would silently create a duplicate client on a
  // case-different match.
  const finalRows = useMemo(() => {
    return readyRows
      .map(row => {
        const m = matches.get(row.rowNumber);
        let clientRef = row.client_ref;
        let externalRef = row.client_external_ref;
        if (m?.kind === 'ref' || m?.kind === 'exact_name') {
          clientRef = m.client.name;
          externalRef = m.client.external_ref ?? externalRef;
        }
        return {
          raw: `row-${row.rowNumber}`,
          name: row.name,
          client_ref: clientRef || row.name,
          start_date: row.start_date,
          external_ref: externalRef,
        };
      })
      .concat(
        ambiguousRows.map(row => {
          const d = decisions.get(row.rowNumber);
          const clientRef = d?.kind === 'existing' ? d.client.name : row.client_ref;
          const externalRef = d?.kind === 'existing' ? d.client.external_ref : row.client_external_ref;
          return {
            raw: `row-${row.rowNumber}`,
            name: row.name,
            client_ref: clientRef || row.name,
            start_date: row.start_date,
            external_ref: externalRef,
          };
        }),
      );
  }, [readyRows, ambiguousRows, matches, decisions]);

  const newClientCount = useMemo(
    () => [...readyRows, ...ambiguousRows].filter(r => {
      const m = matches.get(r.rowNumber);
      if (m?.kind === 'new') return true;
      const d = decisions.get(r.rowNumber);
      return d?.kind === 'new';
    }).length,
    [readyRows, ambiguousRows, matches, decisions],
  );

  if (alreadyImported) {
    return (
      <Popup visible={visible} onClose={onClose} presentation="auto" title="Already Imported" footer="single-action"
        primaryAction={{ label: 'Close', onPress: onClose, variant: 'default' }} maxWidth={480}>
        <View className="px-6 py-6 items-center" style={{ gap: 10 }}>
          <FontAwesome name="check-circle" size={32} color={c.success} />
          <Text className="text-typography-main text-sm font-bold text-center">
            This exact file was already imported as "{alreadyImported.name}" on {new Date(alreadyImported.createdAt).toLocaleDateString()}.
          </Text>
          <Text className="text-typography-muted text-xs text-center">
            Dropping the same file again is a no-op — nothing new was created.
          </Text>
        </View>
      </Popup>
    );
  }

  if (handoff) {
    return (
      <BulkCreateProjectsSheet
        visible={visible}
        onClose={onClose}
        onCreated={onCreated}
        initialRows={finalRows}
        initialPortfolioName={file ? file.name.replace(/\.(xlsx|xls|csv)$/i, '') : ''}
        initialSource={file ? `spreadsheet:${file.name}` : undefined}
        initialIdempotencyKey={contentHash ? `spreadsheet:${contentHash}` : undefined}
        initialSourceFile={file && contentHash ? { file, contentHash } : null}
      />
    );
  }

  if (wizStep === 'drop') {
    return (
      <Popup visible={visible} onClose={onClose} presentation="auto" title="Import Spreadsheet" maxWidth={640} dismissible={!busy}>
        <View className="px-6 py-5" style={{ gap: 12 }}>
          <DropZone onFile={handleFile} busy={busy} />
          {error && <Text className="text-state-danger text-xs font-bold">{error}</Text>}
          <Text className="text-typography-dim text-[10px] text-center">
            We detect the header row, propose column mapping, and match clients — you confirm everything before anything is created.
          </Text>
        </View>
      </Popup>
    );
  }

  if (wizStep === 'mapping' && parsed) {
    const mappingBody = (
      <View style={{ gap: 14 }}>
        {MAPPED_FIELDS.map(f => (
          <FieldMappingRow
            key={f}
            field={f}
            headers={parsed.headers}
            mapping={mapping}
            confidence={parsed.confidence}
            onChange={setMappingField}
            c={c}
          />
        ))}
      </View>
    );
    const previewBody = <RowPreviewTable rows={liveRows} />;

    if (!isDesktop) {
      return (
        <DraggableSheet visible={visible} onClose={onClose} dimBackdrop maxHeight="95%" dismissible scrollable={false} containerClassName="rounded-t-[2rem] overflow-hidden">
          <View style={{ flex: 1, minHeight: 0 }}>
            <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
              <View className="flex-1 mr-3">
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Step 1 of 2</Text>
                <Text className="text-typography-main text-xl font-black tracking-tight">Map Columns</Text>
              </View>
              <TouchableOpacity onPress={onClose} className="w-10 h-10 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                <FontAwesome name="times" size={16} color={c.textMain} />
              </TouchableOpacity>
            </View>
            {mobilePage === 'mapping' ? (
              <>
                <ScrollView className="px-5" contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
                  <Text className="text-typography-muted text-xs">
                    Header found on row {parsed.headerRowIndex + 1} · {parsed.totalDataRows} rows detected.
                  </Text>
                  {mappingBody}
                  <TouchableOpacity onPress={() => setMobilePage('preview')} className="flex-row items-center justify-between p-4 rounded-2xl" style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border, minHeight: 44 }}>
                    <Text className="text-typography-main font-black text-sm">Preview Rows</Text>
                    <FontAwesome name="chevron-right" size={14} color={c.textMuted} />
                  </TouchableOpacity>
                </ScrollView>
                <View className="flex-row gap-3 px-5 py-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
                  <TouchableOpacity onPress={onClose} className="flex-1 py-3.5 rounded-2xl items-center" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                    <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={async () => { setBusy(true); setError(null); try { const cl = existingClients ?? await fetchExistingClients(); setExistingClients(cl); setWizStep('clients'); } catch (e: any) { setError(e?.message || 'Could not load clients.'); } finally { setBusy(false); } }}
                    disabled={!canContinueToClients || busy}
                    className="flex-[2] py-3.5 rounded-2xl items-center"
                    style={{ backgroundColor: canContinueToClients ? c.primary : c.border }}
                  >
                    <Text className="font-black uppercase tracking-widest text-xs" style={{ color: canContinueToClients ? 'white' : c.textMuted }}>
                      {busy ? 'Loading…' : 'Continue'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View className="flex-row items-center px-3 pb-3">
                  <TouchableOpacity onPress={() => setMobilePage('mapping')} className="w-10 h-10 items-center justify-center rounded-full mr-2" style={{ backgroundColor: c.background }}>
                    <FontAwesome name="chevron-left" size={14} color={c.textMain} />
                  </TouchableOpacity>
                  <Text className="text-typography-main font-black text-base">Row Preview</Text>
                </View>
                <View className="flex-1 px-5">{previewBody}</View>
              </>
            )}
          </View>
        </DraggableSheet>
      );
    }

    return (
      <Popup
        visible={visible}
        onClose={onClose}
        presentation="centered"
        title="Map Columns"
        footer="dual-action"
        secondaryAction={{ label: 'Cancel', onPress: onClose }}
        primaryAction={{
          label: busy ? 'Loading…' : 'Continue',
          onPress: async () => { setBusy(true); setError(null); try { const cl = existingClients ?? await fetchExistingClients(); setExistingClients(cl); setWizStep('clients'); } catch (e: any) { setError(e?.message || 'Could not load clients.'); } finally { setBusy(false); } },
          variant: canContinueToClients && !busy ? 'default' : 'disabled',
        }}
        maxWidth={960}
        containerStyle={{ height: '80%' }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          <View className="px-6 pt-4 pb-3">
            <Text className="text-typography-muted text-xs">
              Header found on row {parsed.headerRowIndex + 1} · {parsed.totalDataRows} rows detected.
              {!nameMapped && <Text className="text-state-danger font-bold"> Map a Project Name column to continue.</Text>}
            </Text>
            {error && <Text className="text-state-danger text-xs font-bold mt-1">{error}</Text>}
          </View>
          <View className="px-6 pb-5" style={{ flexDirection: 'row', flex: 1, minHeight: 0, gap: 24 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Column Mapping</Text>
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>{mappingBody}</ScrollView>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">Preview</Text>
              {previewBody}
            </View>
          </View>
        </View>
      </Popup>
    );
  }

  if (wizStep === 'clients') {
    const attentionCount = ambiguousRows.length + blankRows.length;
    const body = (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
        {/* Needs-attention rows FIRST and unmissable — burying failures in a
            success count is exactly how #182 shipped 66 invisible tasks
            (plan §15.3). Rendered above the "ready" summary, not after it. */}
        {attentionCount > 0 && (
          <View style={{ gap: 8 }}>
            <Text className="text-state-warning text-[10px] font-black uppercase tracking-widest">
              Needs Your Input ({attentionCount})
            </Text>
            {ambiguousRows.map(row => {
              const m = matches.get(row.rowNumber);
              if (m?.kind !== 'ambiguous') return null;
              return (
                <AmbiguousRow
                  key={row.rowNumber}
                  row={row}
                  match={m}
                  decision={decisions.get(row.rowNumber)}
                  onDecide={d => setDecisions(prev => new Map(prev).set(row.rowNumber, d))}
                  c={c}
                />
              );
            })}
            {blankRows.length > 0 && (
              <View className="bg-surface-background border border-state-danger rounded-2xl p-3">
                <Text className="text-state-danger text-xs font-black">
                  {blankRows.length} row{blankRows.length === 1 ? '' : 's'} skipped — no name in the mapped column: rows {blankRows.map(r => r.rowNumber).join(', ')}.
                </Text>
              </View>
            )}
          </View>
        )}

        {unparsedDateRows.length > 0 && (
          <View className="bg-surface-background border border-surface-border rounded-2xl p-3">
            <Text className="text-typography-muted text-xs font-bold">
              {unparsedDateRows.length} row{unparsedDateRows.length === 1 ? '' : 's'} had a date cell that didn't parse — they'll use the batch schedule anchor instead: rows {unparsedDateRows.map(r => r.rowNumber).join(', ')}.
            </Text>
          </View>
        )}

        <View style={{ gap: 8 }}>
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">
            Ready ({readyRows.length})
          </Text>
          <View className="bg-surface-background border border-surface-border rounded-2xl p-3" style={{ gap: 4 }}>
            <Text className="text-typography-main text-xs font-bold">
              {readyRows.filter(r => matches.get(r.rowNumber)?.kind === 'ref').length} matched by client ref
            </Text>
            <Text className="text-typography-main text-xs font-bold">
              {readyRows.filter(r => matches.get(r.rowNumber)?.kind === 'exact_name').length} matched by exact name
            </Text>
            <Text className="text-typography-main text-xs font-bold">
              {newClientCount} new client{newClientCount === 1 ? '' : 's'} will be created
            </Text>
          </View>
        </View>
      </ScrollView>
    );

    const footer = (
      <View className="flex-row gap-3 px-5 py-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
        <TouchableOpacity onPress={() => setWizStep('mapping')} className="flex-1 py-3.5 rounded-2xl items-center" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
          <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setHandoff(true)}
          disabled={!canFinishClients}
          className="flex-[2] py-3.5 rounded-2xl items-center"
          style={{ backgroundColor: canFinishClients ? c.primary : c.border }}
        >
          <Text className="font-black uppercase tracking-widest text-xs" style={{ color: canFinishClients ? 'white' : c.textMuted }}>
            Continue to Configure ({finalRows.length})
          </Text>
        </TouchableOpacity>
      </View>
    );

    if (!isDesktop) {
      return (
        <DraggableSheet visible={visible} onClose={onClose} dimBackdrop maxHeight="95%" dismissible containerClassName="rounded-t-[2rem] overflow-hidden">
          <View style={{ flex: 1, minHeight: 0 }}>
            <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
              <View className="flex-1 mr-3">
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Step 2 of 2</Text>
                <Text className="text-typography-main text-xl font-black tracking-tight">Resolve Clients</Text>
              </View>
              <TouchableOpacity onPress={onClose} className="w-10 h-10 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                <FontAwesome name="times" size={16} color={c.textMain} />
              </TouchableOpacity>
            </View>
            <View className="flex-1 px-5">{body}</View>
            {footer}
          </View>
        </DraggableSheet>
      );
    }

    return (
      <Popup visible={visible} onClose={onClose} presentation="centered" title="Resolve Clients" footer="none" maxWidth={800} containerStyle={{ height: '80%' }}>
        <View style={{ flex: 1, minHeight: 0 }}>
          <View className="flex-1 px-6 pt-4">{body}</View>
          {footer}
        </View>
      </Popup>
    );
  }

  return null;
}
