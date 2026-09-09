import { FontAwesome } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { FileHubFolder, folderAncestors } from '@/contexts/FileHubContext';

// Explorer-style destination picker: click a folder to select it as the upload
// target, click its chevron to expand/collapse children. Replaces the old
// horizontal chip strip that didn't scale past a handful of flat folders.
// Colors are passed in and applied inline — token-class colors go black inside
// a RN Modal on web (see NativeWind modal-colors note).
export default function FolderTreePicker({
  folders,
  selectedId,
  onSelect,
  colors,
  maxHeight = 220,
  scrollable = true,
}: {
  folders: FileHubFolder[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  colors: any;
  maxHeight?: number;
  scrollable?: boolean;
}) {
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, FileHubFolder[]>();
    for (const f of folders) {
      const key = f.parent_id ?? null;
      (map.get(key) ?? map.set(key, []).get(key)!).push(f);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [folders]);

  // Start with the selected folder's ancestors expanded so the current target
  // is visible without hunting.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(selectedId ? folderAncestors(folders, selectedId).map(f => f.id) : [])
  );

  // The picker can stay mounted while the caller changes the destination or
  // while folders finish loading. Add the new target's ancestor chain without
  // resetting branches the user explicitly opened or closed.
  useEffect(() => {
    if (!selectedId) return;
    const ancestors = folderAncestors(folders, selectedId).map(f => f.id);
    if (ancestors.length === 0) return;
    setExpanded(prev => {
      const next = new Set(prev);
      ancestors.forEach(id => next.add(id));
      return next.size === prev.size ? prev : next;
    });
  }, [folders, selectedId]);

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const Row = ({ folder, depth }: { folder: FileHubFolder | null; depth: number }) => {
    const id = folder?.id ?? null;
    const kids = childrenOf.get(id) ?? [];
    const isSelected = selectedId === id;
    const isOpen = id === null || expanded.has(id);
    return (
      <>
        <TouchableOpacity
          onPress={() => onSelect(id)}
          accessibilityRole="button"
          accessibilityLabel={id === null ? 'Top level (no folder)' : folder!.name}
          accessibilityState={{ selected: isSelected }}
          className="min-h-11 flex-row items-center rounded-lg"
          style={{
            paddingVertical: 7,
            paddingRight: 10,
            paddingLeft: 6 + depth * 16,
            backgroundColor: isSelected ? colors.primary + '1a' : 'transparent',
          }}
        >
          <TouchableOpacity
            onPress={(event) => {
              event.stopPropagation();
              if (folder) toggle(folder.id);
            }}
            accessibilityRole="button"
            accessibilityLabel={folder ? `${isOpen ? 'Collapse' : 'Expand'} ${folder.name}` : undefined}
            accessibilityState={{ expanded: folder ? isOpen : undefined, disabled: id === null || kids.length === 0 }}
            className="min-h-11 min-w-11 items-center justify-center"
            disabled={id === null || kids.length === 0}
          >
            {id !== null && kids.length > 0 && (
              <FontAwesome name={isOpen ? 'chevron-down' : 'chevron-right'} size={9} color={colors.textMuted} />
            )}
          </TouchableOpacity>
          <FontAwesome
            name={id === null ? 'inbox' : isOpen && kids.length > 0 ? 'folder-open-o' : 'folder-o'}
            size={13}
            color={isSelected ? colors.primary : id === null ? colors.textMuted : '#f59e0b'}
            style={{ marginRight: 8 }}
          />
          <Text
            numberOfLines={1}
            className="text-xs font-bold flex-1"
            style={{ color: isSelected ? colors.primary : colors.textMain }}
          >
            {id === null ? 'Top level (no folder)' : folder!.name}
          </Text>
          {isSelected && <FontAwesome name="check" size={10} color={colors.primary} />}
        </TouchableOpacity>
        {isOpen && kids.map(k => <Row key={k.id} folder={k} depth={depth + 1} />)}
      </>
    );
  };

  const containerStyle = {
    ...(scrollable ? { maxHeight } : {}),
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.background,
  };

  if (!scrollable) {
    return (
      <View style={containerStyle}>
        <View style={{ padding: 6 }}>
          <Row folder={null} depth={0} />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={containerStyle}
      contentContainerStyle={{ padding: 6 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <Row folder={null} depth={0} />
    </ScrollView>
  );
}
