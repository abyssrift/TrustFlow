// Debug-only panel (app/admin/dev-tools) surfacing issue #284's harvest
// system internals: active harvest_rules for a chosen pipeline (condition,
// target stage, destination, active state, last_run_at), recent
// harvested_files pointer activity, and recent automation_execution_log
// rows for the shared harvest/automation audit trail -- plus a manual
// "Run backfill now" per rule. Modeled directly on FileHubDebugPanel.tsx
// (same file, same sibling slot in dev-tools.tsx/.web.tsx): RN primitives
// only, no DOM APIs, so it renders identically on both hosts -- one file,
// no .web.tsx variant needed.
//
// Scoping matches the rest of Dev Tools (FileHubDebugPanel's own
// company_billing query): explicit .eq('company_id', profile.company_id) on
// every query. Load-bearing for automation_execution_log specifically --
// its RLS policy is `USING (true)` (open company-wide-and-beyond by design,
// pre-existing, out of scope here), so the company filter below is the ONLY
// thing scoping that one query; harvest_rules/harvested_files already scope
// via their own RLS, the explicit filter there is just consistency/clarity.
//
// ponytail: no new RPCs for any of this -- every list is a plain
// `.from(...).select(...)` read (admin-only screen, already gated), and the
// "orphaned destination folder" flag is computed client-side from the
// destination_folder_id embed already fetched for the rules list, not a
// second query.

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

type PipelineRow = { id: string; name: string };

type RuleRow = {
  id: string;
  condition_type: string;
  source_stage_id: string | null;
  destination_folder_id: string | null;
  is_active: boolean;
  last_run_at: string | null;
  pipeline_stages: { name: string } | null;
  filehub_folders: { name: string; deleted_at: string | null } | null;
};

type HarvestedRow = {
  id: string;
  harvested_at: string;
  destination_folder_id: string;
  tasks: { title: string } | null;
  projects: { name: string } | null;
  filehub_folders: { name: string } | null;
  users: { full_name: string } | null;
};

type LogRow = {
  id: string;
  executed_at: string;
  task_id: string | null;
  project_id: string | null;
  harvest_rule_id: string;
  tasks: { title: string } | null;
  projects: { name: string } | null;
  harvest_rules: { condition_type: string } | null;
};

const CONDITION_LABEL: Record<string, string> = {
  stage_entry: 'Stage entry',
  stage_terminal_success: 'Terminal success',
};

