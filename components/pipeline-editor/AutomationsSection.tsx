import { usePipelineEditor } from '@/contexts/PipelineEditorContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import AutomationEditor from './AutomationEditor';
import HarvestRuleEditor from './HarvestRuleEditor';

// Issue #284 -- Harvest rules live under the Automations tab, not as a peer
// top-level tab: both are stage-triggered pipeline rules that share the same
// automation_execution_log audit trail and heartbeat cron, and Harvest only
// ever applies to task pipelines (trg_tasks_harvest_deliverable fires on
// tasks.current_stage_id -- a project pipeline's stages never move a task
// through it, so a harvest rule there could never fire). Automations itself
// stays available for both subject kinds.
export default function AutomationsSection() {
  const colors = useThemeColors();
  const { selectedPipeline } = usePipelineEditor();
  const [subTab, setSubTab] = useState<'rules' | 'harvest'>('rules');

  const showHarvest = selectedPipeline?.subject_kind === 'task';
  const activeTab = subTab === 'harvest' && showHarvest ? 'harvest' : 'rules';

  return (
    <View className="flex-1">
      {showHarvest && (
        <View className="px-8 pt-4">
          <View className="flex-row gap-1.5 mb-2">
            {([
              { key: 'rules', label: 'Stage Rules', icon: 'bolt' },
              { key: 'harvest', label: 'Harvest', icon: 'cloud-download' },
            ] as const).map(t => {
              const isActive = activeTab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  onPress={() => setSubTab(t.key)}
                  className={`px-3 py-1.5 rounded-lg border flex-row items-center ${
                    isActive ? 'bg-brand-primary-dim border-brand-primary/30' : 'border-surface-border bg-surface-card'
                  }`}
                >
                  <FontAwesome name={t.icon as any} size={10} color={isActive ? colors.primary : colors.textDim} />
                  <Text className={`text-[11px] font-bold ml-1.5 ${isActive ? 'text-brand-primary' : 'text-typography-muted'}`}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text className="text-typography-dim text-[11px] mb-1">
            {activeTab === 'harvest'
              ? "Harvest rules copy a finished task's submitted files into a FileHub folder automatically — nothing to do with moving the task itself."
              : 'Stage rules automatically move a task or project to a different stage when a condition is met, without anyone clicking a button.'}
          </Text>
        </View>
      )}
      {activeTab === 'harvest' ? <HarvestRuleEditor /> : <AutomationEditor />}
    </View>
  );
}
