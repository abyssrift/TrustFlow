import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, Text, TextInput, View } from 'react-native';

import Calendar from '@/components/common/Calendar';
import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { EntityGlyph } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';

/**
 * Issue #259 — the only edit door for a portfolio's identity: its company /
 * client picture, its name, and its target date.
 *
 * The picture flow is the profile picture's, verbatim (ProfileAvatar):
 * expo-image-picker crop → upload to a storage bucket → save the public URL
 * on the row. The only differences are the bucket (`portfolio-covers`) and
 * the folder prefix (the portfolio id, which is what the bucket's RLS
 * policies key on — path_tokens[1]).
 *
 * Save goes through rpc_update_portfolio (SECURITY DEFINER), NOT a direct
 * .from('portfolios').update() — portfolios has no UPDATE RLS policy and all
 * writes are RPC-shaped (see 20260801_spreadsheet_intake_portfolio_folder.sql
 * for the convention).
 */
export default function PortfolioEditModal({
  visible,
  onClose,
  onSaved,
  portfolio,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  portfolio: { id: string; name: string; cover_url: string | null; target_date: string | null } | null;
}) {
  const c = useThemeColors();
  const { successToast, errorToast } = useToast();

  const [name, setName] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const uploadedPathsRef = useRef<string[]>([]);

  useEffect(() => setCoverBroken(false), [coverUrl]);

  useEffect(() => {
    if (visible && portfolio) {
      setName(portfolio.name);
      setCoverUrl(portfolio.cover_url);
      setTargetDate(portfolio.target_date ? new Date(portfolio.target_date).toISOString().split('T')[0] : null);
      setShowCalendar(false);
      uploadedPathsRef.current = [];
    }
  }, [visible, portfolio?.id, portfolio?.name, portfolio?.cover_url, portfolio?.target_date]);

  const uploadCover = async () => {
    if (!portfolio) return;
    try {
      setUploading(true);

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.7,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const image = result.assets[0];
      const fileExt = image.mimeType?.split('/')[1] || image.uri.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${portfolio.id}/${fileName}`;

      let fileBody: Blob | File | FormData | null = null;
      if (Platform.OS === 'web') {
        const response = await fetch(image.uri);
        const blob = await response.blob();
        fileBody = new File([blob], fileName, { type: blob.type || `image/${fileExt}` });
      } else {
        const formData = new FormData();
        formData.append('file', {
          uri: image.uri,
          name: fileName,
          type: `image/${fileExt}`,
        } as any);
        fileBody = formData;
      }

      const { error: uploadError } = await supabase.storage
        .from('portfolio-covers')
        .upload(filePath, fileBody as any, { contentType: (fileBody as any)?.type });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('portfolio-covers').getPublicUrl(filePath);
      uploadedPathsRef.current.push(filePath);
      setCoverUrl(data.publicUrl);
    } catch (error: any) {
      console.error('Portfolio cover upload error:', error);
      errorToast('Failed to upload cover picture: ' + (error.message || 'unknown error'));
    } finally {
      setUploading(false);
    }
  };

  const coverPath = (url: string | null) => (url ? url.split('/portfolio-covers/')[1] ?? null : null);

  const handleSave = async () => {
    if (!portfolio) return;
    const trimmed = name.trim();
    if (!trimmed) {
      errorToast('A portfolio needs a name before it can be saved.');
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase.rpc('rpc_update_portfolio', {
        p_portfolio_id: portfolio.id,
        p_name: trimmed,
        p_target_date: targetDate ? new Date(targetDate + 'T00:00:00Z').toISOString() : null,
        p_cover_url: coverUrl,
      });
      if (error) throw error;

      // Best-effort cleanup of orphaned storage objects: anything uploaded
      // this session that isn't the final saved cover, plus the old cover if
      // it was replaced or removed. Never blocks the save success path.
      const keptPath = coverPath(coverUrl);
      const staleUploads = uploadedPathsRef.current.filter(p => p !== keptPath);
      const oldPath = portfolio.cover_url && coverUrl !== portfolio.cover_url ? coverPath(portfolio.cover_url) : null;
      const toDelete = [...staleUploads, ...(oldPath ? [oldPath] : [])];
      if (toDelete.length) {
        supabase.storage.from('portfolio-covers').remove(toDelete).catch(() => {});
      }
      uploadedPathsRef.current = [];

      successToast('Portfolio updated.');
      onSaved();
      onClose();
    } catch (error: any) {
      console.error('Portfolio save error:', error);
      errorToast(error.message || 'Could not save this portfolio.');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (uploadedPathsRef.current.length) {
      supabase.storage.from('portfolio-covers').remove(uploadedPathsRef.current).catch(() => {});
      uploadedPathsRef.current = [];
    }
    onClose();
  };

  const nameMissing = !name.trim();

  return (
    <Popup
      visible={visible && !!portfolio}
      onClose={handleClose}
      presentation="auto"
      maxWidth={560}
      title="Edit portfolio"
      footer="dual-action"
      secondaryAction={{ label: 'Cancel', onPress: handleClose }}
      primaryAction={{
        label: saving ? 'Saving…' : 'Save',
        onPress: saving || uploading ? () => {} : handleSave,
        variant: saving || uploading || nameMissing ? 'disabled' : 'default',
      }}
    >
      <View className="px-6 pt-5" style={{ gap: 20 }}>
        {/* Cover picture — profile upload flow, portfolio-covers bucket. */}
        <View>
          <Text className="text-typography-muted text-xs font-bold uppercase mb-2 tracking-widest">Cover picture</Text>
          <View
            className="items-center justify-center rounded-2xl overflow-hidden border border-surface-border"
            style={{ height: 128, backgroundColor: c.background }}
          >
            {coverUrl && !coverBroken ? (
              <Image
                source={{ uri: coverUrl }}
                className="h-full w-full"
                resizeMode="cover"
                onError={() => setCoverBroken(true)}
              />
            ) : (
              <EntityGlyph kind="portfolio" size={48} />
            )}

            <View className="absolute right-2 bottom-2 flex-row items-center" style={{ gap: 8 }}>
              {coverUrl && !uploading && (
                <Tooltip label="Remove picture">
                  <Pressable
                    onPress={() => setCoverUrl(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Remove cover picture"
                    className="h-11 w-11 items-center justify-center rounded-full border border-surface-border"
                    style={{ backgroundColor: c.card }}
                  >
                    <FontAwesome name="trash-o" size={14} color={c.textMuted} />
                  </Pressable>
                </Tooltip>
              )}
              <Tooltip label="Change cover picture">
                <Pressable
                  onPress={uploadCover}
                  disabled={uploading}
                  accessibilityRole="button"
                  className="h-11 w-11 items-center justify-center rounded-full bg-brand-primary hover:bg-brand-primary-hover active:scale-95"
                >
                  {uploading ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <FontAwesome name="camera" size={15} color="white" />
                  )}
                </Pressable>
              </Tooltip>
            </View>
          </View>
        </View>

        {/* Name */}
        <View>
          <Text className="text-typography-muted text-xs font-bold uppercase mb-2 tracking-widest">Portfolio name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Q4 Client Campaign"
            placeholderTextColor={c.textDim}
            className={`bg-surface-card border rounded-xl p-3 text-typography-main ${nameMissing ? 'border-state-danger' : 'border-surface-border'}`}
            editable={!saving}
          />
          {nameMissing && (
            <Text className="text-state-danger text-[11px] font-bold mt-2">
              A portfolio needs a name before it can be saved.
            </Text>
          )}
        </View>

        {/* Target date */}
        <View>
          <Text className="text-typography-muted text-xs font-bold uppercase mb-2 tracking-widest">
            Target date (optional)
          </Text>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Pressable
              onPress={() => setShowCalendar(v => !v)}
              accessibilityRole="button"
              className="flex-1 bg-surface-card border border-surface-border rounded-xl p-3 flex-row items-center justify-between"
            >
              <Text className={targetDate ? 'text-typography-main font-medium' : 'text-typography-muted'}>
                {targetDate
                  ? new Date(targetDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                  : 'No target date set'}
              </Text>
              <FontAwesome name="calendar-o" size={14} color={c.textMuted} />
            </Pressable>
            {targetDate && (
              <Tooltip label="Clear target date">
                <Pressable
                  onPress={() => { setTargetDate(null); setShowCalendar(false); }}
                  accessibilityRole="button"
                  className="w-12 bg-surface-card border border-surface-border rounded-xl items-center justify-center"
                  style={{ minHeight: 44 }}
                >
                  <FontAwesome name="times" size={14} color={c.textMuted} />
                </Pressable>
              </Tooltip>
            )}
          </View>
          {showCalendar && (
            <View className="mt-3">
              <Calendar
                selectedDate={targetDate}
                onSelect={(date) => { setTargetDate(date); setShowCalendar(false); }}
                scale="compact"
              />
            </View>
          )}
        </View>
      </View>
    </Popup>
  );
}
