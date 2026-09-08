import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import Popup from '@/components/common/Popup';
import SpreadsheetImportSheet from '@/components/projects/SpreadsheetImportSheet';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated?: (portfolioId: string) => void;
};

type Method = 'manual' | 'spreadsheet';

/** The canonical portfolio-creation surface: manual or spreadsheet intake. */
export default function CreatePortfolioModal({ visible, onClose, onCreated }: Props) {
  const colors = useThemeColors();
  const { successToast, errorToast } = useToast();
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const [method, setMethod] = useState<Method>('manual');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const nameMissing = !name.trim();

  useEffect(() => {
    if (visible) {
      setMethod('manual');
      setName('');
      setSaving(false);
    }
  }, [visible]);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      errorToast('A portfolio needs a name before it can be created.');
      return;
    }
    if (saving) return;

    try {
      setSaving(true);
      const { data, error } = await supabase.rpc('rpc_create_portfolio', { p_name: trimmed });
      if (error) throw error;

      successToast('Portfolio created.');
      if (data?.id) onCreated?.(data.id);
      onClose();
    } catch (error: any) {
      console.error('Portfolio create error:', error);
      errorToast(error?.message || 'Could not create this portfolio.');
    } finally {
      setSaving(false);
    }
  };

  if (method === 'spreadsheet') {
    return (
      <SpreadsheetImportSheet
        visible={visible}
        onClose={() => {
          setMethod('manual');
          onClose();
        }}
        onCreated={result => onCreated?.(result.portfolio_id)}
      />
    );
  }

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="auto"
      maxWidth={760}
      title="Create portfolio"
      footer="dual-action"
      secondaryAction={{ label: 'Cancel', onPress: onClose }}
      primaryAction={{
        label: saving ? 'Creating…' : 'Create',
        onPress: handleCreate,
        variant: saving || nameMissing ? 'disabled' : 'default',
      }}
    >
      <View className={`px-6 py-5 ${isDesktop ? 'flex-row gap-6' : 'gap-5'}`}>
        <View className="flex-1 gap-4">
          <View className="gap-1">
            <Text className="text-typography-main text-base font-black">Create manually</Text>
            <Text className="text-typography-muted text-sm">
              Start with an empty portfolio, then add projects when you are ready.
            </Text>
          </View>
          <View className="gap-2">
            <Text className="text-typography-muted text-xs font-bold uppercase tracking-widest">
              Portfolio name
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Q4 Client Campaign"
              placeholderTextColor={colors.textDim}
              accessibilityLabel="Portfolio name"
              autoFocus
              editable={!saving}
              className="min-h-11 rounded-xl border border-surface-border bg-surface-card px-3 text-typography-main"
            />
            <Text className="text-typography-muted text-xs">
              Give it a clear name so your team can find it later.
            </Text>
          </View>
        </View>

        <View className={isDesktop ? 'w-64' : 'w-full'}>
          <TouchableOpacity
            onPress={() => setMethod('spreadsheet')}
            accessibilityRole="button"
            accessibilityLabel="Import portfolio projects from Excel or CSV"
            className={`min-h-11 rounded-2xl border border-state-info bg-surface-card px-4 py-4 hover:bg-surface-overlay active:bg-surface-background ${isDesktop ? 'h-full' : ''}`}
          >
            <View className="mb-3 h-10 w-10 items-center justify-center rounded-xl bg-state-info">
              <FontAwesome name="file-excel-o" size={18} color="white" />
            </View>
            <Text className="text-typography-main text-sm font-black">Advanced Excel / CSV intake</Text>
            <Text className="text-typography-muted mt-1 text-xs leading-5">
              Detect the table, map columns, resolve clients, and preview every project before anything is created.
            </Text>
            <View className="mt-3 flex-row items-center gap-2">
              <Text className="text-state-info text-xs font-black">Open guided import</Text>
              <FontAwesome name="arrow-right" size={11} color={colors.info} />
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </Popup>
  );
}
