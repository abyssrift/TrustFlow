// Spreadsheet intake wizard — issue #188 / #142 Phase 9 (plan §15, redesigned
// by §18).
//
// Scope (§15.1, hard constraint): this component ONLY produces a projects
// array + resolved client identities. It never inserts a client, project, or
// task — it hands off to the EXISTING BulkCreateProjectsSheet (extended with
// `initialRows`), which is the one caller of rpc_instantiate_template. The one
// thing it writes on its own is the §18.3 custom fields, and only AFTER that
// RPC has landed and told us which projects exist (see persistCustomFields).
//
// Steps: drop -> REVIEW (§18: every column, every warning, every enum value,
// nothing created yet) -> clients (§13.3 identity resolution) -> hands off to
// BulkCreateProjectsSheet with the confirmed rows.
//
// ── Why the review step exists (plan §18) ───────────────────────────────────
// The previous mapping step asked about four fields and showed nothing else.
// Against a real 22-column file that is not a confirmation, it is a rubber
// stamp on 18 invisible decisions: which columns were dropped, that "Expected
// date" is only 62% dates, that row 8 is a wrapped company name and not a
// company, that the stated TOTAL disagrees with its own components on row 4.
// Every one of those is now on screen BEFORE anything is written, and the
// unmatched ones block the Continue button — §18.3 is explicit that
// auto-creating an unmatched value is rejected, because a typo becoming a
// permanent duplicate is #182's 66-unreachable-tasks failure with a new face.
//
// File upload goes through the EXISTING UploadManagerContext (see
// BulkCreateProjectsSheet's getOrCreateStandingFolder + handleCreate) — this
// file only reads the dropped File's bytes client-side to parse it; it never
// uploads anything itself.

import BulkCreateProjectsSheet, {
  BlockerList, Hint, StepSpine, IMPORT_JOURNEY_STEPS, type Blocker,
} from '@/components/projects/BulkCreateProjectsSheet';
import Popup from '@/components/common/Popup';
import DraggableSheet from '@/components/common/DraggableSheet';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useToast } from '@/contexts/ToastContext';
import { useDropPulse, useFileDrop } from '@/hooks/useWebDnd';
import { computeSHA256 } from '@/lib/uploadHelpers';
import { supabase } from '@/lib/supabase';
import {
  parseSpreadsheetBytes,
  fetchExistingClients,
  resolveClientMatch,
  buildIntakeRows,
  classifyRowShapes,
  parseDateValue,
  parseMoneyCell,
  normalizeMatchKey,
  MAPPED_FIELD_LABELS,
  SpreadsheetIntakeError,
  type ParsedSpreadsheet,
  type ColumnMapping,
  type ColumnPrimitive,
  type DateOrder,
  type MappedField,
  type ExistingClient,
  type ClientMatch,
  type IntakeRow,
} from '@/lib/imports/spreadsheetIntake';
import {
  buildColumnDecisions,
  customFieldPlans,
  distinctColumnValues,
  matchEnumValues,
  summariseRowWarnings,
  detectSummaryRows,
  fieldTypeForPrimitive,
  slugifyFieldKey,
  cellToFieldValue,
  FIELD_TYPE_LABELS,
  type ColumnDecision,
  type ColumnTarget,
  type EnumValueMatch,
  type ExistingFieldDef,
  type FieldDataType,
} from '@/lib/imports/importPlan';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Animated, Platform, ScrollView, Text, TextInput,
  TouchableOpacity, useWindowDimensions, View,
} from 'react-native';

function useIsDesktop(): boolean {
  const { width } = useWindowDimensions();
  return width >= 768;
}

const MAPPED_FIELDS: MappedField[] = ['name', 'client_ref', 'client_external_ref', 'start_date'];
const FIELD_TYPES: FieldDataType[] = ['text', 'number', 'date', 'enum', 'boolean'];
const ACCEPT = '.xlsx,.xls,.csv';

const PRIMITIVE_LABELS: Record<ColumnPrimitive, string> = {
  email: 'Email', phone: 'Phone', date: 'Date', year: 'Year', money: 'Money',
  unique_id: 'Unique ID', enum: 'Choice', freetext: 'Text', empty: 'Empty', unknown: 'Unrecognised',
};
const PRIMITIVE_ICONS: Record<ColumnPrimitive, any> = {
  email: 'envelope', phone: 'phone', date: 'calendar', year: 'calendar-o', money: 'money',
  unique_id: 'key', enum: 'list-ul', freetext: 'font', empty: 'ban', unknown: 'question',
};

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

// ─── Step 2: the review ─────────────────────────────────────────────────────

/** What a column's target says in one chip. Colour carries the meaning: a
 *  concept is brand, a new field is info, a reused field is success, and
 *  `ignore` is danger because it is the only option that loses data. */
