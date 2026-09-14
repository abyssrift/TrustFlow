import React from 'react';
import { TouchableOpacity, View, useWindowDimensions } from 'react-native';

export type ExplorerInspectorShellProps = {
  navigation?: React.ReactNode;
  header?: React.ReactNode;
  collection: React.ReactNode;
  inspector?: React.ReactNode;
  mobilePane: 'collection' | 'inspector';
  onRequestCollection: () => void;
  inspectorWidth?: number;
};

const DESKTOP_BREAKPOINT = 768;
const DEFAULT_INSPECTOR_WIDTH = 360;

/** Presentation-only responsive placement for explorer slots. */
export default function ExplorerInspectorShell({
  navigation,
  header,
  collection,
  inspector,
  mobilePane,
  onRequestCollection,
  inspectorWidth = DEFAULT_INSPECTOR_WIDTH,
}: ExplorerInspectorShellProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const showInspector = isDesktop ? Boolean(inspector) : mobilePane === 'inspector' && Boolean(inspector);

  return (
    <View className="flex-1 min-h-0 min-w-0 overflow-hidden" testID="explorer-inspector-shell">
      {navigation ? <View className="shrink-0" testID="explorer-navigation">{navigation}</View> : null}
      {header ? <View className="shrink-0" testID="explorer-header">{header}</View> : null}
      <View className={`flex-1 min-h-0 min-w-0 ${isDesktop ? 'flex-row' : 'flex-col'}`}>
        {(isDesktop || !showInspector) ? (
          <View className="flex-1 min-h-0 min-w-0 overflow-hidden" testID="explorer-collection-pane">
            {collection}
          </View>
        ) : null}
        {showInspector ? (
          <View
            className="flex-1 min-h-0 min-w-0 overflow-hidden"
            style={isDesktop ? { width: inspectorWidth, maxWidth: '100%', flexGrow: 0, flexShrink: 0, flexBasis: inspectorWidth } : undefined}
            testID="explorer-inspector-pane"
          >
            {!isDesktop ? (
              <TouchableOpacity
                accessibilityLabel="Back to collection"
                className="h-11 min-h-11 w-11 min-w-11 items-center justify-center"
                onPress={onRequestCollection}
                testID="explorer-mobile-back"
              >
                <View className="h-0.5 w-4 bg-typography-muted" />
              </TouchableOpacity>
            ) : null}
            {inspector}
          </View>
        ) : null}
      </View>
    </View>
  );
}
