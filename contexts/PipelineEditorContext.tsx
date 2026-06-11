import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────

export type Pipeline = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  visibility_permissions: string[];
  task_visibility_mode: 'all' | 'assigned_only';
  created_at: string;
};

export type Stage = {
  id: string;
  pipeline_id: string;
  name: string;
  description: string | null;
  color: string | null;
  position: number;
  is_initial: boolean;
  is_terminal: boolean;
  terminal_type: 'success' | 'failure' | null;
  requires_submission: boolean;
  requires_timer: boolean;
  min_timer_seconds: number;
  use_business_hours: boolean;
  linked_pipeline_id: string | null;
  child_inherits_submission: boolean;
  manager_routing_rule: string | null;
  max_escalation_depth: number | null;
  ui_metadata: { x: number; y: number } | null;
};

export type Transition = {
  id: string;
  from_stage_id: string;
  to_stage_id: string;
  label: string;
  required_permission: string | null;
  transition_type: string | null;
};

export type LinkedOutcome = {
  id: string;
  parent_stage_id: string;
  child_terminal_stage_id: string;
  parent_target_stage_id: string;
  company_id: string;
  created_at: string;
};

export type StageAction = {
  id: string;
  stage_id: string;
  action_type: string;
  label: string;
  icon: string | null;
  style: string;
  required_role: string;
  precondition: string | null;
  transition_id: string | null;
  position: number;
  is_active: boolean;
  requires_timer: boolean;
  use_business_hours: boolean;
};

export type Automation = {
  id: string;
  pipeline_id: string;
  source_stage_id: string;
  target_stage_id: string;
  condition_type: string;
  check_interval_minutes: number;
  priority: number;
  is_active: boolean;
  failure_count: number;
  last_run_at: string | null;
  params?: Record<string, string>;
};

/** A workspace role (dynamic cluster of permissions) */
export type Role = {
  id: string;
  name: string;
  color: string | null;
  is_system: boolean;
};

/** A granular permission entry from the permissions table */
export type PermissionItem = {
  id: string;
  key: string;
  label: string;
  category: string;
};

/** @deprecated Use Role instead */
export type Permission = Role;

type EditorSection = 'list' | 'stages' | 'transitions' | 'automations' | 'visualizer' | 'handshakes' | 'settings' | 'subpipelines';