export default function HarvestDebugPanel() {
  const { profile } = useAuth();
  const { successToast, infoToast, errorToast } = useToast();

  const [pipelines, setPipelines] = useState<PipelineRow[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [harvested, setHarvested] = useState<HarvestedRow[]>([]);
  const [logRows, setLogRows] = useState<LogRow[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [backfillingId, setBackfillingId] = useState<string | null>(null);

  const companyId = profile?.company_id;

  const loadPipelines = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from('pipelines')
      .select('id, name')
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('name');
    if (error) {
      errorToast(error.message);
      return;
    }
    setPipelines(data || []);
    setSelectedPipeline(prev => prev ?? data?.[0]?.id ?? null);
  }, [companyId, errorToast]);

  const loadRules = useCallback(async (pipelineId: string) => {
    setRulesLoading(true);
    try {
      const { data, error } = await supabase
        .from('harvest_rules')
        .select('id, condition_type, source_stage_id, destination_folder_id, is_active, last_run_at, pipeline_stages:source_stage_id(name), filehub_folders:destination_folder_id(name, deleted_at)')
        .eq('pipeline_id', pipelineId)
        .eq('company_id', companyId)
        .order('priority', { ascending: false });
      if (error) throw error;
      setRules((data as any) || []);
    } catch (e: any) {
      errorToast(e?.message || 'Could not load harvest rules.');
    } finally {
      setRulesLoading(false);
    }
  }, [companyId, errorToast]);

  const loadActivity = useCallback(async () => {
    if (!companyId) return;
    setActivityLoading(true);
    try {
      const [{ data: hf, error: hfErr }, { data: log, error: logErr }] = await Promise.all([
        supabase
          .from('harvested_files')
          .select('id, harvested_at, destination_folder_id, tasks:source_task_id(title), projects:source_project_id(name), filehub_folders:destination_folder_id(name), users:harvested_by(full_name)')
          .eq('company_id', companyId)
          .order('harvested_at', { ascending: false })
          .limit(20),
        supabase
          .from('automation_execution_log')
          .select('id, executed_at, task_id, project_id, harvest_rule_id, tasks:task_id(title), projects:project_id(name), harvest_rules:harvest_rule_id(condition_type)')
          .eq('company_id', companyId)
          .not('harvest_rule_id', 'is', null)
          .order('executed_at', { ascending: false })
          .limit(20),
      ]);
      if (hfErr) throw hfErr;
      if (logErr) throw logErr;
      setHarvested((hf as any) || []);
      setLogRows((log as any) || []);
    } catch (e: any) {
      errorToast(e?.message || 'Could not load harvest activity.');
    } finally {
      setActivityLoading(false);
    }
  }, [companyId, errorToast]);

  useEffect(() => { loadPipelines(); }, [loadPipelines]);
  useEffect(() => { if (selectedPipeline) loadRules(selectedPipeline); }, [selectedPipeline, loadRules]);
  useEffect(() => { loadActivity(); }, [loadActivity]);

  const runBackfill = async (ruleId: string) => {
    setBackfillingId(ruleId);
    try {
      const { data, error } = await supabase.rpc('rpc_backfill_harvest_rule', { p_rule_id: ruleId });
      if (error) throw error;
      const count = data ?? 0;
      if (count > 0) {
        successToast(`Harvested ${count} task${count === 1 ? '' : 's'}.`, 'Backfill complete');
      } else {
        infoToast('No tasks needed backfilling — everything qualifying is already harvested.', 'Backfill complete');
      }
      if (selectedPipeline) loadRules(selectedPipeline);
      loadActivity();
    } catch (e: any) {
      errorToast(e?.message || 'Backfill failed.');
    } finally {
      setBackfillingId(null);
    }
  };

  // ponytail: client-side flag over data already fetched for the rules list
  // -- no second query. A rule's destination is "orphaned" if it points at a
  // folder that's been soft-deleted (fn_ensure_harvest_destination_folder /
  // fn_harvest_task_output only re-resolve this lazily, on the NEXT fire).
  const orphanedCount = useMemo(
    () => rules.filter(r => r.filehub_folders?.deleted_at).length,
    [rules]
  );

  const sourceLabel = (row: { tasks: { title: string } | null; projects: { name: string } | null }) =>
    row.tasks?.title ?? row.projects?.name ?? '(deleted)';

  return (
    <View className="mb-6">
      <Text className="text-typography-main font-black text-sm mb-3">🌾 Harvest Rules Debug</Text>

      {/* Pipeline selector */}
      {pipelines.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
          <View className="flex-row gap-2">
            {pipelines.map(p => {
              const active = p.id === selectedPipeline;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setSelectedPipeline(p.id)}
                  className={`rounded-xl border px-3 py-2 ${active ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                >
                  <Text className={`text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-muted'}`} numberOfLines={1}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* 1. Rules for the selected pipeline */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-4 mb-3">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-typography-main font-bold text-xs">Active Rules{orphanedCount > 0 ? ` — ${orphanedCount} orphaned destination${orphanedCount === 1 ? '' : 's'}` : ''}</Text>
          {rulesLoading && <ActivityIndicator size="small" color="#6366f1" />}
        </View>
        {pipelines.length === 0 ? (
          <Text className="text-typography-muted text-xs">No pipelines found for this company.</Text>
        ) : rules.length === 0 && !rulesLoading ? (
          <Text className="text-typography-muted text-xs">No harvest rules on this pipeline.</Text>
        ) : (
          <View className="gap-2">
            {rules.map(r => {
              const orphaned = !!r.filehub_folders?.deleted_at;
              const target = r.pipeline_stages?.name ?? (r.condition_type === 'stage_terminal_success' ? 'Any success stage' : '(stage deleted)');
              const dest = r.destination_folder_id ? (r.filehub_folders?.name ?? '(folder deleted)') : 'Dynamic (per-project)';
              return (
                <View key={r.id} className="bg-surface-background rounded-lg border border-surface-border p-2.5">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-typography-main font-bold text-xs flex-1 mr-2" numberOfLines={1}>
                      {CONDITION_LABEL[r.condition_type] ?? r.condition_type} → {target}
                    </Text>
                    <Text className={`text-[10px] uppercase font-bold ${r.is_active ? 'text-state-success' : 'text-typography-muted'}`}>
                      {r.is_active ? 'Active' : 'Paused'}
                    </Text>
                  </View>
                  <Text className="text-typography-muted text-[11px] mt-0.5" numberOfLines={1}>
                    Destination: {dest} · Last run: {r.last_run_at ? new Date(r.last_run_at).toLocaleString() : 'never (trigger-fired only)'}
                  </Text>
                  {orphaned && (
                    <Text className="text-amber-600 text-[10px] font-bold mt-1">
                      ⚠ destination folder soft-deleted — will re-create on next fire
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={() => runBackfill(r.id)}
                    disabled={backfillingId === r.id}
                    className={`flex-row items-center justify-center gap-1.5 mt-2 rounded-lg border border-brand-primary bg-brand-primary/10 py-1.5 ${backfillingId === r.id ? 'opacity-60' : ''}`}
                  >
                    {backfillingId === r.id ? (
                      <ActivityIndicator size="small" color="#6366f1" />
                    ) : (
                      <FontAwesome name="play" size={10} color="#6366f1" />
                    )}
                    <Text className="text-brand-primary text-[11px] font-bold">Run backfill now</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* 2. Recent harvested_files activity */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-4 mb-3">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-typography-main font-bold text-xs">Recent Harvested Files (last 20)</Text>
          {activityLoading && <ActivityIndicator size="small" color="#6366f1" />}
        </View>
        {harvested.length === 0 && !activityLoading ? (
          <Text className="text-typography-muted text-xs">No harvest activity yet.</Text>
        ) : (
          <View className="gap-1.5">
            {harvested.map(h => (
              <View key={h.id} className="bg-surface-background rounded-lg border border-surface-border p-2.5">
                <Text className="text-typography-main font-bold text-xs" numberOfLines={1}>
                  {sourceLabel(h)} → {h.filehub_folders?.name ?? '(folder deleted)'}
                </Text>
                <Text className="text-typography-muted text-[11px] mt-0.5">
                  {new Date(h.harvested_at).toLocaleString()} · by {h.users?.full_name ?? 'system'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* 3. Recent automation_execution_log rows for harvest_rule_id IS NOT NULL */}
      <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
        <Text className="text-typography-main font-bold text-xs mb-2">Harvest Execution Log (last 20)</Text>
        {logRows.length === 0 && !activityLoading ? (
          <Text className="text-typography-muted text-xs">
            No rows logged yet — fn_harvest_task_output does not currently write to automation_execution_log (only rpc_process_harvest_rules reads it, and that cron path is inert for v1&apos;s trigger-fired condition types). The circuit breaker this table backs has nothing to gate on today.
          </Text>
        ) : (
          <View className="gap-1.5">
            {logRows.map(l => (
              <View key={l.id} className="bg-surface-background rounded-lg border border-surface-border p-2.5">
                <Text className="text-typography-main font-bold text-xs" numberOfLines={1}>
                  {CONDITION_LABEL[l.harvest_rules?.condition_type ?? ''] ?? '(rule deleted)'} · {sourceLabel(l)}
                </Text>
                <Text className="text-typography-muted text-[11px] mt-0.5">{new Date(l.executed_at).toLocaleString()}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
