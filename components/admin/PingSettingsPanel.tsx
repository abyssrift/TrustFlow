import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

export default function PingSettingsPanel() {
  const { profile } = useAuth();
  const { successToast, errorToast } = useToast();
  const colors = useThemeColors();

  const [soundFile, setSoundFile] = React.useState<{ name: string; size: number; uri: string } | null>(null);
  const [currentSoundUrl, setCurrentSoundUrl] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  // Fetch current sound on mount
  useEffect(() => {
    const fetchCurrentSound = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('company_ping_sounds')
          .select('sound_url, sound_file_name')
          .single();

        if (!error && data) {
          setCurrentSoundUrl(data.sound_url);
          setSoundFile({
            name: data.sound_file_name,
            size: 0,
            uri: data.sound_url
          });
        }
      } catch (err) {
        console.log('No ping sound configured yet');
      } finally {
        setLoading(false);
      }
    };

    fetchCurrentSound();
  }, []);

  const pickSoundFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
      });

      if (result.type === 'success') {
        setSoundFile({
          name: result.name,
          size: result.size || 0,
          uri: result.uri,
        });
      }
    } catch (err) {
      errorToast('Failed to pick audio file');
    }
  };

  const uploadSound = async () => {
    if (!soundFile || !profile?.company_id) return;

    try {
      setUploading(true);

      // Upload to Supabase storage
      const fileExt = soundFile.name.split('.').pop();
      const storagePath = `ping-sounds/${profile.company_id}/ping-sound.${fileExt}`;

      // Convert URI to blob for upload
      const response = await fetch(soundFile.uri);
      const blob = await response.blob();

      // Try to upload to 'public' bucket (fallback to other options if needed)
      let soundUrl: string | null = null;

      try {
        const { error: uploadError } = await supabase.storage
          .from('public')
          .upload(storagePath, blob, { upsert: true });

        if (!uploadError) {
          const { data } = supabase.storage.from('public').getPublicUrl(storagePath);
          soundUrl = data?.publicUrl || null;
        }
      } catch (storageErr) {
        console.warn('Storage upload attempt 1 failed, trying alternative...');
      }

      // If that didn't work, try uploading with a different approach
      if (!soundUrl) {
        // Store the file as a data URL if storage is unavailable
        const reader = new FileReader();
        soundUrl = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }

      if (!soundUrl) throw new Error('Failed to store sound');

      // Update or insert company_ping_sounds record
      const { error: dbError } = await supabase
        .from('company_ping_sounds')
        .upsert(
          {
            company_id: profile.company_id,
            sound_url: soundUrl,
            sound_file_name: soundFile.name,
            file_size_bytes: soundFile.size,
            mime_type: `audio/${fileExt}`,
            uploaded_by: profile.id,
          },
          { onConflict: 'company_id' }
        );

      if (dbError) throw dbError;

      setCurrentSoundUrl(soundUrl);
      successToast('Ping sound updated successfully! 🔊');
    } catch (err: any) {
      errorToast(err.message || 'Failed to upload sound');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <View className="bg-surface-card rounded-xl p-4 border border-surface-border items-center justify-center py-8">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View className="bg-surface-card rounded-xl p-4 border border-surface-border">
      <View className="flex-row items-center mb-4">
        <FontAwesome name="music" size={16} className="text-brand-primary mr-2" />
        <Text className="text-typography-main font-black text-base">Ping Sound Settings</Text>
      </View>

      {/* Current sound info */}
      {currentSoundUrl && (
        <View className="bg-brand-primary/10 border border-brand-primary/30 rounded-lg p-3 mb-4">
          <View className="flex-row items-center">
            <FontAwesome name="check-circle" size={14} className="text-brand-primary mr-2" />
            <View className="flex-1">
              <Text className="text-brand-primary font-bold text-sm">
                {soundFile?.name || 'Custom ping sound set'}
              </Text>
              {soundFile?.size ? (
                <Text className="text-brand-primary/70 text-xs mt-1">
                  {(soundFile.size / 1024).toFixed(1)} KB
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      )}

      {/* File picker */}
      <View className="mb-4">
        <Text className="text-typography-muted text-xs font-bold uppercase mb-2">Select Audio File</Text>
        <TouchableOpacity
          onPress={pickSoundFile}
          disabled={uploading}
          className="border-2 border-dashed border-surface-border rounded-lg p-6 items-center justify-center bg-surface-background"
        >
          <FontAwesome name="upload" size={20} className="text-typography-muted mb-2" />
          <Text className="text-typography-main font-bold text-center">
            {soundFile ? soundFile.name : 'Tap to choose audio file'}
          </Text>
          <Text className="text-typography-muted text-xs text-center mt-1">
            MP3, WAV, M4A, or other audio formats
          </Text>
        </TouchableOpacity>
      </View>

      {/* Upload button */}
      <TouchableOpacity
        onPress={uploadSound}
        disabled={!soundFile || uploading}
        className={`rounded-lg py-3 flex-row items-center justify-center ${
          soundFile && !uploading
            ? 'bg-brand-primary'
            : 'bg-surface-overlay opacity-50'
        }`}
      >
        {uploading ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <>
            <FontAwesome name="cloud-upload" size={12} className="text-typography-main mr-2" />
            <Text className="text-typography-main font-black text-sm uppercase">Upload Sound</Text>
          </>
        )}
      </TouchableOpacity>

      <Text className="text-typography-dim text-xs mt-3 text-center">
        This sound will play for all team members when a task is pinged.
      </Text>
    </View>
  );
}
