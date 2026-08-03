import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/useThemeColors';

/**
 * One row per DISTINCT category: which board does this category of work sit
 * on, and which team owns it (issue #182 — "a 25-task template becomes four
 * decisions, not twenty-five").
 *
 * PROMOTED OUT OF BulkCreateProjectsSheet.tsx (#198). Plan §13.11 predicted
 * this exact moment: "this same category -> board/team picker will get mounted
 * again from the Work tab (#184), at which point it's worth promoting to a
 * shared component." It called out the consequence of not doing so too —
 * mounted at two moments, "building it twice would guarantee they diverge."
 * There are now two call sites:
 *
 *   1. components/projects/BulkCreateProjectsSheet.tsx — configure the batch
 *      at CREATION time.
 *   2. components/projects/ProjectAssignmentsTab.tsx — revisit that mapping
 *      any time AFTER, per project.
 *
 * Moved verbatim, deliberately: no behaviour change, no "while I'm here"
 * cleanup. An extraction that also edits is an extraction you cannot diff.
 * The only change is that `c` (theme colours) is now read from the hook rather
 * than threaded in as a prop — the caller passing its own copy of a global
 * hook's result was an artefact of living inside another component's body.
 */

export type Pipeline = { id: string; name: string; hasStages: boolean };
export type Team = { id: string; name: string; color: string | null };
export type CategoryValue = { pipeline_id: string | null; assignee_team_id: string | null };

export default function CategoryMappingRow({
  category, value, pipelines, teams, onChange,
}: {
  category: string;
  value: CategoryValue;
  pipelines: Pipeline[];
  teams: Team[];
  onChange: (next: CategoryValue) => void;
}) {
  const c = useThemeColors();
  const [openField, setOpenField] = useState<'board' | 'team' | null>(null);
  const board = pipelines.find(p => p.id === value.pipeline_id) || null;
  const team = teams.find(t => t.id === value.assignee_team_id) || null;

  return (
    <View className="bg-surface-background border border-surface-border rounded-2xl p-3" style={{ gap: 8 }}>
      <Text className="text-typography-main text-sm font-black">{category || 'Uncategorized'}</Text>
      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={() => setOpenField(f => (f === 'board' ? null : 'board'))}
          className={`flex-1 flex-row items-center justify-between px-3 rounded-lg border ${board ? 'border-surface-border' : 'border-state-danger'}`}
          style={{ minHeight: 44 }}
        >
          <Text className={`text-xs font-bold flex-1 ${board ? 'text-typography-main' : 'text-typography-dim'}`} numberOfLines={1}>
            {board ? board.name : 'Board (required)'}
          </Text>
          <FontAwesome name={openField === 'board' ? 'chevron-up' : 'chevron-down'} size={10} color={c.textDim} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setOpenField(f => (f === 'team' ? null : 'team'))}
          className="flex-1 flex-row items-center justify-between px-3 rounded-lg border border-surface-border"
          style={{ minHeight: 44 }}
        >
          <Text className={`text-xs font-bold flex-1 ${team ? 'text-typography-main' : 'text-typography-dim'}`} numberOfLines={1}>
            {team ? team.name : 'Team (optional)'}
          </Text>
          <FontAwesome name={openField === 'team' ? 'chevron-up' : 'chevron-down'} size={10} color={c.textDim} />
        </TouchableOpacity>
      </View>

      {openField === 'board' && (
        <View className="border-t border-surface-border pt-2" style={{ gap: 2 }}>
          {pipelines.length === 0 && <Text className="text-typography-dim text-xs italic px-2 py-1">No boards yet — create one first.</Text>}
          {pipelines.map(p => (
            <TouchableOpacity
              key={p.id}
              disabled={!p.hasStages}
              onPress={() => { onChange({ ...value, pipeline_id: p.id }); setOpenField(null); }}
              className="flex-row items-center justify-between px-3 py-2.5 rounded-lg"
              style={{ opacity: p.hasStages ? 1 : 0.4 }}
            >
              <Text className={`text-xs font-bold ${p.id === value.pipeline_id ? 'text-brand-primary' : 'text-typography-main'}`}>{p.name}</Text>
              {!p.hasStages && <Text className="text-state-danger text-[9px] font-black uppercase">No stages</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {openField === 'team' && (
        <View className="border-t border-surface-border pt-2" style={{ gap: 2 }}>
          <TouchableOpacity
            onPress={() => { onChange({ ...value, assignee_team_id: null }); setOpenField(null); }}
            className="flex-row items-center px-3 py-2.5 rounded-lg"
          >
            <Text className={`text-xs font-bold ${!value.assignee_team_id ? 'text-brand-primary' : 'text-typography-muted'}`}>No team</Text>
          </TouchableOpacity>
          {teams.map(t => (
            <TouchableOpacity
              key={t.id}
              onPress={() => { onChange({ ...value, assignee_team_id: t.id }); setOpenField(null); }}
              className="flex-row items-center gap-2 px-3 py-2.5 rounded-lg"
            >
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.color ?? c.primary }} />
              <Text className={`text-xs font-bold ${t.id === value.assignee_team_id ? 'text-brand-primary' : 'text-typography-main'}`}>{t.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}