function TargetChip({ target, c }: { target: ColumnTarget; c: ReturnType<typeof useThemeColors> }) {
  const [label, tone] =
    target.kind === 'field' ? [MAPPED_FIELD_LABELS[target.field], c.primary] as const
    : target.kind === 'ignore' ? ['Not imported', c.danger] as const
    : [`${target.defId ? 'Field' : 'New field'} · ${FIELD_TYPE_LABELS[target.dataType]}`, target.defId ? c.success : c.info] as const;
  return (
    <View className="px-2 py-1 rounded-lg" style={{ backgroundColor: `${tone}1f`, borderWidth: 1, borderColor: `${tone}59` }}>
      <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: tone }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/**
 * One source column. Deliberately four pieces of information on two lines —
 * the header AS WRITTEN, what the content says it is with its coverage, a real
 * cell, and the target — because a review of 22 columns is only a review if
 * the user can scan it. A left rail in warning colour marks the ones whose
 * classification does not explain every cell.
 */
function ColumnRow({
  decision, mirrored, selected, onPress, c,
}: {
  decision: ColumnDecision;
  /** other concepts pointing at this same column ("also the client name") */
  mirrored: MappedField[];
  selected: boolean;
  onPress: () => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  const p = decision.profile;
  const tone = decision.lowConfidence ? c.warning : p.primitive === 'empty' ? c.textDim : c.success;
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row rounded-xl overflow-hidden"
      style={{
        backgroundColor: selected ? `${c.primary}14` : c.background,
        borderWidth: 1, borderColor: selected ? c.primary : c.border, minHeight: 48,
      }}
    >
      <View style={{ width: 3, backgroundColor: tone }} />
      <View className="flex-1 px-3 py-1.5" style={{ minWidth: 0 }}>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Text className="text-typography-dim text-[10px] font-black" style={{ width: 20 }}>{decision.index + 1}</Text>
          <Text className="text-typography-main text-xs font-bold flex-1" numberOfLines={1}>
            {p.header.trim() || `Column ${decision.index + 1}`}
          </Text>
          <TargetChip target={decision.target} c={c} />
        </View>
        <View className="flex-row items-center mt-0.5" style={{ gap: 8, paddingLeft: 28 }}>
          <FontAwesome name={PRIMITIVE_ICONS[p.primitive]} size={9} color={tone} />
          <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: tone }}>
            {PRIMITIVE_LABELS[p.primitive]}
            {p.filled > 0 && p.primitive !== 'empty' ? ` · ${Math.round(p.coverage * 100)}%` : ''}
          </Text>
          <Text className="text-typography-dim text-[10px] flex-1" numberOfLines={1}>
            {decision.sample ? `“${decision.sample}”` : 'no values'}
          </Text>
        </View>
        {mirrored.length > 0 && (
          <Text className="text-[10px] mt-1" style={{ color: c.primary, paddingLeft: 28 }} numberOfLines={1}>
            Also used as {mirrored.map(f => MAPPED_FIELD_LABELS[f]).join(' + ')}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

/** A tappable option in the target picker / type picker. */
function PickerOption({
  label, active, tone, onPress, c,
}: { label: string; active: boolean; tone?: string; onPress: () => void; c: ReturnType<typeof useThemeColors> }) {
  const accent = tone ?? c.primary;
  return (
    <TouchableOpacity
      onPress={onPress}
      className="px-3 rounded-lg"
      style={{
        minHeight: 36, justifyContent: 'center',
        backgroundColor: active ? accent : c.background,
        borderWidth: 1, borderColor: active ? accent : c.border,
      }}
    >
      <Text className="text-[11px] font-bold" style={{ color: active ? '#ffffff' : c.textMain }} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * §18.3's confirmation, one row per distinct source value.
 *
 * `matched === null` is the state that matters: it means the value corresponds
 * to nothing that exists, and it renders as a QUESTION with two answers, never
 * as a silent create. Case variants are listed under the value they merged
 * into — a merge the user cannot see is the same class of failure as a drop.
 */
function EnumValuePanel({
  matches, choices, hasCatalogue, onChoose, c,
}: {
  matches: EnumValueMatch[];
  choices: Record<string, 'create' | 'skip'>;
  /** true when the column is bound to a field that ALREADY has options — the
   *  case where an unmatched value would mean creating something permanent. */
  hasCatalogue: boolean;
  onChoose: (key: string, choice: 'create' | 'skip') => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  const unresolved = matches.filter(m => m.matched === null && !choices[m.key]).length;
  return (
    <View style={{ gap: 8 }}>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest flex-1">
          {hasCatalogue ? `Values (${matches.length})` : `Options to create (${matches.length})`}
        </Text>
        {unresolved > 0 && (
          <Text className="text-[10px] font-black uppercase" style={{ color: c.warning }}>{unresolved} unanswered</Text>
        )}
      </View>
      {matches.map(m => {
        const choice = choices[m.key];
        const settled = m.matched !== null || !!choice;
        return (
          <View
            key={m.key}
            className="rounded-xl px-3 py-2"
            style={{ backgroundColor: c.background, borderWidth: 1, borderColor: settled ? c.border : c.warning, gap: 6 }}
          >
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text className="text-typography-main text-xs font-bold flex-1" numberOfLines={1}>{m.label}</Text>
              <Text className="text-typography-dim text-[10px]">{m.count} row{m.count === 1 ? '' : 's'}</Text>
            </View>
            {m.spellings.length > 1 && (
              <Text className="text-[10px]" style={{ color: c.info }} numberOfLines={2}>
                {m.spellings.length} spellings merge here: {m.spellings.map(s => `“${s}”`).join(', ')}
              </Text>
            )}
            {m.matched !== null ? (
              <View className="flex-row items-center" style={{ gap: 6 }}>
                <FontAwesome name={hasCatalogue ? 'check-circle' : 'plus-circle'} size={10} color={hasCatalogue ? c.success : c.info} />
                <Text className="text-[10px] font-bold" style={{ color: hasCatalogue ? c.success : c.info }} numberOfLines={1}>
                  {!hasCatalogue
                    ? `Will be created as the option “${m.matched}”`
                    : m.fuzzy ? `Matches existing “${m.matched}” (different casing)` : `Matches existing “${m.matched}”`}
                </Text>
              </View>
            ) : (
              <>
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <FontAwesome name="question-circle" size={10} color={c.warning} />
                  <Text className="text-[10px] font-bold" style={{ color: c.warning }}>No match — nothing is created until you say so</Text>
                </View>
                <View className="flex-row" style={{ gap: 6 }}>
                  <PickerOption label="Add as a new option" active={choice === 'create'} onPress={() => onChoose(m.key, 'create')} c={c} />
                  <PickerOption label="Leave these blank" active={choice === 'skip'} tone={c.danger} onPress={() => onChoose(m.key, 'skip')} c={c} />
                </View>
              </>
            )}
          </View>
        );
      })}
    </View>
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

type WizStep = 'drop' | 'review' | 'clients';
type MobilePage = 'columns' | 'detail' | 'warnings';

export default function SpreadsheetImportSheet({
  visible, onClose, onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated?: (result: { portfolio_id: string; projects_created: number; tasks_created: number }) => void;
}) {
  const c = useThemeColors();
  const isDesktop = useIsDesktop();
  const { successToast, errorToast } = useToast();

  const [wizStep, setWizStep] = useState<WizStep>('drop');
  const [mobilePage, setMobilePage] = useState<MobilePage>('columns');

  const [file, setFile] = useState<File | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [parsed, setParsed] = useState<ParsedSpreadsheet | null>(null);

  // The review's editable state. `decisions` is the whole column plan; the
  // four mapped concepts are DERIVED from it (see `mapping` below) rather than
  // held separately, so a target the user changed and the rows downstream can
  // never disagree.
  const [decisions, setDecisions] = useState<ColumnDecision[]>([]);
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null);
  const [dateOrders, setDateOrders] = useState<Record<number, DateOrder>>({});
  const [enumChoices, setEnumChoices] = useState<Record<string, 'create' | 'skip'>>({});
  const [continuationChoices, setContinuationChoices] = useState<Record<number, 'skip' | 'import'>>({});

  const [existingClients, setExistingClients] = useState<ExistingClient[] | null>(null);
  const [decisionsClients, setDecisionsClients] = useState<Map<number, Decision>>(new Map());

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
    setMobilePage('columns');
    setFile(null);
    setContentHash(null);
    setBusy(false);
    setError(null);
    setParsed(null);
    setDecisions([]);
    setSelectedColumn(null);
    setDateOrders({});
    setEnumChoices({});
    setContinuationChoices({});
    setExistingClients(null);
    setDecisionsClients(new Map());
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
      // Field defs are OPTIONAL context: a company that has never imported has
      // none, and a deployment where the §18.3 migration has not landed yet
      // errors here. Neither is a reason to refuse the import — the review
      // simply proposes new fields instead of reusing saved ones.
      const [result, clients, defs] = await Promise.all([
        parseSpreadsheetBytes(bytes),
        fetchExistingClients(),
        supabase.from('project_field_defs')
          .select('id, key, label, data_type, enum_options, source_column')
          .is('deleted_at', null)
          .then(r => (r.data ?? []) as ExistingFieldDef[], () => [] as ExistingFieldDef[]),
      ]);

      setFile(f);
      setContentHash(hash);
      setParsed(result);
      setDecisions(buildColumnDecisions(result.profiles, result.mapping, result.aoa, result.headerRowIndex, defs));
      setSelectedColumn(result.mapping.name ?? 0);
      setExistingClients(clients);
      setWizStep('review');
    } catch (e: any) {
      setError(e instanceof SpreadsheetIntakeError ? e.message : (e?.message || 'Could not read this file.'));
    } finally {
      setBusy(false);
    }
  };

  // ── derived review state ──────────────────────────────────────────────────

  /** The four concepts, read back off the column plan. `client_ref` mirrors
   *  `name` when nothing else claims it — the convention BulkCreateProjectsSheet's
   *  paste path already relies on. */
  const mapping: ColumnMapping = useMemo(() => {
    const m: ColumnMapping = {};
    for (const d of decisions) if (d.target.kind === 'field') m[d.target.field] = d.index;
    if (m.client_ref === undefined && m.name !== undefined) m.client_ref = m.name;
    return m;
  }, [decisions]);

  const dateOrderFor = (col: number | undefined): DateOrder => {
    if (col === undefined) return 'DMY';
    return dateOrders[col] ?? decisions[col]?.profile.dateOrder ?? 'DMY';
  };

  const setTarget = (index: number, target: ColumnTarget) => {
    setDecisions(prev => prev.map(d => {
      // A concept maps to exactly ONE column. Claiming it here releases it
      // wherever it was, back to the custom-field default — never to `ignore`,
      // which would silently discard the column the user just re-pointed.
      if (d.index !== index && target.kind === 'field' && d.target.kind === 'field' && d.target.field === target.field) {
        const dataType = fieldTypeForPrimitive(d.profile.primitive, d.profile.enumValues);
        return {
          ...d,
          target: {
            kind: 'custom', defId: null,
            key: slugifyFieldKey(d.profile.header, d.index),
            label: d.profile.header.trim() || `Column ${d.index + 1}`,
            dataType,
            enumOptions: dataType === 'enum' ? (d.profile.enumValues ?? []).map(v => v.label) : null,
          },
        };
      }
      return d.index === index ? { ...d, target } : d;
    }));
  };

  const liveRows = useMemo(() => {
    if (!parsed) return [];
    return buildIntakeRows(parsed.aoa, parsed.headerRowIndex, mapping, dateOrderFor(mapping.start_date));
  }, [parsed, mapping, dateOrders]);

  const rowWarnings = useMemo(() => {
    if (!parsed) return { continuations: [], blankRowNumbers: [], summaries: [] };
    return summariseRowWarnings(
      classifyRowShapes(parsed.aoa, parsed.headerRowIndex, mapping.name),
      detectSummaryRows(parsed.aoa, parsed.headerRowIndex, mapping.name),
    );
  }, [parsed, mapping.name]);

  /** A continuation row is a wrapped cell and a `TOTAL` row is the file's own
   *  arithmetic — neither is a project. §18.4 forbids BOTH dropping them
   *  silently and importing them silently, so they are excluded by default,
   *  listed by row number, and one tap away from being included. */
  const summaryRowNumbers = useMemo(
    () => new Set(rowWarnings.summaries.map(s => s.rowNumber)),
    [rowWarnings],
  );
  const importableRows = useMemo(
    () => liveRows.filter(r =>
      (r.shape !== 'continuation' && !summaryRowNumbers.has(r.rowNumber)) ||
      continuationChoices[r.rowNumber] === 'import'),
    [liveRows, continuationChoices, summaryRowNumbers],
  );

  const brokenTotals = useMemo(
    () => (parsed?.relations ?? []).filter(
      (r): r is Extract<typeof r, { kind: 'total_of' }> => r.kind === 'total_of' && !r.reconciles,
    ),
    [parsed],
  );

  const ambiguousDateColumns = useMemo(
    () => decisions.filter(d => d.profile.dateOrder === 'ambiguous' && !dateOrders[d.index]),
    [decisions, dateOrders],
  );

  /**
   * Enum value matching, per column bound to a choice field.
   *
   * The catalogue is the EXISTING field's options when we are reusing one —
   * that is the case where an unmatched value would create something permanent
   * that outlives the import, and §18.3 says it must be asked about. For a
   * brand-new field the catalogue is the column's own values (they ARE the
   * options being proposed), so nothing is "unmatched"; the confirmation there
   * is the field itself, which the user is looking at.
   *
   * Either way the case-variant merge is shown: `spellings` lists every raw
   * spelling that collapsed, so "Fadi haddad" folding into "Fadi Haddad" is a
   * visible decision, not a silent one (§18.5 #5).
   */
  const enumMatchesFor = (index: number): EnumValueMatch[] => {
    const d = decisions[index];
    if (!parsed || !d || d.target.kind !== 'custom' || d.target.dataType !== 'enum') return [];
    const values = distinctColumnValues(parsed.aoa, parsed.headerRowIndex, index);
    return matchEnumValues(values, d.target.defId ? (d.target.enumOptions ?? []) : values.map(v => v.label));
  };

  const unresolvedEnums = useMemo(() => {
    let n = 0;
    for (const d of decisions) {
      if (d.target.kind !== 'custom' || d.target.dataType !== 'enum') continue;
      for (const m of enumMatchesFor(d.index)) {
        if (m.matched === null && !enumChoices[`${d.index}::${m.key}`]) n++;
      }
    }
    return n;
  }, [decisions, enumChoices, parsed]);

  const fieldPlans = useMemo(() => customFieldPlans(decisions), [decisions]);
  const ignoredCount = decisions.filter(d => d.target.kind === 'ignore').length;
  const lowConfidenceCount = decisions.filter(d => d.lowConfidence && d.target.kind !== 'ignore').length;
  const nameMapped = mapping.name !== undefined;
  const canContinueToClients = nameMapped && unresolvedEnums === 0 && importableRows.length > 0;

  /** Jump to a column's editor from wherever the message about it appeared —
   *  on mobile that means switching page too, because the columns list and the
   *  warnings live on separate pages of the drill-in (§19.1: the remedy has to
   *  be reachable FROM the message, and "open the column" is not reachable if
   *  the message never says which one or takes you there). */
  const openColumn = (index: number) => { setSelectedColumn(index); setMobilePage('detail'); };

  /** The columns that still hold an unanswered value, so the message can name
   *  them and hand over a way in rather than saying "open the column". */
  const columnsWithUnresolvedEnums = useMemo(() => {
    const out: { index: number; header: string; count: number }[] = [];
    for (const d of decisions) {
      if (d.target.kind !== 'custom' || d.target.dataType !== 'enum') continue;
      const count = enumMatchesFor(d.index).filter(m => m.matched === null && !enumChoices[`${d.index}::${m.key}`]).length;
      if (count > 0) out.push({ index: d.index, header: d.profile.header.trim() || `Column ${d.index + 1}`, count });
    }
    return out;
  }, [decisions, enumChoices, parsed]);

  /** Columns that could plausibly name a project, best first — the remedy for
   *  "no project name column", offered as one tap instead of an instruction. */
  const nameCandidates = useMemo(
    () => decisions
      .filter(d => d.profile.primitive === 'freetext' || d.profile.primitive === 'enum' || d.profile.primitive === 'unique_id')
      .sort((a, b) => b.profile.distinct - a.profile.distinct)
      .slice(0, 4),
    [decisions],
  );

  const reviewBlockers = useMemo<Blocker[]>(() => {
    const out: Blocker[] = [];
    if (!nameMapped) {
      out.push({
        field: 'Project name',
        reason: 'No column is naming the projects yet, and a project cannot be created without a name.',
      });
    }
    if (columnsWithUnresolvedEnums.length > 0) {
      const total = columnsWithUnresolvedEnums.reduce((n, x) => n + x.count, 0);
      const first = columnsWithUnresolvedEnums[0];
      out.push({
        field: `“${first.header}”`,
        reason: `${total} value${total === 1 ? '' : 's'} in ${columnsWithUnresolvedEnums.length === 1 ? 'this column' : `${columnsWithUnresolvedEnums.length} columns`} match nothing that exists. Say whether each is a new option or should be left blank — nothing is created on your behalf.`,
        action: { label: 'Answer them', onPress: () => openColumn(first.index) },
      });
    }
    if (nameMapped && importableRows.length === 0) {
      // Previously silent: with every row excluded the button simply went grey
      // and said nothing at all.
      out.push({
        field: 'Rows',
        reason: liveRows.length === 0
          ? 'The name column is empty on every row below the header, so there is nothing to import. Try a different column.'
          : `All ${liveRows.length} rows were set aside as wrapped, total or blank rows. Mark at least one “Import anyway” to continue.`,
      });
    }
    return out;
  }, [nameMapped, columnsWithUnresolvedEnums, importableRows.length, liveRows.length]);

  // ── clients step ──────────────────────────────────────────────────────────

  const matches = useMemo(() => {
    if (!existingClients) return new Map<number, ClientMatch>();
    const out = new Map<number, ClientMatch>();
    importableRows.forEach(row => out.set(row.rowNumber, resolveClientMatch(row, existingClients)));
    return out;
  }, [importableRows, existingClients]);

  const ambiguousRows = useMemo(
    () => importableRows.filter(r => matches.get(r.rowNumber)?.kind === 'ambiguous'),
    [importableRows, matches],
  );
  const blankRows = useMemo(() => importableRows.filter(r => matches.get(r.rowNumber)?.kind === 'blank'), [importableRows, matches]);
  const unparsedDateRows = useMemo(() => importableRows.filter(r => !r.start_date && r.start_date_raw), [importableRows]);
  const readyRows = useMemo(
    () => importableRows.filter(r => { const m = matches.get(r.rowNumber); return m && m.kind !== 'ambiguous' && m.kind !== 'blank'; }),
    [importableRows, matches],
  );

  const allAmbiguousDecided = ambiguousRows.every(r => decisionsClients.has(r.rowNumber));

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
        return { raw: `row-${row.rowNumber}`, name: row.name, client_ref: clientRef || row.name, start_date: row.start_date, external_ref: externalRef };
      })
      .concat(
        ambiguousRows.map(row => {
          const d = decisionsClients.get(row.rowNumber);
          const clientRef = d?.kind === 'existing' ? d.client.name : row.client_ref;
          const externalRef = d?.kind === 'existing' ? d.client.external_ref : row.client_external_ref;
          return { raw: `row-${row.rowNumber}`, name: row.name, client_ref: clientRef || row.name, start_date: row.start_date, external_ref: externalRef };
        }),
      );
  }, [readyRows, ambiguousRows, matches, decisionsClients]);

  // finalRows.length was never checked: with every row blank in the name
  // column, Continue stayed enabled, handed an empty array to
  // BulkCreateProjectsSheet, and THAT step went grey with no message — a dead
  // end one screen downstream of its cause.
  const canFinishClients = allAmbiguousDecided && finalRows.length > 0;

  const clientBlockers = useMemo<Blocker[]>(() => {
    const out: Blocker[] = [];
    const undecided = ambiguousRows.filter(r => !decisionsClients.has(r.rowNumber));
    if (undecided.length > 0) {
      out.push({
        field: 'Client identity',
        reason: `Row${undecided.length === 1 ? '' : 's'} ${undecided.slice(0, 5).map(r => r.rowNumber).join(', ')}${undecided.length > 5 ? `, +${undecided.length - 5} more` : ''} match more than one existing client. Pick which one above — or say it is a new client.`,
      });
    }
    if (finalRows.length === 0) {
      out.push({
        field: 'Rows',
        reason: blankRows.length > 0
          ? `All ${blankRows.length} rows are blank in the column currently mapped as the project name, so there is nothing left to create.`
          : 'No rows survived to this step.',
        action: { label: 'Change the name column', onPress: () => { setWizStep('review'); setMobilePage('columns'); } },
      });
    }
    return out;
  }, [ambiguousRows, decisionsClients, finalRows.length, blankRows.length]);

  const newClientCount = useMemo(
    () => [...readyRows, ...ambiguousRows].filter(r => {
      const m = matches.get(r.rowNumber);
      if (m?.kind === 'new') return true;
      return decisionsClients.get(r.rowNumber)?.kind === 'new';
    }).length,
    [readyRows, ambiguousRows, matches, decisionsClients],
  );

  // ── §18.3 custom fields, written AFTER the projects exist ──────────────────

  /**
   * "Nothing is discarded" is only true if the carried columns actually land.
   * rpc_instantiate_template has no concept of a custom field, so the values
   * are written in a second step, keyed off the portfolio it just created.
   *
   * Deliberately best-effort and reported: the projects are already committed
   * by the time this runs, so throwing here would strand a successful import
   * behind an error dialog. A failure toasts with the field count so it is
   * visible and retryable by hand, and never silently swallowed (see
   * `.agents/rules/global-utilities-index.md` on lib/toast).
   */
  const persistCustomFields = async (portfolioId: string) => {
    if (!parsed || fieldPlans.length === 0) return;
    const { data: projectRows, error: projErr } = await supabase
      .from('projects').select('id, name').eq('portfolio_id', portfolioId);
    if (projErr || !projectRows?.length) return;
    const idByName = new Map(projectRows.map((p: any) => [p.name, p.id as string]));

    const saved: { plan: typeof fieldPlans[number]; id: string; canonical: Map<string, string | null> }[] = [];
    for (const [i, plan] of fieldPlans.entries()) {
      // For an enum, the options are only the values the user confirmed — an
      // unmatched value the user chose to skip must not become an option, and
      // a value written into a column must be one of them (the DB enforces it).
      let canonical = new Map<string, string | null>();
      let options = plan.enumOptions;
      if (plan.dataType === 'enum') {
        const ms = enumMatchesFor(plan.columnIndex);
        const opts = new Set<string>(plan.defId ? (plan.enumOptions ?? []) : []);
        for (const m of ms) {
          const choice = enumChoices[`${plan.columnIndex}::${m.key}`];
          if (m.matched !== null) canonical.set(m.key, m.matched);
          else if (!plan.defId || choice === 'create') { canonical.set(m.key, m.label); opts.add(m.label); }
          else canonical.set(m.key, null);
        }
        options = [...opts];
        if (options.length === 0) continue; // an enum with no options is unsaveable — skip the column rather than error
      }
      const { data, error: defErr } = await supabase.rpc('rpc_save_project_field_def', {
        p_key: plan.key, p_label: plan.label, p_data_type: plan.dataType,
        p_enum_options: options, p_source_column: plan.sourceColumn,
        p_sort_order: i, p_id: plan.defId,
      });
      if (defErr) throw defErr;
      saved.push({ plan, id: (data as any).id as string, canonical });
    }

    const values: { project_id: string; field_def_id: string; value: string | number | boolean }[] = [];
    for (const row of importableRows) {
      const projectId = idByName.get(row.name);
      if (!projectId) continue;
      const sheetRow = parsed.aoa[row.rowNumber - 1] || [];
      for (const { plan, id, canonical } of saved) {
        const raw = sheetRow[plan.columnIndex];
        let value = cellToFieldValue(
          raw, plan.dataType,
          cell => parseDateValue(cell, dateOrderFor(plan.columnIndex)),
          parseMoneyCell,
        );
        if (plan.dataType === 'enum' && value !== null) {
          value = canonical.get(normalizeMatchKey(String(value))) ?? null;
        }
        if (value !== null) values.push({ project_id: projectId, field_def_id: id, value });
      }
    }
    if (values.length === 0) return;
    const { error: valErr } = await supabase.rpc('rpc_set_project_field_values', { p_values: values });
    if (valErr) throw valErr;
    successToast(`${saved.length} extra column${saved.length === 1 ? '' : 's'} carried across as project fields.`, 'Import complete');
  };

  // ── render ────────────────────────────────────────────────────────────────

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
        onCreated={async res => {
          try {
            await persistCustomFields(res.portfolio_id);
          } catch (e: any) {
            errorToast(
              `${fieldPlans.length} extra column${fieldPlans.length === 1 ? '' : 's'} could not be saved as project fields: ${e?.message ?? 'unknown error'}. The projects were created.`,
              'Custom fields not saved',
            );
          }
          onCreated?.(res);
        }}
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
          <StepSpine steps={IMPORT_JOURNEY_STEPS} current={0} isDesktop={isDesktop} c={c} />
          <DropZone onFile={handleFile} busy={busy} />
          {error && <Text className="text-state-danger text-xs font-bold">{error}</Text>}
          <Text className="text-typography-dim text-[10px] text-center">
            We read the cells, not just the headers — then show you every column, every warning and every value we could not
            match, before anything is created. Five steps, and nothing exists until the last one.
          </Text>
        </View>
      </Popup>
    );
  }

  // ─── REVIEW ────────────────────────────────────────────────────────────────
  if (wizStep === 'review' && parsed) {
    const selected = selectedColumn !== null ? decisions[selectedColumn] : undefined;
    const selectedEnumMatches = selected && selected.target.kind === 'custom' && selected.target.dataType === 'enum'
      ? enumMatchesFor(selected.index) : [];

    const ambiguousDateSample = (col: number): string => {
      for (let r = parsed.headerRowIndex + 1; r < parsed.aoa.length; r++) {
        const s = String((parsed.aoa[r] || [])[col] ?? '').trim();
        if (/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(s)) return s;
      }
      return '';
    };

    const mirroredFor = (index: number): MappedField[] => {
      const t = decisions[index]?.target;
      const own = t && t.kind === 'field' ? t.field : null;
      return MAPPED_FIELDS.filter(f => mapping[f] === index && f !== own);
    };

    const summaryChips = (
      <View className="flex-row flex-wrap" style={{ gap: 6 }}>
        {[
          { label: `${decisions.length} columns`, tone: c.textMuted },
          { label: `${importableRows.length} rows`, tone: c.textMuted },
          { label: `${fieldPlans.length} project field${fieldPlans.length === 1 ? '' : 's'}`, tone: c.info },
          ...(lowConfidenceCount > 0 ? [{ label: `${lowConfidenceCount} need a look`, tone: c.warning }] : []),
          ...(ignoredCount > 0 ? [{ label: `${ignoredCount} not imported`, tone: c.danger }] : []),
        ].map(chip => (
          <View key={chip.label} className="px-2 py-1 rounded-lg" style={{ backgroundColor: `${chip.tone}1f` }}>
            <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: chip.tone }}>{chip.label}</Text>
          </View>
        ))}
      </View>
    );

    // ── warnings band. Rendered ABOVE the columns, never below and never in a
    //    collapsed accordion: burying a failure under a success count is
    //    exactly how #182 shipped 66 invisible tasks (§15.3).
    //
    //    `flex: 1` makes the cards share a ROW on desktop and is exactly wrong
    //    in the mobile COLUMN, where it makes them share a height and overlap
    //    — the reason this is branched rather than one style.
    const cardLayout = isDesktop ? { flex: 1, minWidth: 280 } : { alignSelf: 'stretch' as const };
    const warningCards: React.ReactNode[] = [];
    if (!nameMapped) {
      // §19.1: "pick which column names the projects" named the field and the
      // reason and then left the user to find the control. The likeliest
      // candidates are right here now, one tap each.
      warningCards.push(
        <View key="noname" className="rounded-2xl p-3" style={[{ backgroundColor: c.background, borderWidth: 1, borderColor: c.danger, gap: 8 }, cardLayout]}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <FontAwesome name="exclamation-triangle" size={11} color={c.danger} />
            <Text className="text-typography-main text-xs font-black flex-1">No project name column</Text>
          </View>
          <Text className="text-typography-muted text-[10px]">
            Every project needs a name, and no column is supplying one. Pick the column holding the client or engagement
            name — these have the most distinct values, so they are the likeliest:
          </Text>
          <View className="flex-row flex-wrap" style={{ gap: 6 }}>
            {nameCandidates.length === 0
              ? <Text className="text-typography-dim text-[10px]">No text column found — open any column on the left and set it to Project name.</Text>
              : nameCandidates.map(d => (
                <PickerOption
                  key={d.index}
                  label={`${d.profile.header.trim() || `Column ${d.index + 1}`} (${d.profile.distinct})`}
                  active={false}
                  onPress={() => setTarget(d.index, { kind: 'field', field: 'name' })}
                  c={c}
                />
              ))}
          </View>
        </View>,
      );
    }
    for (const t of brokenTotals) {
      warningCards.push(
        <WarningCard key={`total-${t.total}`} tone={c.warning} icon="calculator" title={`“${decisions[t.total]?.profile.header.trim()}” does not add up`}
          body={`On row${t.mismatchRowNumbers.length === 1 ? '' : 's'} ${t.mismatchRowNumbers.slice(0, 12).join(', ')}${t.mismatchRowNumbers.length > 12 ? `, +${t.mismatchRowNumbers.length - 12} more` : ''}, ${decisions[t.components[0]]?.profile.header.trim()} + … does not equal the stated total. Both are imported exactly as written — we never rewrite a number.`}
          layout={cardLayout} c={c} />,
      );
    }
    if (rowWarnings.continuations.length > 0) {
      warningCards.push(
        <View key="cont" className="rounded-2xl p-3" style={[{ backgroundColor: c.background, borderWidth: 1, borderColor: c.warning, gap: 8 }, cardLayout]}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <FontAwesome name="level-down" size={11} color={c.warning} />
            <Text className="text-typography-main text-xs font-black flex-1">
              {rowWarnings.continuations.length} wrapped row{rowWarnings.continuations.length === 1 ? '' : 's'}
            </Text>
          </View>
          <Text className="text-typography-muted text-[10px]">
            Only the name cell is filled — this looks like the tail of the row above it, not its own project. Excluded unless you say otherwise.
          </Text>
          {rowWarnings.continuations.map(w => (
            <View key={w.rowNumber} className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
              {/* flexBasis, not flex-1 — at 390px the row must wrap the buttons
                  onto their own line instead of truncating away "(continues row N)",
                  which is the half of the sentence that explains the warning. */}
              <Text className="text-typography-main text-[11px] font-bold" style={{ flexGrow: 1, flexBasis: 210 }} numberOfLines={2}>
                Row {w.rowNumber}: “{w.text}” (continues row {w.continuesRowNumber})
              </Text>
              <PickerOption label="Skip" active={(continuationChoices[w.rowNumber] ?? 'skip') === 'skip'}
                onPress={() => setContinuationChoices(p => ({ ...p, [w.rowNumber]: 'skip' }))} c={c} />
              <PickerOption label="Import anyway" active={continuationChoices[w.rowNumber] === 'import'}
                onPress={() => setContinuationChoices(p => ({ ...p, [w.rowNumber]: 'import' }))} c={c} />
            </View>
          ))}
        </View>,
      );
    }
    if (rowWarnings.summaries.length > 0) {
      warningCards.push(
        <View key="summary" className="rounded-2xl p-3" style={[{ backgroundColor: c.background, borderWidth: 1, borderColor: c.warning, gap: 8 }, cardLayout]}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <FontAwesome name="calculator" size={11} color={c.warning} />
            <Text className="text-typography-main text-xs font-black flex-1">
              {rowWarnings.summaries.length} total row{rowWarnings.summaries.length === 1 ? '' : 's'}
            </Text>
          </View>
          <Text className="text-typography-muted text-[10px]">
            The name cell reads as the file's own arithmetic, not a client. Imported, it becomes a project called “{rowWarnings.summaries[0].text}”. Excluded unless you say otherwise.
          </Text>
          {rowWarnings.summaries.map(s => (
            <View key={s.rowNumber} className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
              <Text className="text-typography-main text-[11px] font-bold" style={{ flexGrow: 1, flexBasis: 210 }} numberOfLines={2}>
                Row {s.rowNumber}: “{s.text}”
              </Text>
              <PickerOption label="Skip" active={(continuationChoices[s.rowNumber] ?? 'skip') === 'skip'}
                onPress={() => setContinuationChoices(p => ({ ...p, [s.rowNumber]: 'skip' }))} c={c} />
              <PickerOption label="Import anyway" active={continuationChoices[s.rowNumber] === 'import'}
                onPress={() => setContinuationChoices(p => ({ ...p, [s.rowNumber]: 'import' }))} c={c} />
            </View>
          ))}
        </View>,
      );
    }
    if (rowWarnings.blankRowNumbers.length > 0) {
      warningCards.push(
        <WarningCard key="blank" tone={c.textMuted} icon="minus" title={`${rowWarnings.blankRowNumbers.length} blank separator row${rowWarnings.blankRowNumbers.length === 1 ? '' : 's'}`}
          body={rowWarnings.blankRowNumbers.length === 1
            ? `Row ${rowWarnings.blankRowNumbers[0]} is empty — treated as layout, not data, and not imported.`
            : `Rows ${rowWarnings.blankRowNumbers.slice(0, 12).join(', ')}${rowWarnings.blankRowNumbers.length > 12 ? `, +${rowWarnings.blankRowNumbers.length - 12} more` : ''} are empty — treated as layout, not data, and not imported.`}
          layout={cardLayout} c={c} />,
      );
    }
    for (const d of ambiguousDateColumns) {
      warningCards.push(
        <View key={`dord-${d.index}`} className="rounded-2xl p-3" style={[{ backgroundColor: c.background, borderWidth: 1, borderColor: c.warning, gap: 8 }, cardLayout]}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <FontAwesome name="calendar" size={11} color={c.warning} />
            <Text className="text-typography-main text-xs font-black flex-1" numberOfLines={1}>
              “{d.profile.header.trim()}” — day or month first?
            </Text>
          </View>
          <Text className="text-typography-muted text-[10px]">
            {(() => {
              // The FIRST value is not necessarily a slash-date ("Expected date"
              // opens with prose) — quote a cell the question actually applies to.
              const s = ambiguousDateSample(d.index);
              return s
                ? `Nothing in this column is over 12, so “${s}” reads either way. Answered once for the column, not guessed per row.`
                : 'Nothing in this column is over 12, so both readings are possible. Answered once for the column, not guessed per row.';
            })()}
          </Text>
          <View className="flex-row" style={{ gap: 6 }}>
            <PickerOption label="Day / Month" active={false} onPress={() => setDateOrders(p => ({ ...p, [d.index]: 'DMY' }))} c={c} />
            <PickerOption label="Month / Day" active={false} onPress={() => setDateOrders(p => ({ ...p, [d.index]: 'MDY' }))} c={c} />
          </View>
        </View>,
      );
    }
    if (columnsWithUnresolvedEnums.length > 0) {
      // Was: "Open the column and say whether each one is a new option" — which
      // column? The card now names them and opens them (§19.1).
      warningCards.push(
        <View key="enums" className="rounded-2xl p-3" style={[{ backgroundColor: c.background, borderWidth: 1, borderColor: c.warning, gap: 8 }, cardLayout]}>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <FontAwesome name="question-circle" size={11} color={c.warning} />
            <Text className="text-typography-main text-xs font-black flex-1">
              {unresolvedEnums} unmatched value{unresolvedEnums === 1 ? '' : 's'}
            </Text>
          </View>
          <Text className="text-typography-muted text-[10px]">
            These values correspond to nothing that exists yet. Each needs one answer — a new option, or left blank.
            Nothing is created on your behalf.
          </Text>
          <View className="flex-row flex-wrap" style={{ gap: 6 }}>
            {columnsWithUnresolvedEnums.map(x => (
              <PickerOption key={x.index} label={`${x.header} · ${x.count}`} active={false} onPress={() => openColumn(x.index)} c={c} />
            ))}
          </View>
        </View>,
      );
    }

    const columnList = (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 12 }}>
        {decisions.map(d => (
          <ColumnRow
            key={d.index}
            decision={d}
            mirrored={mirroredFor(d.index)}
            selected={selectedColumn === d.index}
            onPress={() => openColumn(d.index)}
            c={c}
          />
        ))}
      </ScrollView>
    );

    const detailPane = selected ? (
      <ColumnDetail
        decision={selected}
        mapping={mapping}
        enumMatches={selectedEnumMatches}
        enumChoices={enumChoices}
        dateOrder={dateOrderFor(selected.index)}
        onSetTarget={t => setTarget(selected.index, t)}
        onSetDateOrder={o => setDateOrders(p => ({ ...p, [selected.index]: o }))}
        onChooseEnum={(key, choice) => setEnumChoices(p => ({ ...p, [`${selected.index}::${key}`]: choice }))}
        c={c}
      />
    ) : (
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-typography-dim text-xs text-center">Pick a column on the left to change what it becomes.</Text>
      </View>
    );

    const goToClients = async () => {
      setBusy(true); setError(null);
      try {
        const cl = existingClients ?? await fetchExistingClients();
        setExistingClients(cl);
        setWizStep('clients');
      } catch (e: any) { setError(e?.message || 'Could not load clients.'); }
      finally { setBusy(false); }
    };

    // ── mobile (< 768px): the same review, drilled in. `.web.tsx` files render
    //    at every width, so this branch is what a 390px browser gets too.
    if (!isDesktop) {
      return (
        <DraggableSheet visible={visible} onClose={onClose} dimBackdrop maxHeight="95%" dismissible scrollable={false} containerClassName="rounded-t-[2rem] overflow-hidden">
          <View style={{ flex: 1, minHeight: 0 }}>
            <View className="flex-row items-center justify-between px-5 pt-3 pb-3">
              <View className="flex-1 mr-3" style={{ gap: 6 }}>
                <StepSpine steps={IMPORT_JOURNEY_STEPS} current={1} isDesktop={false} c={c} />
                <Text className="text-typography-main text-xl font-black tracking-tight" numberOfLines={1}>
                  {mobilePage === 'detail' ? (selected?.profile.header.trim() || 'Column') : mobilePage === 'warnings' ? 'Warnings' : 'Review Import'}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} className="w-10 h-10 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                <FontAwesome name="times" size={16} color={c.textMain} />
              </TouchableOpacity>
            </View>

            {mobilePage !== 'columns' ? (
              <>
                <View className="flex-row items-center px-4 pb-2">
                  <TouchableOpacity onPress={() => setMobilePage('columns')} className="flex-row items-center rounded-full px-3" style={{ minHeight: 36, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, gap: 6 }}>
                    <FontAwesome name="chevron-left" size={11} color={c.textMain} />
                    <Text className="text-typography-main text-[11px] font-bold">All columns</Text>
                  </TouchableOpacity>
                </View>
                <View className="flex-1 px-4" style={{ minHeight: 0 }}>
                  {mobilePage === 'warnings' ? (
                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20, gap: 10 }}>
                      {warningCards.length > 0 ? warningCards : <Text className="text-typography-dim text-xs">Nothing needs your attention.</Text>}
                    </ScrollView>
                  ) : detailPane}
                </View>
              </>
            ) : (
              <>
                <View className="px-4 pb-2" style={{ gap: 8 }}>
                  <Text className="text-typography-muted text-[11px]">
                    Header on row {parsed.headerRowIndex + 1}. Every column below is kept — as a project concept or as a new field.
                  </Text>
                  <Hint>
                    A <Text className="font-black">project field</Text> is a column this product has no concept for
                    (&quot;Inventory Count&quot;), stored on every project it came from and searchable afterwards.
                    Nothing has been created yet — this whole step is a proposal.
                  </Hint>
                  {summaryChips}
                  {warningCards.length > 0 && (
                    <TouchableOpacity onPress={() => setMobilePage('warnings')} className="flex-row items-center rounded-xl px-3"
                      style={{ minHeight: 44, backgroundColor: `${c.warning}1f`, borderWidth: 1, borderColor: c.warning, gap: 8 }}>
                      <FontAwesome name="exclamation-triangle" size={12} color={c.warning} />
                      <Text className="text-xs font-black flex-1" style={{ color: c.warning }}>
                        {warningCards.length} thing{warningCards.length === 1 ? '' : 's'} to check
                      </Text>
                      <FontAwesome name="chevron-right" size={11} color={c.warning} />
                    </TouchableOpacity>
                  )}
                </View>
                <View className="flex-1 px-4">{columnList}</View>
              </>
            )}

            <View className="px-4 pt-2" style={{ gap: 8 }}>
              <BlockerList blockers={reviewBlockers} c={c} />
            </View>
            <View className="flex-row gap-3 px-4 py-3" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
              <TouchableOpacity onPress={onClose} className="flex-1 py-3.5 rounded-2xl items-center" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
                <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goToClients} disabled={!canContinueToClients || busy} className="flex-[2] py-3.5 rounded-2xl items-center"
                style={{ backgroundColor: canContinueToClients && !busy ? c.primary : c.border }}>
                <Text className="font-black uppercase tracking-widest text-xs" style={{ color: canContinueToClients && !busy ? 'white' : c.textMuted }}>
                  {busy ? 'Loading…' : `Next: Clients · ${importableRows.length}`}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </DraggableSheet>
      );
    }

    // ── desktop: a full-width review. 22 columns each with several controls is
    //    the exact case ux-consistency.md's density rule is about — warnings
    //    band across the top, then the column list and the selected column's
    //    editor side by side, each with its own scroll.
    return (
      <Popup
        visible={visible}
        onClose={onClose}
        presentation="centered"
        title="Review Import"
        footer="none"
        maxWidth={1400}
        containerStyle={{ height: '92%' }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          <View className="px-6 pt-4 pb-3" style={{ gap: 8, borderBottomWidth: 1, borderBottomColor: c.border }}>
            <StepSpine steps={IMPORT_JOURNEY_STEPS} current={1} isDesktop c={c} />
            <View className="flex-row items-center flex-wrap" style={{ gap: 10 }}>
              <Text className="text-typography-muted text-xs">
                {file?.name} · header on row {parsed.headerRowIndex + 1}
              </Text>
              {summaryChips}
            </View>
            <Text className="text-typography-dim text-[11px]">
              Nothing has been created yet. Every column is kept — as one of this product&apos;s concepts, or as a{' '}
              <Text className="font-black">project field</Text>: a column this product has no concept for
              (&quot;Inventory Count&quot;), stored on every project it came from and searchable afterwards.
              Change any of them before continuing.
            </Text>
            {error && <Text className="text-state-danger text-xs font-bold">{error}</Text>}
          </View>

          {warningCards.length > 0 && (
            <View className="px-6 pt-3">
              <View className="flex-row flex-wrap" style={{ gap: 10 }}>{warningCards}</View>
            </View>
          )}

          <View className="px-6 pt-3 pb-4" style={{ flexDirection: 'row', flex: 1, minHeight: 0, gap: 24 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">
                Source Columns ({decisions.length})
              </Text>
              {columnList}
            </View>
            <View style={{ width: 460, minWidth: 0, borderLeftWidth: 1, borderLeftColor: c.border, paddingLeft: 24 }}>
              {detailPane}
            </View>
          </View>

          <View className="px-6 pt-3" style={{ gap: 8 }}>
            <BlockerList blockers={reviewBlockers} c={c} />
          </View>
          <View className="flex-row items-center gap-3 px-6 py-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            <Text className="text-typography-dim text-[11px] flex-1">
              {importableRows.length} project{importableRows.length === 1 ? '' : 's'} · {fieldPlans.length} field{fieldPlans.length === 1 ? '' : 's'}
              {ignoredCount > 0 ? ` · ${ignoredCount} column${ignoredCount === 1 ? '' : 's'} will not be imported` : ''}
            </Text>
            <TouchableOpacity onPress={onClose} className="px-5 py-3 rounded-2xl items-center" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, minHeight: 44, justifyContent: 'center' }}>
              <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={goToClients} disabled={!canContinueToClients || busy} className="px-6 py-3 rounded-2xl items-center"
              style={{ backgroundColor: canContinueToClients && !busy ? c.primary : c.border, minHeight: 44, justifyContent: 'center' }}>
              <Text className="font-black uppercase tracking-widest text-xs" style={{ color: canContinueToClients && !busy ? 'white' : c.textMuted }}>
                {busy ? 'Loading…' : 'Next: Clients'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Popup>
    );
  }

  // ─── CLIENTS ───────────────────────────────────────────────────────────────
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
                  decision={decisionsClients.get(row.rowNumber)}
                  onDecide={d => setDecisionsClients(prev => new Map(prev).set(row.rowNumber, d))}
                  c={c}
                />
              );
            })}
            {blankRows.length > 0 && (
              <View className="bg-surface-background rounded-2xl p-3" style={{ borderWidth: 1, borderColor: c.warning, gap: 8 }}>
                <Text className="text-typography-main text-xs font-black">
                  {blankRows.length} row{blankRows.length === 1 ? '' : 's'} will not be imported
                </Text>
                <Text className="text-typography-muted text-[10px]">
                  Rows {blankRows.map(r => r.rowNumber).join(', ')} are empty in
                  “{decisions[mapping.name as number]?.profile.header.trim() || 'the name column'}”, the column currently
                  supplying project names. If the names are in a different column, change it and they come back.
                </Text>
                <View className="flex-row" style={{ gap: 6 }}>
                  <PickerOption label="Change the name column" active={false}
                    onPress={() => { setWizStep('review'); setMobilePage('columns'); }} c={c} />
                </View>
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
            <Text className="text-typography-muted text-xs">
              {fieldPlans.length} extra column{fieldPlans.length === 1 ? '' : 's'} will be carried across as project fields
            </Text>
          </View>
        </View>
      </ScrollView>
    );

    const footer = (
      <>
        <View className="px-5 pt-3">
          <BlockerList blockers={clientBlockers} c={c} />
        </View>
        <View className="flex-row gap-3 px-5 py-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
          <TouchableOpacity onPress={() => setWizStep('review')} className="flex-1 py-3.5 rounded-2xl items-center" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
            <Text className="font-black uppercase tracking-widest text-xs" style={{ color: c.textMuted }}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setHandoff(true)}
            disabled={!canFinishClients}
            className="flex-[2] py-3.5 rounded-2xl items-center"
            style={{ backgroundColor: canFinishClients ? c.primary : c.border }}
          >
            <Text className="font-black uppercase tracking-widest text-xs" style={{ color: canFinishClients ? 'white' : c.textMuted }}>
              Next: Template ({finalRows.length})
            </Text>
          </TouchableOpacity>
        </View>
      </>
    );

    if (!isDesktop) {
      return (
        <DraggableSheet visible={visible} onClose={onClose} dimBackdrop maxHeight="95%" dismissible containerClassName="rounded-t-[2rem] overflow-hidden">
          <View style={{ flex: 1, minHeight: 0 }}>
            <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
              <View className="flex-1 mr-3" style={{ gap: 6 }}>
                <StepSpine steps={IMPORT_JOURNEY_STEPS} current={2} isDesktop={false} c={c} />
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
          <View className="px-6 pt-4" style={{ gap: 6 }}>
            <StepSpine steps={IMPORT_JOURNEY_STEPS} current={2} isDesktop c={c} />
            <Hint>
              Every row names a <Text className="font-black">client</Text>. Rows matched to a client you already have
              are joined to it; the rest create one. Nothing is written here either — this is still a proposal.
            </Hint>
          </View>
          <View className="flex-1 px-6 pt-3">{body}</View>
          {footer}
        </View>
      </Popup>
    );
  }

  return null;
}