type PipelineEditorState = {
  // Data
  pipelines: Pipeline[];
  selectedPipeline: Pipeline | null;
  stages: Stage[];
  transitions: Transition[];
  automations: Automation[];
  linkedOutcomes: LinkedOutcome[];
  stageActions: StageAction[];
  /** All workspace roles available for pipeline visibility assignment */
  roles: Role[];
  /** Granular permission entries for transition gate configuration */
  permissions: PermissionItem[];
  // UI
  activeSection: EditorSection;
  loading: boolean;
  error: string | null;
  isOperationInFlight: boolean;
  // Actions
  setActiveSection: (s: EditorSection) => void;
  selectPipeline: (p: Pipeline) => void;
  deselectPipeline: () => void;
  refreshPipelines: () => Promise<void>;
  refreshPipelineData: () => Promise<void>;
  
  // Pipeline Actions
  pipelineActions: {
    create: (name: string, desc: string, stages: any[], transitions: any[], visibility_permissions?: string[], task_visibility_mode?: string) => Promise<string | null>;
    update: (id: string, name?: string, desc?: string | null, isDefault?: boolean, visibility_permissions?: string[], task_visibility_mode?: string) => Promise<boolean>;
    remove: (id: string) => Promise<boolean>;
  };
  
  // Stage Actions
  stageActionsApi: {
    add: (args: Partial<Stage>) => Promise<string | null>;
    update: (id: string, args: Partial<Stage>) => Promise<boolean>;
    updatePosition: (id: string, x: number, y: number) => Promise<boolean>;
    remove: (id: string) => Promise<boolean>;
    reorder: (ids: string[]) => Promise<boolean>;
  };

  // Deprecated flat access (keeping for compatibility)
  createPipeline: (name: string, desc: string, stages: any[], transitions: any[], visibility_permissions?: string[], task_visibility_mode?: string) => Promise<string | null>;
  updatePipeline: (id: string, name?: string, desc?: string | null, isDefault?: boolean, visibility_permissions?: string[], task_visibility_mode?: string) => Promise<boolean>;
  deletePipeline: (id: string) => Promise<boolean>;
  addStage: (args: Partial<Stage>) => Promise<string | null>;
  updateStage: (id: string, args: Partial<Stage>) => Promise<boolean>;
  updateStagePosition: (id: string, x: number, y: number) => Promise<boolean>;
  deleteStage: (id: string) => Promise<boolean>;
  reorderStages: (ids: string[]) => Promise<boolean>;
  // Transition CRUD
  addTransition: (from: string, to: string, label: string, perm?: string, type?: string) => Promise<string | null>;
  updateTransition: (id: string, label?: string, perm?: string, type?: string) => Promise<boolean>;
  deleteTransition: (id: string) => Promise<boolean>;
  // Automation CRUD
  createAutomation: (args: any) => Promise<string | null>;
  updateAutomation: (id: string, args: any) => Promise<boolean>;
  deleteAutomation: (id: string) => Promise<boolean>;
  // Handshake CRUD
  upsertLinkedOutcome: (parent: string, child: string, target: string) => Promise<string | null>;
  deleteLinkedOutcome: (id: string) => Promise<boolean>;
  // Spawn config
  updateStageSpawnConfig: (stageId: string, childInheritsSubmission: boolean) => Promise<boolean>;
  // Action CRUD
  addStageAction: (args: Partial<StageAction>) => Promise<string | null>;
  updateStageAction: (id: string, args: Partial<StageAction>) => Promise<boolean>;
  deleteStageAction: (id: string) => Promise<boolean>;
  reorderStageActions: (stageId: string, actionIds: string[]) => Promise<boolean>;
  clearError: () => void;
};

const PipelineEditorContext = createContext<PipelineEditorState | null>(null);

