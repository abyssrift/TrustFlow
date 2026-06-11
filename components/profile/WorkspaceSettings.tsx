import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

export default function WorkspaceSettings() {
  const { profile, hasPermission } = useAuth();
  const { successToast, errorToast } = useToast();
  const colors = useThemeColors();

  const [soundFile, setSoundFile] = React.useState<{ name: string; size: number; uri: string } | null>(null);
  const [currentSoundUrl, setCurrentSoundUrl] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const canManageSounds = hasPermission('task.ping') || hasPermission('admin:notifications') || hasPermission('role.manage');

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

    if (profile?.company_id) {
      fetchCurrentSound();
    }
  }, [profile?.company_id]);

  const pickSoundFile = async () => {
    try {
      console.log('Opening document picker for audio files...');
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: false,
      });
        console.log('Document picker result:', result);
      if (result.canceled === false) {
        console.log('File selected:', result);
        setSoundFile({
          name: result.assets[0].file?.name || 'audio-file',
          size: result.assets[0].file?.size || 0,
          uri: result.assets[0].uri,
        });
        successToast(`Selected: ${result.assets[0].file?.name}`);
      } else if (result.canceled === true) {
        console.log('File selection cancelled');
      }
    } catch (err: any) {
      console.error('File picker error:', err);
      errorToast('Failed to pick audio file');
    }
  };

  const uploadSound = async () => {
    if (!soundFile || !profile?.company_id) {
      errorToast('Please select a file first');
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      console.log('Starting upload:', soundFile);

      // Simulate progress start
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev < 90) return prev + Math.random() * 30;
          return prev;
        });
      }, 300);

      // Upload to the dedicated public ping-sounds bucket. A stable path per
      // company (no timestamp) so re-uploads overwrite instead of accumulating.
      const fileExt = soundFile.name.split('.').pop() || 'mp3';
      const storagePath = `${profile.company_id}/ping-sound.${fileExt}`;

      // Convert URI to blob for upload
      const response = await fetch(soundFile.uri);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }
      const blob = await response.blob();

      setUploadProgress(30);

      const { error: uploadError } = await supabase.storage
        .from('ping-sounds')
        .upload(storagePath, blob, { upsert: true, contentType: `audio/${fileExt}` });

      if (uploadError) throw uploadError;

      setUploadProgress(70);

      const { data: urlData } = supabase.storage.from('ping-sounds').getPublicUrl(storagePath);
      // Version param busts the CDN cache when the sound is replaced at the same path
      const soundUrl = urlData?.publicUrl ? `${urlData.publicUrl}?v=${Date.now()}` : null;

      setUploadProgress(85);

      if (!soundUrl) throw new Error('Failed to store sound');

      console.log('Saving to database...');

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

      if (dbError) {
        console.error('Database error:', dbError);
        throw dbError;
      }

      clearInterval(progressInterval);
      setUploadProgress(100);
      setCurrentSoundUrl(soundUrl);
      setSoundFile(null);
      successToast('Ping sound updated! 🔊');

      // Reset after completion
      setTimeout(() => {
        setUploadProgress(0);
      }, 1500);
    } catch (err: any) {
      console.error('Upload error:', err);
      errorToast(err.message || 'Failed to upload sound');
      setUploadProgress(0);
    } finally {
      setUploading(false);
    }
  };

  if (!canManageSounds) {
    return (
      <View className="bg-surface-card rounded-2xl p-6 border border-surface-border/50 items-center justify-center py-12">
        <FontAwesome name="lock" size={32} className="text-typography-dim mb-3" />
        <Text className="text-typography-dim text-sm text-center">
          You don't have permission to manage workspace settings. Contact your administrator.
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View className="bg-surface-card rounded-2xl p-6 border border-surface-border items-center justify-center py-8">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View className="bg-surface-card rounded-2xl p-6 border border-surface-border">
      <View className="flex-row items-center mb-6">
        <FontAwesome name="volume-up" size={18} className="text-brand-primary mr-3" />
        <Text className="text-typography-main font-black text-lg">Workspace Ping Sound</Text>
      </View>

      {/* Current sound info */}
      {currentSoundUrl && (
        <View className="bg-brand-primary/10 border border-brand-primary/30 rounded-lg p-4 mb-5">
          <View className="flex-row items-center">
            <FontAwesome name="check-circle" size={14} className="text-brand-primary mr-3" />
            <View className="flex-1">
              <Text className="text-brand-primary font-bold text-sm">
                {soundFile?.name || 'Custom ping sound active'}
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
      <View className="mb-5">
        <Text className="text-typography-muted text-xs font-bold uppercase mb-3">Select Audio File</Text>
        <TouchableOpacity
          onPress={pickSoundFile}
          disabled={uploading}
          className="border-2 border-dashed border-surface-border rounded-lg p-5 items-center justify-center bg-surface-background"
        >
          <FontAwesome name="upload" size={18} className="text-typography-muted mb-2" />
          <Text className="text-typography-main font-bold text-center text-sm">
            {soundFile ? soundFile.name : 'Tap to choose audio file'}
          </Text>
          <Text className="text-typography-muted text-xs text-center mt-2">
            MP3, WAV, M4A supported
          </Text>
        </TouchableOpacity>
      </View>

      {/* Progress Bar */}
      {uploading && (
        <View className="mb-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-typography-muted text-xs font-bold">Uploading...</Text>
            <Text className="text-brand-primary text-xs font-black">{Math.round(uploadProgress)}%</Text>
          </View>
          <View className="h-2 bg-surface-background rounded-full overflow-hidden border border-surface-border">
            <View
              className="h-full bg-brand-primary rounded-full transition-all"
              style={{ width: `${uploadProgress}%` }}
            />
          </View>
        </View>
      )}

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
          <Text className="text-typography-main font-black text-xs uppercase">Uploading...</Text>
        ) : (
          <>
            <FontAwesome name="cloud-upload" size={12} className="text-typography-main mr-2" />
            <Text className="text-typography-main font-black text-xs uppercase">Upload Sound</Text>
          </>
        )}
      </TouchableOpacity>

      <Text className="text-typography-dim text-xs mt-4 text-center">
        This sound will play for all team members when a task is pinged.
      </Text>
    </View>
  );
}
