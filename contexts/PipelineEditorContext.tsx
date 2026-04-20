import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────

export type Pipeline = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
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
  linked_pipeline_id: string | null;
  manager_routing_rule: string | null;
  max_escalation_depth: number | null;
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

export type Permission = {
  key: string;
  label: string;
};

type EditorSection = 'list' | 'stages' | 'transitions' | 'automations' | 'visualizer' | 'handshakes';

type PipelineEditorState = {
  // Data
  pipelines: Pipeline[];
  selectedPipeline: Pipeline | null;
  stages: Stage[];
  transitions: Transition[];
  automations: Automation[];
  linkedOutcomes: LinkedOutcome[];
  stageActions: StageAction[];
  permissions: Permission[];
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
  // Pipeline CRUD
  createPipeline: (name: string, desc: string, stages: any[], transitions: any[]) => Promise<string | null>;
  updatePipeline: (id: string, name?: string, desc?: string, isDefault?: boolean) => Promise<boolean>;
  deletePipeline: (id: string) => Promise<boolean>;
  // Stage CRUD
  addStage: (args: Partial<Stage>) => Promise<string | null>;
  updateStage: (id: string, args: Partial<Stage>) => Promise<boolean>;
  deleteStage: (id: string) => Promise<boolean>;
  reorderStages: (ids: string[]) => Promise<boolean>;
  // Transition CRUD
  addTransition: (from: string, to: string, label: string, perm?: string) => Promise<string | null>;
  updateTransition: (id: string, label?: string, perm?: string) => Promise<boolean>;
  deleteTransition: (id: string) => Promise<boolean>;
  // Automation CRUD
  createAutomation: (args: any) => Promise<string | null>;
  updateAutomation: (id: string, args: any) => Promise<boolean>;
  deleteAutomation: (id: string) => Promise<boolean>;
  // Handshake CRUD
  upsertLinkedOutcome: (parent: string, child: string, target: string) => Promise<string | null>;
  deleteLinkedOutcome: (id: string) => Promise<boolean>;
  // Action CRUD
  addStageAction: (args: Partial<StageAction>) => Promise<string | null>;
  updateStageAction: (id: string, args: Partial<StageAction>) => Promise<boolean>;
  deleteStageAction: (id: string) => Promise<boolean>;
  reorderStageActions: (stageId: string, actionIds: string[]) => Promise<boolean>;
};

const PipelineEditorContext = createContext<PipelineEditorState | null>(null);

export function usePipelineEditor() {
  const ctx = useContext(PipelineEditorContext);
  if (!ctx) throw new Error('usePipelineEditor must be used within PipelineEditorProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────

export function PipelineEditorProvider({ children }: { children: ReactNode }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [linkedOutcomes, setLinkedOutcomes] = useState<LinkedOutcome[]>([]);
  const [stageActions, setStageActions] = useState<StageAction[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [activeSection, setActiveSection] = useState<EditorSection>('list');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOperationInFlight, setIsOperationInFlight] = useState(false);

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

  // ── Fetch permissions (for transition rules) ──
  useEffect(() => {
    const fetchPerms = async () => {
      const { data } = await supabase
        .from('permissions')
        .select('key, label')
        .order('key');
      setPermissions(data || []);
    };
    fetchPerms();
  }, []);

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
    setSelectedPipeline(p);
    setActiveSection('stages');
  }, []);

  const deselectPipeline = useCallback(() => {
    setSelectedPipeline(null);
    setStages([]);
    setTransitions([]);
    setAutomations([]);
    setLinkedOutcomes([]);
    setStageActions([]);
    setActiveSection('list');
  }, []);

  // ═══ Pipeline CRUD ═══
  const createPipeline = useCallback(async (
    name: string, desc: string, stagesArr: any[], transArr: any[]
  ): Promise<string | null> => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('rpc_create_pipeline', {
        p_name: name,
        p_description: desc,
        p_stages: stagesArr,
        p_transitions: transArr,
      });
      if (e) throw e;
      await refreshPipelines();
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelines]);

  const updatePipeline = useCallback(async (
    id: string, name?: string, desc?: string, isDefault?: boolean
  ): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_update_pipeline', {
        p_pipeline_id: id,
        p_name: name ?? null,
        p_description: desc ?? null,
        p_is_default: isDefault ?? null,
      });
      if (e) throw e;
      await refreshPipelines();
      if (selectedPipeline?.id === id && name) {
        setSelectedPipeline(prev => prev ? { ...prev, name, description: desc ?? prev.description } : null);
      }
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelines, selectedPipeline]);

  const deletePipeline = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_pipeline', {
        p_pipeline_id: id,
      });
      if (e) throw e;
      if (selectedPipeline?.id === id) deselectPipeline();
      await refreshPipelines();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelines, selectedPipeline, deselectPipeline]);

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
      });
      if (e) throw e;
      await refreshPipelineData();
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline, refreshPipelineData]);

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
        p_linked_pipeline_id: args.linked_pipeline_id ?? null,
      });
      if (e) throw e;
      await refreshPipelineData();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

  const deleteStage = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_stage', {
        p_stage_id: id,
      });
      if (e) throw e;
      await refreshPipelineData();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

  const reorderTimerRef = useRef<NodeJS.Timeout | null>(null);
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
          resolve(true);
        } catch (e: any) {
          setError(`Failed to reorder: ${e.message}`);
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
  }, [selectedPipeline]);

  // ═══ Transition CRUD ═══
  const addTransition = useCallback(async (
    from: string, to: string, label: string, perm?: string
  ): Promise<string | null> => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('rpc_add_transition', {
        p_from_stage_id: from,
        p_to_stage_id: to,
        p_label: label,
        p_required_permission: perm || null,
      });
      if (e) throw e;
      await refreshPipelineData();
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

  const updateTransition = useCallback(async (
    id: string, label?: string, perm?: string
  ): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_update_transition', {
        p_transition_id: id,
        p_label: label ?? null,
        p_required_permission: perm ?? null,
      });
      if (e) throw e;
      await refreshPipelineData();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

  const deleteTransition = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_transition', {
        p_transition_id: id,
      });
      if (e) throw e;
      await refreshPipelineData();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

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
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline, refreshPipelineData]);

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
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

  const deleteAutomation = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_automation', {
        p_automation_id: id,
      });
      if (e) throw e;
      await refreshPipelineData();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

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
        p_precondition: args.precondition || null,
        p_transition_id: args.transition_id || null,
      });
      if (e) throw e;
      await refreshPipelineData();
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

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
        p_is_active: args.is_active ?? null,
      });
      if (e) throw e;
      await refreshPipelineData();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

  const deleteStageAction = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { error: e } = await supabase.rpc('rpc_delete_stage_action', {
        p_action_id: id,
      });
      if (e) throw e;
      await refreshPipelineData();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [refreshPipelineData]);

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
        pipelines, selectedPipeline, stages, transitions, automations, permissions,
        linkedOutcomes, stageActions,
        activeSection, loading, error, isOperationInFlight,
        setActiveSection, selectPipeline, deselectPipeline,
        refreshPipelines, refreshPipelineData,
        createPipeline, updatePipeline, deletePipeline,
        addStage, updateStage, deleteStage, reorderStages,
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
            return data;
          } catch (e: any) {
            setError(e.message);
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
            return true;
          } catch (e: any) {
            setError(e.message);
            return false;
          } finally {
            setLoading(false);
          }
        }
      }}
    >
      {children}
    </PipelineEditorContext.Provider>
  );
}
