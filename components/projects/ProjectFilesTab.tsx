import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, View } from 'react-native';

// #184 -- PLACEHOLDER TAB CONTENT. The Files tab is Phase 4 (#174)'s job: a
// single view surfacing client-level standing files (inputs, plan §6) and
// the project-level sealed deliverable (output), never copying one into the
// other. rpc_project_dashboard carries no file data at all, so unlike
// Overview/Work there is nothing real to show yet -- this is intentionally
// an empty state, not a thin re-render of something else.
//
// Explicitly out of scope here: any file picker/upload UI. That goes through
// contexts/UploadManagerContext.tsx when #174 builds it -- not duplicated or
// stubbed in this file.

export default function ProjectFilesTab() {
  const colors = useThemeColors();
  return (
    <View className="flex-1 items-center justify-center py-24 px-8">
      <View className="bg-surface-card border border-surface-border rounded-full p-6 mb-5">
        <FontAwesome name="folder-open-o" size={28} color={colors.textDim} />
      </View>
      <Text className="text-typography-main text-base font-black">Files land here in Phase 4</Text>
      <Text className="text-typography-muted text-sm text-center mt-2 max-w-md leading-5">
        This tab will surface the client's standing files (references, inputs — plan §6) alongside this
        project's sealed deliverable, without copying either into the other. Tracked in #174.
      </Text>
    </View>
  );
}