// ─── review sub-views ────────────────────────────────────────────────────────

function WarningCard({
  tone, icon, title, body, layout, c,
}: { tone: string; icon: any; title: string; body: string; layout: any; c: ReturnType<typeof useThemeColors> }) {
  return (
    <View className="rounded-2xl p-3" style={[{ backgroundColor: c.background, borderWidth: 1, borderColor: tone, gap: 4 }, layout]}>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <FontAwesome name={icon} size={11} color={tone} />
        <Text className="text-typography-main text-xs font-black flex-1" numberOfLines={2}>{title}</Text>
      </View>
      <Text className="text-typography-muted text-[10px]">{body}</Text>
    </View>
  );
}

/**
 * Everything about ONE column, and every control that changes it. Split out of
 * the wizard body only because it is a 150-line block, not because a second
 * caller is coming — it stays in this file.
 */
function ColumnDetail({
  decision, mapping, enumMatches, enumChoices, dateOrder,
  onSetTarget, onSetDateOrder, onChooseEnum, c,
}: {
  decision: ColumnDecision;
  mapping: ColumnMapping;
  enumMatches: EnumValueMatch[];
  enumChoices: Record<string, 'create' | 'skip'>;
  dateOrder: DateOrder;
  onSetTarget: (t: ColumnTarget) => void;
  onSetDateOrder: (o: DateOrder) => void;
  onChooseEnum: (key: string, choice: 'create' | 'skip') => void;
  c: ReturnType<typeof useThemeColors>;
}) {
  const p = decision.profile;
  const target = decision.target;
  const custom = target.kind === 'custom' ? target : null;

  // Scoped to this column's own choices — the wizard keys them by column.
  const scopedChoices = useMemo(() => {
    const out: Record<string, 'create' | 'skip'> = {};
    for (const [k, v] of Object.entries(enumChoices)) {
      // indexOf, not split — a source value can itself contain "::"
      const sep = k.indexOf('::');
      if (sep > 0 && Number(k.slice(0, sep)) === decision.index) out[k.slice(sep + 2)] = v;
    }
    return out;
  }, [enumChoices, decision.index]);

  const toCustom = (dataType: FieldDataType): ColumnTarget => ({
    kind: 'custom',
    defId: custom?.defId ?? null,
    key: custom?.key ?? slugifyFieldKey(p.header, decision.index),
    label: custom?.label ?? (p.header.trim() || `Column ${decision.index + 1}`),
    dataType,
    enumOptions: dataType === 'enum' ? (custom?.enumOptions ?? (p.enumValues ?? []).map(v => v.label)) : null,
  });

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
      {/* The header VERBATIM, quoted — "Service " has a trailing space in the
          real file and that is the string a saved mapping matches on. */}
      <View style={{ gap: 4 }}>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Column {decision.index + 1}</Text>
        <Text className="text-typography-main text-base font-black">“{p.header}”</Text>
        <Text className="text-typography-muted text-[11px]">
          {PRIMITIVE_LABELS[p.primitive]} · {p.filled} of {p.rows} cells filled · {p.distinct} distinct value{p.distinct === 1 ? '' : 's'}
          {p.filled > 0 && p.primitive !== 'empty' ? ` · ${Math.round(p.coverage * 100)}% of them read as ${PRIMITIVE_LABELS[p.primitive].toLowerCase()}` : ''}
        </Text>
      </View>

      {decision.sample !== '' && (
        <View className="rounded-xl px-3 py-2" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-wider mb-1">First value</Text>
          <Text className="text-typography-main text-xs" numberOfLines={3}>{decision.sample}</Text>
        </View>
      )}

      {/* The cells the classification does NOT explain. "Expected date" is a
          date column at 0.62 and the user has to see the prose rather than
          discover 8 nulls after the import (§18.5 #3). */}
      {p.nonMatchingSamples.length > 0 && (
        <View className="rounded-xl px-3 py-2" style={{ backgroundColor: `${c.warning}14`, borderWidth: 1, borderColor: c.warning, gap: 4 }}>
          <Text className="text-[10px] font-black uppercase tracking-wider" style={{ color: c.warning }}>
            {Math.round((1 - p.coverage) * 100)}% of the filled cells are not {PRIMITIVE_LABELS[p.primitive].toLowerCase()}
          </Text>
          {p.nonMatchingSamples.map((s, i) => (
            <Text key={i} className="text-typography-main text-[11px]" numberOfLines={1}>· “{s}”</Text>
          ))}
          <Text className="text-typography-muted text-[10px]">
            These are imported as blank, not guessed at. Switch this column to Text to keep them verbatim instead.
          </Text>
        </View>
      )}

      {/* Target */}
      <View style={{ gap: 8 }}>
        <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Import this column as</Text>
        <View className="flex-row flex-wrap" style={{ gap: 6 }}>
          {MAPPED_FIELDS.map(f => (
            <PickerOption
              key={f}
              label={MAPPED_FIELD_LABELS[f] + (mapping[f] !== undefined && mapping[f] !== decision.index ? ` (col ${(mapping[f] as number) + 1})` : '')}
              active={target.kind === 'field' && target.field === f}
              onPress={() => onSetTarget({ kind: 'field', field: f })}
              c={c}
            />
          ))}
          <PickerOption label="A project field" active={target.kind === 'custom'} tone={c.info} onPress={() => onSetTarget(toCustom(custom?.dataType ?? fieldTypeForPrimitive(p.primitive, p.enumValues)))} c={c} />
          <PickerOption label="Don’t import" active={target.kind === 'ignore'} tone={c.danger} onPress={() => onSetTarget({ kind: 'ignore' })} c={c} />
        </View>
      </View>

      {target.kind === 'ignore' && (
        <View className="rounded-xl px-3 py-2" style={{ backgroundColor: `${c.danger}14`, borderWidth: 1, borderColor: c.danger }}>
          <Text className="text-[11px] font-bold" style={{ color: c.danger }}>
            This is the only setting that loses data — this column will not exist anywhere after the import.
          </Text>
        </View>
      )}

      {custom && (
        <View style={{ gap: 10 }}>
          <View style={{ gap: 6 }}>
            <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">
              Field name {custom.defId ? '· reusing an existing field' : ''}
            </Text>
            <TextInput
              value={custom.label}
              onChangeText={t => onSetTarget({ ...custom, label: t, key: custom.defId ? custom.key : slugifyFieldKey(t, decision.index) })}
              placeholder={p.header.trim() || `Column ${decision.index + 1}`}
              placeholderTextColor={c.textDim}
              className="px-3 rounded-lg text-xs"
              style={{ minHeight: 40, color: c.textMain, backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            />
            <Text className="text-typography-dim text-[10px]">Stored as `{custom.key}` · from “{p.header}”</Text>
          </View>
          <View style={{ gap: 6 }}>
            <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Field type</Text>
            <View className="flex-row flex-wrap" style={{ gap: 6 }}>
              {FIELD_TYPES.map(t => (
                <PickerOption
                  key={t}
                  label={FIELD_TYPE_LABELS[t]}
                  active={custom.dataType === t}
                  tone={c.info}
                  onPress={() => onSetTarget(toCustom(t))}
                  c={c}
                />
              ))}
            </View>
            {!!custom.defId && (
              <Text className="text-typography-dim text-[10px]">
                This field already holds data, so its type is fixed — changing it is a data migration, not an edit.
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Date order — asked ONCE for the column (§18.4), never guessed per cell. */}
      {(p.primitive === 'date' || (custom?.dataType === 'date')) && p.dateOrder !== undefined && (
        <View style={{ gap: 6 }}>
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Date order</Text>
          <View className="flex-row" style={{ gap: 6 }}>
            <PickerOption label="Day / Month / Year" active={dateOrder === 'DMY'} onPress={() => onSetDateOrder('DMY')} c={c} />
            <PickerOption label="Month / Day / Year" active={dateOrder === 'MDY'} onPress={() => onSetDateOrder('MDY')} c={c} />
          </View>
          <Text className="text-typography-dim text-[10px]">
            {p.dateOrder === 'ambiguous'
              ? 'Nothing in this column is over 12, so both readings are possible — we are asking rather than guessing.'
              : `Detected from the cells themselves (${p.dateOrder}).`}
          </Text>
        </View>
      )}

      {custom?.dataType === 'enum' && enumMatches.length > 0 && (
        <EnumValuePanel matches={enumMatches} choices={scopedChoices} hasCatalogue={!!custom.defId} onChoose={onChooseEnum} c={c} />
      )}
    </ScrollView>
  );
}