export function usePipelineEditor() {
  const ctx = useContext(PipelineEditorContext);
  if (!ctx) throw new Error('usePipelineEditor must be used within PipelineEditorProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────

export function PipelineEditorProvider({ children }: { children: ReactNode }) {
  const { successToast, errorToast, infoToast } = useToast();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [linkedOutcomes, setLinkedOutcomes] = useState<LinkedOutcome[]>([]);
  const [stageActions, setStageActions] = useState<StageAction[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissionItems, setPermissionItems] = useState<PermissionItem[]>([]);
  const [activeSection, setActiveSection] = useState<EditorSection>('list');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOperationInFlight, setIsOperationInFlight] = useState(false);
  const clearError = useCallback(() => setError(null), []);

  // ── Fetch all pipelines ──
  const refreshPipelines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from('pipelines')
        .select('*')
        .is('deleted_at', null)
        .order('name');
      if (e) throw e;
      setPipelines(data || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const lastSilentRefreshRef = useRef<number>(0);

  const silentRefreshStages = useCallback(async () => {
    if (!selectedPipeline) return;
    const now = Date.now();
    if (now - lastSilentRefreshRef.current < 2000) return; // 2 seconds throttle
    lastSilentRefreshRef.current = now;

    try {
      const { data: stg } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', selectedPipeline.id)
        .order('position');
      if (stg) setStages(stg);
    } catch (e) {
      console.warn('Silent refresh failed:', e);
    }
  }, [selectedPipeline]);

  // ── Fetch stages, transitions, automations for selected pipeline ──
  const refreshPipelineData = useCallback(async () => {
    if (!selectedPipeline) return;
    setLoading(true);
    setError(null);
    try {
      // Stages
      const { data: stg } = await supabase
        .from('pipeline_stages')
        .select('*')
        .eq('pipeline_id', selectedPipeline.id)
        .order('position');
      setStages(stg || []);

      // Handshakes (Linked Outcomes)
      const { data: lks } = await supabase
        .from('pipeline_linked_outcomes')
        .select('*')
        .in('parent_stage_id', (stg || []).map(s => s.id));
      setLinkedOutcomes(lks || []);

      // Transitions (need to get those linked to stages of this pipeline)
      const stageIds = (stg || []).map(s => s.id);
      if (stageIds.length > 0) {
        const { data: trans } = await supabase
          .from('pipeline_stage_transitions')
          .select('*')
          .in('from_stage_id', stageIds);
        setTransitions(trans || []);
        
        const { data: acts } = await supabase
          .from('pipeline_stage_actions')
          .select('*')
          .in('stage_id', stageIds)
          .order('position');
        setStageActions(acts || []);
      } else {
        setTransitions([]);
        setStageActions([]);
      }

      // Automations
      const { data: autos } = await supabase
        .from('pipeline_automations')
        .select('*')
        .eq('pipeline_id', selectedPipeline.id)
        .order('priority', { ascending: false });
      
      // Fetch params for each automation
      if (autos && autos.length > 0) {
        const autoIds = autos.map(a => a.id);
        const { data: params } = await supabase
          .from('pipeline_automation_params')
          .select('*')
          .in('automation_id', autoIds);
        
        const paramMap: Record<string, Record<string, string>> = {};
        params?.forEach(p => {
          if (!paramMap[p.automation_id]) paramMap[p.automation_id] = {};
          paramMap[p.automation_id][p.key] = p.value;
        });

        setAutomations(autos.map(a => ({ ...a, params: paramMap[a.id] || {} })));
      } else {
        setAutomations([]);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline]);

  // ── Fetch roles (for pipeline visibility assignment) ──
  useEffect(() => {
    const fetchRoles = async () => {
      const { data } = await supabase
        .from('roles')
        .select('id, name, color, is_system')
        .is('deleted_at', null)
        .order('name');
      setRoles(data || []);
    };
    fetchRoles();
  }, []);

  // ── Fetch permissions (for transition gate configuration) ──
  useEffect(() => {
    const fetchPermissions = async () => {
      const { data } = await supabase
        .from('permissions')
        .select('id, key, label, category')
        .order('category, label');
      setPermissionItems(data || []);
    };
    fetchPermissions();
  }, []);

  // ── Restore selected pipeline from storage ──
  useEffect(() => {
    if (pipelines.length > 0 && !selectedPipeline) {
      const restoreSelection = async () => {
        try {
          const savedPipelineId = await AsyncStorage.getItem('@TrustFlow_selected_pipeline');
          if (savedPipelineId) {
            const pipeline = pipelines.find(p => p.id === savedPipelineId);
            if (pipeline) {
              setSelectedPipeline(pipeline);
              setActiveSection('stages');
            }
          }
        } catch (e) {
          console.warn('Failed to restore selected pipeline:', e);
        }
      };
      restoreSelection();
    }
  }, [pipelines, selectedPipeline]);

  // ── Auto-refresh pipeline data when selection changes ──
  useEffect(() => {
    if (selectedPipeline) {
      refreshPipelineData();
      
      const channel = supabase
        .channel(`pipeline_${selectedPipeline.id}_stages`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'pipeline_stages', filter: `pipeline_id=eq.${selectedPipeline.id}` },
          (payload) => {
            if (!currentPendingReorderRef.current) {
               silentRefreshStages();
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [selectedPipeline?.id, refreshPipelineData, silentRefreshStages]);

  // ── Select / Deselect ──
  const selectPipeline = useCallback((p: Pipeline) => {
    setError(null);
    setSelectedPipeline(p);
    setActiveSection('stages');
    // Persist selected pipeline to storage
    AsyncStorage.setItem('@TrustFlow_selected_pipeline', p.id).catch(e => {
      console.warn('Failed to persist selected pipeline:', e);
    });
  }, []);

  const deselectPipeline = useCallback(() => {
    setError(null);
    setSelectedPipeline(null);
    setStages([]);
    setTransitions([]);
    setAutomations([]);
    setLinkedOutcomes([]);
    setStageActions([]);
    setActiveSection('list');
    // Clear persisted selection
    AsyncStorage.removeItem('@TrustFlow_selected_pipeline').catch(e => {
      console.warn('Failed to clear selected pipeline:', e);
    });
  }, []);

  // ═══ Pipeline CRUD ═══
  const createPipeline = useCallback(async (
    name: string, desc: string, stagesArr: any[], transArr: any[], visibility_permissions: string[] = [], task_visibility_mode: string = 'all'
  ): Promise<string | null> => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Get company_id from current user
      const { data: userProfile } = await supabase
        .from('users')
        .select('company_id')
        .eq('id', user.id)
        .single();
      if (!userProfile?.company_id) throw new Error('Company not found');

      // Step 1: Create the pipeline record
      const { data: pipelineData, error: pipelineErr } = await supabase
        .from('pipelines')
        .insert({
          company_id: userProfile.company_id,
          name,
          description: desc,
          visibility_permissions: visibility_permissions.length > 0 ? visibility_permissions : [],
          task_visibility_mode,
          is_default: false,
          deleted_at: null,
        })
        .select('id')
        .single();
      if (pipelineErr) throw pipelineErr;
      const pipelineId = pipelineData.id;

      // Step 2: Create all stages and map position -> stage ID
      const stageMap: Record<number, string> = {};
      if (stagesArr.length > 0) {
        const stageInserts = stagesArr.map((stage: any, idx: number) => ({
          pipeline_id: pipelineId,
          name: stage.name || `Stage ${idx + 1}`,
          color: stage.color || '#6B7280',
          description: stage.description || null,
          position: stage.position || idx + 1,
          is_initial: stage.is_initial || false,
          is_terminal: stage.is_terminal || false,
          terminal_type: stage.terminal_type || null,
          requires_submission: stage.requires_submission || false,
          requires_timer: stage.requires_timer || false,
          min_timer_seconds: stage.min_timer_seconds ?? 300,
          use_business_hours: stage.use_business_hours || false,
          ui_metadata: stage.ui_metadata || { x: 0, y: 0 },
        }));

        const { data: stagesData, error: stagesErr } = await supabase
          .from('pipeline_stages')
          .insert(stageInserts)
          .select('id, position');
        if (stagesErr) throw stagesErr;

        // Map position to ID
        stagesData?.forEach((s: any) => {
          const origStage = stagesArr.find((sa: any) => sa.position === s.position);
          if (origStage) {
            stageMap[origStage.position] = s.id;
          }
        });
      }

      // Step 3: Create all transitions and auto-create actions for them
      if (transArr.length > 0) {
        const transInserts = transArr
          .map((trans: any) => {
            const fromStageId = stageMap[trans.from_position];
            const toStageId = stageMap[trans.to_position];
            if (!fromStageId || !toStageId) return null;
            return {
              from_stage_id: fromStageId,
              to_stage_id: toStageId,
              label: trans.label || 'Transition',
              required_permission: trans.required_permission || null,
              transition_type: trans.transition_type || 'neutral',
            };
          })
          .filter(Boolean);

        if (transInserts.length > 0) {
          const { data: transData, error: transErr } = await supabase
            .from('pipeline_stage_transitions')
            .insert(transInserts)
            .select('id, from_stage_id, to_stage_id');
          if (transErr) throw transErr;

          // Step 4: Auto-create stage actions for each transition
          // This ensures that initialized transitions are displayed as actionable buttons
          const actionInserts = (transData || [])
            .map((t: any) => {
              const origTrans = transArr.find((ta: any) =>
                stageMap[ta.from_position] === t.from_stage_id &&
                stageMap[ta.to_position] === t.to_stage_id
              );
              if (!origTrans) return null;
              return {
                stage_id: t.from_stage_id,
                action_type: 'advance',
                label: origTrans.label || 'Transition',
                icon: null,
                style: 'primary',
                required_role: 'any',
                requires_timer: false,
                use_business_hours: false,
                precondition: null,
                transition_id: t.id,
                position: 1,
                is_active: true,
              };
            })
            .filter(Boolean);

          if (actionInserts.length > 0) {
            const { error: actionsErr } = await supabase
              .from('pipeline_stage_actions')
              .insert(actionInserts);
            if (actionsErr) {
              console.warn('Failed to auto-create stage actions:', actionsErr.message);
              // Don't throw - actions are nice-to-have but transitions should exist
            }
          }
        }
      }

      await refreshPipelines();
      
      // Fetch and select the newly created pipeline so its data is loaded
      const { data: newPipeline } = await supabase
        .from('pipelines')
        .select('*')
        .eq('id', pipelineId)
        .single();
      
      if (newPipeline) {
        setSelectedPipeline(newPipeline);
      }
      
      successToast(`Pipeline "${name}" created.`, 'Pipeline saved');
      return pipelineId;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to create pipeline.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelines, successToast, errorToast]);

  const updatePipeline = useCallback(async (
    id: string, name?: string, desc?: string | null, isDefault?: boolean, visibility_permissions?: string[], task_visibility_mode?: string
  ): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_update_pipeline', {
        p_pipeline_id: id,
        p_name: name ?? null,
        p_description: desc ?? null,
        p_is_default: isDefault ?? null,
        p_visibility_permissions: visibility_permissions ?? null,
        p_task_visibility_mode: task_visibility_mode ?? null,
      });
      if (e) throw e;
      await refreshPipelines();
      if (selectedPipeline?.id === id) {
        setSelectedPipeline(prev => prev ? { 
          ...prev, 
          name: name ?? prev.name, 
          description: desc ?? prev.description,
          visibility_permissions: visibility_permissions ?? prev.visibility_permissions,
          task_visibility_mode: (task_visibility_mode as any) ?? prev.task_visibility_mode
        } : null);
      }
      successToast('Pipeline updated.', 'Saved');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to update pipeline.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelines, selectedPipeline, successToast, errorToast]);

  const deletePipeline = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_pipeline', {
        p_pipeline_id: id,
      });
      if (e) throw e;
      if (selectedPipeline?.id === id) deselectPipeline();
      await refreshPipelines();
      infoToast('Pipeline removed.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to delete pipeline.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelines, selectedPipeline, deselectPipeline, infoToast, errorToast]);

  // ═══ Stage CRUD ═══
  const addStage = useCallback(async (args: Partial<Stage>): Promise<string | null> => {
    if (!selectedPipeline) return null;
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('rpc_add_stage', {
        p_pipeline_id: selectedPipeline.id,
        p_name: args.name || 'New Stage',
        p_color: args.color || '#6B7280',
        p_description: args.description || null,
        p_is_initial: args.is_initial || false,
        p_is_terminal: args.is_terminal || false,
        p_terminal_type: args.terminal_type || null,
        p_requires_submission: args.requires_submission || false,
        p_requires_timer: args.requires_timer || false,
        p_use_business_hours: args.use_business_hours || false,
        p_ui_metadata: args.ui_metadata || { x: 0, y: 0 },
        p_min_timer_seconds: args.min_timer_seconds ?? 300,
      });
      if (e) throw e;
      await refreshPipelineData();
      successToast(`Stage "${args.name || 'New Stage'}" added.`);
      return data;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to add stage.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline, refreshPipelineData, successToast, errorToast]);

  const updateStage = useCallback(async (id: string, args: Partial<Stage>): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_update_stage', {
        p_stage_id: id,
        p_name: args.name ?? null,
        p_color: args.color ?? null,
        p_description: args.description ?? null,
        p_is_initial: args.is_initial ?? null,
        p_is_terminal: args.is_terminal ?? null,
        p_terminal_type: args.terminal_type ?? null,
        p_requires_submission: args.requires_submission ?? null,
        p_requires_timer: args.requires_timer ?? null,
        p_use_business_hours: args.use_business_hours ?? null,
        p_linked_pipeline_id: args.linked_pipeline_id ?? null,
        p_ui_metadata: args.ui_metadata ?? null,
        p_min_timer_seconds: args.min_timer_seconds ?? null,
      });
      if (e) throw e;
      await refreshPipelineData();
      successToast('Stage updated.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to update stage.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, successToast, errorToast]);

  const updateStagePosition = useCallback(async (id: string, x: number, y: number): Promise<boolean> => {
    // Optimistic update
    setStages(prev => prev.map(s => s.id === id ? { ...s, ui_metadata: { x, y } } : s));
    
    try {
      const { error: e } = await supabase.rpc('rpc_update_stage', {
        p_stage_id: id,
        p_ui_metadata: { x, y }
      });
      if (e) throw e;
      return true;
    } catch (e: any) {
      console.warn('Failed to persist stage position:', e.message);
      errorToast(e.message || 'Unable to move stage.');
      return false;
    }
  }, [errorToast]);

  const deleteStage = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_stage', {
        p_stage_id: id,
      });
      if (e) throw e;
      await refreshPipelineData();
      infoToast('Stage deleted.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to delete stage.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, infoToast, errorToast]);

  const reorderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPendingReorderRef = useRef<string[] | null>(null);
  const originalStagesRef = useRef<Stage[] | null>(null);

  const reorderStages = useCallback(async (ids: string[]): Promise<boolean> => {
    if (!selectedPipeline) return false;
    
    return new Promise((resolve) => {
      setIsOperationInFlight(true);
      
      setStages(prev => {
        if (!originalStagesRef.current) {
          originalStagesRef.current = [...prev];
        }
        
        // Return reordered array
        return ids.map((id, index) => {
          const stage = prev.find(s => s.id === id) || originalStagesRef.current?.find(s => s.id === id);
          return stage ? { ...stage, position: index + 1 } : null;
        }).filter(Boolean) as Stage[];
      });

      currentPendingReorderRef.current = ids;

      if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);

      reorderTimerRef.current = setTimeout(async () => {
        const finalIds = currentPendingReorderRef.current;
        if (!finalIds) {
          setIsOperationInFlight(false);
          return resolve(false);
        }
        
        try {
          const { error: e } = await supabase.rpc('rpc_reorder_stages', {
            p_pipeline_id: selectedPipeline.id,
            p_stage_ids: finalIds,
          });
          if (e) throw e;
          successToast('Stages reordered.');
          resolve(true);
        } catch (e: any) {
          setError(`Failed to reorder: ${e.message}`);
          errorToast(e.message || 'Unable to reorder stages.');
          if (originalStagesRef.current) {
            setStages([...originalStagesRef.current]); // Rollback
          }
          resolve(false);
        } finally {
          currentPendingReorderRef.current = null;
          originalStagesRef.current = null;
          setIsOperationInFlight(false);
        }
      }, 400); // 400ms debounce
    });
  }, [selectedPipeline, successToast, errorToast]);

  // ═══ Transition CRUD ═══
  const addTransition = useCallback(async (
    from: string, to: string, label: string, perm?: string, type?: string
  ): Promise<string | null> => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('rpc_add_transition', {
        p_from_stage_id: from,
        p_to_stage_id: to,
        p_label: label,
        p_required_permission: perm || null,
        p_transition_type: type || 'neutral',
      });
      if (e) throw e;
      await refreshPipelineData();
      successToast(`Transition "${label}" added.`);
      return data;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to add transition.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, successToast, errorToast]);

  const updateTransition = useCallback(async (
    id: string, label?: string, perm?: string, type?: string
  ): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_update_transition', {
        p_transition_id: id,
        p_label: label ?? null,
        p_required_permission: perm ?? null,
        p_transition_type: type ?? null,
      });
      if (e) throw e;
      await refreshPipelineData();
      successToast('Transition updated.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to update transition.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, successToast, errorToast]);

  const deleteTransition = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_transition', {
        p_transition_id: id,
      });
      if (e) throw e;
      await refreshPipelineData();
      infoToast('Transition deleted.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to delete transition.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, infoToast, errorToast]);

  // ═══ Automation CRUD ═══
  const createAutomation = useCallback(async (args: any): Promise<string | null> => {
    if (!selectedPipeline) return null;
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('rpc_create_automation', {
        p_pipeline_id: selectedPipeline.id,
        p_source_stage_id: args.source_stage_id,
        p_target_stage_id: args.target_stage_id,
        p_condition_type: args.condition_type,
        p_check_interval_minutes: args.check_interval_minutes || 60,
        p_priority: args.priority || 0,
        p_params: args.params || {},
      });
      if (e) throw e;
      await refreshPipelineData();
      successToast('Automation created.');
      return data;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to create automation.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline, refreshPipelineData, successToast, errorToast]);

  const updateAutomation = useCallback(async (id: string, args: any): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_update_automation', {
        p_automation_id: id,
        p_condition_type: args.condition_type ?? null,
        p_check_interval_minutes: args.check_interval_minutes ?? null,
        p_priority: args.priority ?? null,
        p_is_active: args.is_active ?? null,
        p_params: args.params ?? null,
      });
      if (e) throw e;
      await refreshPipelineData();
      successToast('Automation updated.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to update automation.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, successToast, errorToast]);

  const deleteAutomation = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_automation', {
        p_automation_id: id,
      });
      if (e) throw e;
      await refreshPipelineData();
      infoToast('Automation deleted.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to delete automation.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, infoToast, errorToast]);

  // ═══ Action CRUD ═══
  const addStageAction = useCallback(async (args: Partial<StageAction>): Promise<string | null> => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('rpc_add_stage_action', {
        p_stage_id: args.stage_id,
        p_action_type: args.action_type,
        p_label: args.label,
        p_icon: args.icon || null,
        p_style: args.style || 'neutral',
        p_required_role: args.required_role || 'any',
        p_requires_timer: args.requires_timer || false,
        p_use_business_hours: args.use_business_hours || false,
        p_precondition: args.precondition || null,
        p_transition_id: args.transition_id || null,
      });
      if (e) throw e;
      await refreshPipelineData();
      successToast('Stage action created.');
      return data;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to create stage action.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, successToast, errorToast]);

  const updateStageAction = useCallback(async (id: string, args: Partial<StageAction>): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_update_stage_action', {
        p_action_id: id,
        p_label: args.label ?? null,
        p_icon: args.icon ?? null,
        p_style: args.style ?? null,
        p_required_role: args.required_role ?? null,
        p_precondition: args.precondition ?? null,
        p_transition_id: args.transition_id ?? null,
        p_requires_timer: args.requires_timer ?? null,
        p_use_business_hours: args.use_business_hours ?? null,
        p_is_active: args.is_active ?? null,
      });
      if (e) throw e;
      await refreshPipelineData();
      successToast('Stage action updated.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to update stage action.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, successToast, errorToast]);

  const deleteStageAction = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_stage_action', {
        p_action_id: id,
      });
      if (e) throw e;
      await refreshPipelineData();
      infoToast('Stage action deleted.');
      return true;
    } catch (e: any) {
      setError(e.message);
      errorToast(e.message || 'Unable to delete stage action.');
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData, infoToast, errorToast]);

  const reorderStageActions = useCallback(async (stageId: string, actionIds: string[]): Promise<boolean> => {
    try {
      // Optimistic update locally
      setStageActions(prev => {
        const otherActions = prev.filter(a => a.stage_id !== stageId);
        const targetActions = prev.filter(a => a.stage_id === stageId);
        const reorderedTargetActions = actionIds.map((id, index) => {
          const action = targetActions.find(a => a.id === id);
          return action ? { ...action, position: index + 1 } : null;
        }).filter(Boolean) as StageAction[];
        return [...otherActions, ...reorderedTargetActions];
      });

      const { error: e } = await supabase.rpc('rpc_reorder_stage_actions', {
        p_stage_id: stageId,
        p_action_ids: actionIds,
      });
      if (e) throw e;
      return true;
    } catch (e: any) {
      setError(e.message);
      await refreshPipelineData(); // revert
      return false;
    }
  }, [refreshPipelineData]);

  return (
    <PipelineEditorContext.Provider
      value={{
        pipelines, selectedPipeline, stages, transitions, automations, roles,
        error, loading, activeSection, isOperationInFlight,
        setActiveSection, selectPipeline, deselectPipeline, refreshPipelines, refreshPipelineData,
        clearError,
        permissions: permissionItems,
        linkedOutcomes, stageActions,
        
        // Grouped Actions
        pipelineActions: {
          create: createPipeline,
          update: updatePipeline,
          remove: deletePipeline
        },
        stageActionsApi: {
          add: addStage,
          update: updateStage,
          updatePosition: updateStagePosition,
          remove: deleteStage,
          reorder: reorderStages
        },

        // Flat compatibility layer
        createPipeline, updatePipeline, deletePipeline,
        addStage, updateStage, updateStagePosition, deleteStage, reorderStages,
        addTransition, updateTransition, deleteTransition,
        createAutomation, updateAutomation, deleteAutomation,
        addStageAction, updateStageAction, deleteStageAction, reorderStageActions,
        upsertLinkedOutcome: async (p, c, t) => {
          setLoading(true);
          try {
            const { data, error: e } = await supabase.rpc('rpc_upsert_linked_outcome', {
              p_parent_stage_id: p,
              p_child_terminal_stage_id: c,
              p_parent_target_stage_id: t
            });
            if (e) throw e;
            await refreshPipelineData();
            successToast('Linked outcome saved.');
            return data;
          } catch (e: any) {
            setError(e.message);
            errorToast(e.message || 'Unable to save linked outcome.');
            return null;
          } finally {
            setLoading(false);
          }
        },
        deleteLinkedOutcome: async (id) => {
          setLoading(true);
          try {
            const { error: e } = await supabase.rpc('rpc_delete_linked_outcome', { p_id: id });
            if (e) throw e;
            await refreshPipelineData();
            infoToast('Linked outcome removed.');
            return true;
          } catch (e: any) {
            setError(e.message);
            errorToast(e.message || 'Unable to delete linked outcome.');
            return false;
          } finally {
            setLoading(false);
          }
        },
        updateStageSpawnConfig: async (stageId, childInheritsSubmission) => {
          setLoading(true);
          try {
            const { error: e } = await supabase.rpc('rpc_update_stage_spawn_config', {
              p_stage_id: stageId,
              p_child_inherits_submission: childInheritsSubmission,
            });
            if (e) throw e;
            setStages(prev => prev.map(s =>
              s.id === stageId ? { ...s, child_inherits_submission: childInheritsSubmission } : s
            ));
            successToast('Spawn settings updated.');
            return true;
          } catch (e: any) {
            setError(e.message);
            errorToast(e.message || 'Unable to update spawn settings.');
            return false;
          } finally {
            setLoading(false);
          }
        },
      }}
    >
      {children}
    </PipelineEditorContext.Provider>
  );
}
