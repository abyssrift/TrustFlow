import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import DraggableSheet from '@/components/common/DraggableSheet';
import Popup from '@/components/common/Popup';
import { Permission } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { ROLE_TEMPLATES } from '@/lib/roleTemplates';
import type { RoleEditorSheetProps } from './RoleEditorSheet';

// Legacy duplicate permission keys still in the DB. The legacy twin is hidden in
// the UI and kept in sync with its modern key on toggle so old checks keep working.
const LEGACY_TWINS: Record<string, string> = {
  'task.create': 'tasks.create',
  'task.assign': 'tasks.assign',
  'task.view_all': 'tasks.view_all',
  'task.delete': 'tasks.delete',
  'task.edit': 'tasks.update',
};

// Permissions that grant destructive or company-wide power; badged in the list.
const SENSITIVE_KEYS = new Set([
  'archive.delete',
  'system.view_all_data',
  'role.manage_global',
  'role.manage',
  'filehub:bin_empty',
  'user.deactivate',
  'company.billing',
]);

export default function RoleEditorSheet({
  visible,
  onClose,
  isCreating,
  editingRole,
  name,
  onChangeName,
  description,
  onChangeDescription,
  color,
  onChangeColor,
  selectedPerms,
  onTogglePerm,
  permissions,
  categories,
  isGlobal,
  canEdit,
  onSave,
  loading,
  onClone,
  onBulkToggle,
  onApplyTemplate,
}: RoleEditorSheetProps) {
  const c = useThemeColors();
  const [query, setQuery] = useState('');

  const idByKey = new Map(permissions.map(p => [p.key, p.id]));
  const legacyIds = new Set(Object.values(LEGACY_TWINS).map(k => idByKey.get(k)).filter((id): id is string => !!id));
  const basePerms = permissions.filter(p => !legacyIds.has(p.id));
  const twinIds = (p: Permission) => {
    const legacyId = LEGACY_TWINS[p.key] ? idByKey.get(LEGACY_TWINS[p.key]) : undefined;
    return legacyId ? [p.id, legacyId] : [p.id];
  };
  const isPermActive = (p: Permission) => twinIds(p).some(id => selectedPerms.includes(id));
  const togglePerm = (p: Permission) => {
    const ids = twinIds(p);
    if (ids.length > 1 && onBulkToggle) onBulkToggle(ids, !isPermActive(p));
    else onTogglePerm(p.id);
  };

  // Unsaved-changes guard: snapshot on open, confirm before discarding on close.
  const snap = () => JSON.stringify([name, description, color, [...selectedPerms].sort()]);
  const snapRef = useRef('');
  useEffect(() => {
    if (visible) {
      setQuery('');
      snapRef.current = snap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const requestClose = () => {
    if (snapRef.current !== snap() && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  };

  const q = query.trim().toLowerCase();
  const visiblePerms = q
    ? basePerms.filter((p: Permission) =>
        p.label.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q))
    : basePerms;
  const visibleCategories = categories.filter(cat => visiblePerms.some(p => p.category === cat));

  const selCount = (cat: string) => basePerms.filter(p => p.category === cat && isPermActive(p)).length;
  const catTotal = (cat: string) => basePerms.filter(p => p.category === cat).length;
  const activeCount = basePerms.filter(isPermActive).length;
  const sensitiveActive = basePerms.filter(p => SENSITIVE_KEYS.has(p.key) && isPermActive(p)).length;

  const { width: screenWidth } = useWindowDimensions();
  const isNarrow = screenWidth < 768;

  // ─── Mobile-web layout (narrow viewports) ───────────────────────────────────
  if (isNarrow) {
    return (
      <DraggableSheet
        visible={visible}
        onClose={requestClose}
        dimBackdrop
        maxHeight="92%"
        containerClassName="rounded-t-3xl overflow-hidden"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-3 pb-5" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View className="flex-1 mr-4">
            <Text style={{ color: c.textMuted }} className="text-[9px] font-black uppercase tracking-[0.3em] mb-1">Role Editor</Text>
            <Text style={{ color: c.textMain }} className="text-xl font-black tracking-tight" numberOfLines={1}>
              {isCreating ? 'New Role' : (editingRole?.name || 'Edit Role')}
            </Text>
          </View>
          {editingRole && onClone && (
            <TouchableOpacity
              onPress={onClone}
              className="flex-row items-center px-3 py-2 rounded-xl mr-2"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <FontAwesome name="clone" size={11} color={c.primary} />
              <Text style={{ color: c.textMain }} className="font-black text-[9px] uppercase tracking-widest ml-1.5">Duplicate</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={requestClose} className="w-9 h-9 items-center justify-center rounded-full" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
            <FontAwesome name="times" size={14} color={c.textMain} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} className="px-5" contentContainerStyle={{ paddingBottom: 24 }}>
          {/* System protected */}
          {isGlobal && (
            <View className="p-4 rounded-2xl mb-5 flex-row items-center" style={{ backgroundColor: c.info + '1A', borderWidth: 1, borderColor: c.info + '4D' }}>
              <View className="w-9 h-9 rounded-full items-center justify-center mr-3 flex-shrink-0" style={{ backgroundColor: c.info + '33' }}>
                <FontAwesome name="shield" size={16} color={c.info} />
              </View>
              <View className="flex-1">
                <Text style={{ color: c.textMain }} className="font-black text-xs uppercase tracking-tight mb-1">System Protected</Text>
                <Text style={{ color: c.textMuted }} className="text-[10px] leading-4">Platform-wide role. Duplicate it to make an editable copy.</Text>
              </View>
            </View>
          )}

          {/* Quick start templates (creating only) */}
          {isCreating && onApplyTemplate && (
            <>
              <Text style={{ color: c.primary }} className="text-[10px] font-black uppercase mb-3 tracking-widest">Quick Start</Text>
              <View className="flex-row flex-wrap gap-2 mb-6">
                {ROLE_TEMPLATES.map(tpl => (
                  <TouchableOpacity
                    key={tpl.id}
                    onPress={() => onApplyTemplate(tpl)}
                    className="flex-row items-center px-3 py-2 rounded-xl"
                    style={{ backgroundColor: c.background, borderWidth: 1, borderColor: name === tpl.name ? tpl.color : c.border }}
                  >
                    <FontAwesome name={tpl.icon as any} size={11} color={tpl.color} />
                    <Text style={{ color: c.textMain }} className="font-black text-[10px] ml-2">{tpl.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Identity section */}
          <Text style={{ color: c.primary }} className="text-[10px] font-black uppercase mb-3 tracking-widest">Identity</Text>
          <TextInput
            value={name}
            onChangeText={onChangeName}
            editable={canEdit}
            placeholder="Role name"
            placeholderTextColor={c.textMuted}
            className="rounded-xl px-4 py-3.5 font-black text-sm mb-3"
            style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain, opacity: !canEdit ? 0.5 : 1 }}
          />
          <TextInput
            value={description}
            onChangeText={onChangeDescription}
            editable={canEdit}
            placeholder="Description..."
            placeholderTextColor={c.textMuted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            className="rounded-xl px-4 py-3.5 text-sm mb-5 h-24 leading-5"
            style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain, opacity: !canEdit ? 0.5 : 1 }}
          />

          {/* Color section */}
          <View className="flex-row items-center justify-between mb-3">
            <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest">Color</Text>
            <Text style={{ color: c.primary }} className="font-black text-[10px]">{color}</Text>
          </View>
          <View className="flex-row flex-wrap gap-2.5 mb-6" style={{ opacity: !canEdit ? 0.5 : 1 }}>
            {[c.primary, c.success, c.warning, c.danger, '#6366f1', '#10b981', c.info, c.border].map(swatch => (
              <TouchableOpacity
                key={swatch}
                onPress={() => canEdit && onChangeColor(swatch)}
                className="w-8 h-8 rounded-xl"
                style={{ backgroundColor: swatch, borderWidth: 2, borderColor: color === swatch ? '#fff' : 'transparent' }}
              />
            ))}
          </View>

          {/* Permissions search */}
          <View className="flex-row items-center px-4 py-2.5 gap-3 mb-4 rounded-xl" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: q ? c.primary : c.border }}>
            <FontAwesome name="search" size={13} color={q ? c.primary : c.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Filter permissions..."
              placeholderTextColor={c.textMuted}
              className="flex-1 text-sm font-bold py-1"
              style={{ color: c.textMain, outlineWidth: 0 } as any}
            />
            {q.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} className="w-7 h-7 items-center justify-center rounded-full" style={{ backgroundColor: c.background }}>
                <FontAwesome name="times" size={11} color={c.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Permissions list */}
          <View className="gap-4">
            {visibleCategories.length === 0 && (
              <Text style={{ color: c.textMuted }} className="text-xs font-bold text-center mt-6">No permissions match &ldquo;{query}&rdquo;.</Text>
            )}
            {visibleCategories.map(cat => {
              const catPerms = visiblePerms.filter(p => p.category === cat);
              const catIds = catPerms.flatMap(twinIds);
              const allSelected = catPerms.every(isPermActive);
              return (
                <View key={cat}>
                  <View className="flex-row items-center mb-2.5">
                    <View className="w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: c.primary }} />
                    <Text style={{ color: c.textMain }} className="text-[11px] font-black uppercase tracking-widest flex-1">{cat}</Text>
                    <Text style={{ color: c.textMuted }} className="text-[10px] font-black mr-2">{selCount(cat)}/{catTotal(cat)}</Text>
                    {canEdit && onBulkToggle && (
                      <TouchableOpacity
                        onPress={() => onBulkToggle(catIds, !allSelected)}
                        className="px-2.5 py-1 rounded-lg"
                        style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
                      >
                        <Text style={{ color: allSelected ? c.textMuted : c.primary }} className="text-[8px] font-black uppercase tracking-widest">
                          {allSelected ? 'Clear' : 'All'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View className="gap-1.5">
                    {catPerms.map(perm => {
                      const isActive = isPermActive(perm);
                      return (
                        <TouchableOpacity
                          key={perm.id}
                          onPress={() => canEdit && togglePerm(perm)}
                          className="flex-row items-center px-3.5 py-2.5 rounded-xl"
                          style={{
                            backgroundColor: isActive ? c.primary + '0D' : 'transparent',
                            borderWidth: 1,
                            borderColor: isActive ? c.primary + '66' : c.border,
                            opacity: !canEdit ? 0.7 : 1,
                          }}
                        >
                          <View className="w-5 h-5 rounded-md items-center justify-center mr-3 flex-shrink-0" style={{ backgroundColor: isActive ? c.primary : 'transparent', borderWidth: 1, borderColor: isActive ? c.primary : c.border }}>
                            {isActive && <FontAwesome name="check" size={9} color="white" />}
                          </View>
                          <View className="flex-1" style={{ minWidth: 0 }}>
                            <View className="flex-row items-center">
                              <Text style={{ color: isActive ? c.textMain : c.textMuted }} className="font-black text-xs tracking-tight flex-shrink" numberOfLines={1}>{perm.label}</Text>
                              {SENSITIVE_KEYS.has(perm.key) && (
                                <View className="ml-2 px-1.5 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: c.danger + '1A' }}>
                                  <Text style={{ color: c.danger }} className="text-[7px] font-black uppercase tracking-widest">High impact</Text>
                                </View>
                              )}
                            </View>
                            <Text style={{ color: c.textDim }} className="text-[10px] font-bold leading-4" numberOfLines={1}>{perm.description || '(no documentation)'}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* Footer */}
        <View className="flex-row items-center gap-3 px-5 py-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
          <Text style={{ color: c.textMuted }} className="flex-1 text-[10px] font-black uppercase tracking-widest">
            {activeCount} selected{sensitiveActive > 0 ? ` · ${sensitiveActive} high` : ''}
          </Text>
          <TouchableOpacity onPress={requestClose} className="px-6 py-3 rounded-xl items-center" style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}>
            <Text style={{ color: c.textMuted }} className="font-black text-[10px] uppercase tracking-widest">Cancel</Text>
          </TouchableOpacity>
          {canEdit ? (
            <TouchableOpacity onPress={onSave} disabled={loading} className="px-7 py-3 rounded-xl items-center" style={{ backgroundColor: c.primary, opacity: loading ? 0.6 : 1 }}>
              <Text className="text-white font-black text-[10px] uppercase tracking-widest">Save</Text>
            </TouchableOpacity>
          ) : (
            editingRole && onClone && (
              <TouchableOpacity onPress={onClone} className="px-7 py-3 rounded-xl items-center" style={{ backgroundColor: c.primary }}>
                <Text className="text-white font-black text-[10px] uppercase tracking-widest">Duplicate</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </DraggableSheet>
    );
  }

  // ─── Desktop-web layout (wide viewports) ────────────────────────────────────
  return (
    <Popup
      visible={visible}
      onClose={requestClose}
      presentation="centered"
      maxWidth={1020}
      scrollable={false}
      containerStyle={{ height: '86%' }}
    >
      <View style={{ flex: 1, minHeight: 0 }}>
        {/* Header */}
        <View className="flex-row items-center px-7 pt-6 pb-5" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
          <View className="flex-1 mr-4">
            <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-[0.3em] mb-1">Role Editor</Text>
            <Text style={{ color: c.textMain }} className="text-2xl font-black tracking-tight" numberOfLines={1}>
              {isCreating ? 'New Role' : (editingRole?.name || 'Edit Role')}
            </Text>
          </View>
          {editingRole && onClone && (
            <TouchableOpacity
              onPress={onClone}
              className="flex-row items-center px-4 py-2.5 rounded-xl mr-3 active:scale-[0.98]"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <FontAwesome name="clone" size={12} color={c.primary} />
              <Text style={{ color: c.textMain }} className="font-black text-[10px] uppercase tracking-widest ml-2">Duplicate</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={requestClose}
            className="w-10 h-10 items-center justify-center rounded-full"
            style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
          >
            <FontAwesome name="times" size={16} color={c.textMain} />
          </TouchableOpacity>
        </View>

        {/* Body: two columns */}
        <View style={{ flexDirection: 'row', flex: 1, minHeight: 0 }}>
          {/* Left: identity, color, summary */}
          <ScrollView
            style={{ width: 320, flexGrow: 0, borderRightWidth: 1, borderRightColor: c.border }}
            contentContainerStyle={{ padding: 24, paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
          >
            {isGlobal && (
              <View
                className="p-4 rounded-2xl mb-5 flex-row items-center"
                style={{ backgroundColor: c.info + '1A', borderWidth: 1, borderColor: c.info + '4D' }}
              >
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3 flex-shrink-0" style={{ backgroundColor: c.info + '33' }}>
                  <FontAwesome name="shield" size={16} color={c.info} />
                </View>
                <View className="flex-1">
                  <Text style={{ color: c.textMain }} className="font-black text-xs uppercase tracking-tight mb-1">System Protected</Text>
                  <Text style={{ color: c.textMuted }} className="text-[10px] leading-4">Platform-wide role. Duplicate it to make an editable copy.</Text>
                </View>
              </View>
            )}

            {/* Quick start templates (creating only) */}
            {isCreating && onApplyTemplate && (
              <>
                <Text style={{ color: c.primary }} className="text-[10px] font-black uppercase mb-3 tracking-widest">Quick Start</Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                  {ROLE_TEMPLATES.map(tpl => (
                    <TouchableOpacity
                      key={tpl.id}
                      onPress={() => onApplyTemplate(tpl)}
                      className="flex-row items-center px-3 py-2 rounded-xl"
                      style={{ backgroundColor: c.background, borderWidth: 1, borderColor: name === tpl.name ? tpl.color : c.border }}
                    >
                      <FontAwesome name={tpl.icon as any} size={11} color={tpl.color} />
                      <Text style={{ color: c.textMain }} className="font-black text-[10px] ml-2">{tpl.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {/* Identity section */}
            <Text style={{ color: c.primary }} className="text-[10px] font-black uppercase mb-3 tracking-widest">Identity</Text>
            <TextInput
              value={name}
              onChangeText={onChangeName}
              editable={canEdit}
              placeholder="Role name"
              placeholderTextColor={c.textMuted}
              style={{
                backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain,
                opacity: !canEdit ? 0.5 : 1,
              }}
              className="rounded-xl px-4 py-3.5 font-black text-sm mb-3"
            />
            <TextInput
              value={description}
              onChangeText={onChangeDescription}
              editable={canEdit}
              placeholder="Description..."
              placeholderTextColor={c.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{
                backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain,
                opacity: !canEdit ? 0.5 : 1,
              }}
              className="rounded-xl px-4 py-3.5 text-sm mb-6 h-24 leading-5"
            />

            {/* Color section */}
            <View className="flex-row items-center justify-between mb-3">
              <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest">Color</Text>
              <Text style={{ color: c.primary }} className="font-black text-[10px]">{color}</Text>
            </View>
            <View className="flex-row flex-wrap gap-2.5 mb-6" style={{ opacity: !canEdit ? 0.5 : 1 }}>
              {[c.primary, c.success, c.warning, c.danger, '#6366f1', '#10b981', c.info, c.border].map(swatch => (
                <TouchableOpacity
                  key={swatch}
                  onPress={() => canEdit && onChangeColor(swatch)}
                  className="w-8 h-8 rounded-xl"
                  style={{ backgroundColor: swatch, borderWidth: 2, borderColor: color === swatch ? '#fff' : 'transparent' }}
                />
              ))}
            </View>

            <View className="mb-5" style={{ height: 1, backgroundColor: c.border }} />

            {/* Live summary */}
            <Text style={{ color: c.primary }} className="text-[10px] font-black uppercase mb-3 tracking-widest">Summary</Text>
            <Text style={{ color: c.textMain }} className="font-black text-sm mb-1">
              {activeCount} of {basePerms.length} permissions
            </Text>
            {sensitiveActive > 0 && (
              <Text style={{ color: c.danger }} className="text-[10px] font-black uppercase tracking-widest mb-3">
                {sensitiveActive} high-impact
              </Text>
            )}
            <View className="mb-2" />
            <View className="gap-1.5">
              {categories.map(cat => {
                const n = selCount(cat);
                return (
                  <View key={cat} className="flex-row items-center justify-between">
                    <Text style={{ color: n > 0 ? c.textMain : c.textDim }} className="text-[10px] font-black uppercase tracking-widest">{cat}</Text>
                    <Text style={{ color: n > 0 ? c.primary : c.textDim }} className="text-[10px] font-black">{n}/{catTotal(cat)}</Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Right: searchable permissions */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View className="flex-row items-center px-6 py-3 gap-3" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
              <FontAwesome name="search" size={13} color={c.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Filter permissions..."
                placeholderTextColor={c.textMuted}
                className="flex-1 text-sm font-bold py-1.5"
                style={{ color: c.textMain, outlineWidth: 0 } as any}
              />
              {q.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} className="w-7 h-7 items-center justify-center rounded-full" style={{ backgroundColor: c.background }}>
                  <FontAwesome name="times" size={11} color={c.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32, gap: 20 }} showsVerticalScrollIndicator={false}>
              {visibleCategories.length === 0 && (
                <Text style={{ color: c.textMuted }} className="text-xs font-bold text-center mt-10">No permissions match &ldquo;{query}&rdquo;.</Text>
              )}
              {visibleCategories.map(cat => {
                const catPerms = visiblePerms.filter(p => p.category === cat);
                const catIds = catPerms.flatMap(twinIds);
                const allSelected = catPerms.every(isPermActive);
                return (
                  <View key={cat}>
                    <View className="flex-row items-center mb-2.5">
                      <View className="w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: c.primary }} />
                      <Text style={{ color: c.textMain }} className="text-[11px] font-black uppercase tracking-widest flex-1">{cat}</Text>
                      <Text style={{ color: c.textMuted }} className="text-[10px] font-black mr-3">{selCount(cat)}/{catTotal(cat)}</Text>
                      {canEdit && onBulkToggle && (
                        <TouchableOpacity
                          onPress={() => onBulkToggle(catIds, !allSelected)}
                          className="px-3 py-1.5 rounded-lg"
                          style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
                        >
                          <Text style={{ color: allSelected ? c.textMuted : c.primary }} className="text-[9px] font-black uppercase tracking-widest">
                            {allSelected ? 'Clear' : 'All'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View className="gap-1.5">
                      {catPerms.map(perm => {
                        const isActive = isPermActive(perm);
                        return (
                          <TouchableOpacity
                            key={perm.id}
                            onPress={() => canEdit && togglePerm(perm)}
                            className="flex-row items-center px-3.5 py-2.5 rounded-xl"
                            style={{
                              backgroundColor: isActive ? c.primary + '0D' : 'transparent',
                              borderWidth: 1,
                              borderColor: isActive ? c.primary + '66' : c.border,
                              opacity: !canEdit ? 0.7 : 1,
                            }}
                          >
                            <View
                              className="w-5 h-5 rounded-md items-center justify-center mr-3 flex-shrink-0"
                              style={{ backgroundColor: isActive ? c.primary : 'transparent', borderWidth: 1, borderColor: isActive ? c.primary : c.border }}
                            >
                              {isActive && <FontAwesome name="check" size={9} color="white" />}
                            </View>
                            <View className="flex-1" style={{ minWidth: 0 }}>
                              <View className="flex-row items-center">
                                <Text style={{ color: isActive ? c.textMain : c.textMuted }} className="font-black text-xs tracking-tight flex-shrink" numberOfLines={1}>{perm.label}</Text>
                                {SENSITIVE_KEYS.has(perm.key) && (
                                  <View className="ml-2 px-1.5 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: c.danger + '1A' }}>
                                    <Text style={{ color: c.danger }} className="text-[8px] font-black uppercase tracking-widest">High impact</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={{ color: c.textDim }} className="text-[10px] font-bold leading-4" numberOfLines={1}>{perm.description || '(no documentation)'}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* Footer */}
        <View className="flex-row items-center px-7 py-4 gap-3" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
          <Text style={{ color: c.textMuted }} className="flex-1 text-[10px] font-black uppercase tracking-widest">
            {activeCount} permissions selected{sensitiveActive > 0 ? ` · ${sensitiveActive} high-impact` : ''}
          </Text>
          <TouchableOpacity
            onPress={requestClose}
            className="px-8 py-3.5 rounded-xl items-center"
            style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
          >
            <Text style={{ color: c.textMuted }} className="font-black text-[11px] uppercase tracking-widest">Cancel</Text>
          </TouchableOpacity>
          {canEdit ? (
            <TouchableOpacity
              onPress={onSave}
              disabled={loading}
              className="px-10 py-3.5 rounded-xl items-center"
              style={{ backgroundColor: c.primary, opacity: loading ? 0.6 : 1 }}
            >
              <Text className="text-white font-black text-[11px] uppercase tracking-widest">Save Role</Text>
            </TouchableOpacity>
          ) : (
            editingRole && onClone && (
              <TouchableOpacity
                onPress={onClone}
                className="px-10 py-3.5 rounded-xl items-center"
                style={{ backgroundColor: c.primary }}
              >
                <Text className="text-white font-black text-[11px] uppercase tracking-widest">Duplicate to Edit</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>
    </Popup>
  );
}
