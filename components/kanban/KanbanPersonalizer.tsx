import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, Platform, ActivityIndicator } from 'react-native';
import { useAlert } from '@/contexts/AlertContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { cssInterop } from 'react-native-css-interop';
import { useThemeColors } from '@/hooks/useThemeColors';
import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

interface Props {
  onClose: () => void;
}

export default function KanbanPersonalizer({ onClose }: Props) {
  const colors = useThemeColors();
  const { kanban, updateKanban } = useTheme();
  const { user } = useAuth();
  const { showAlert } = useAlert();
  const [uploading, setUploading] = useState(false);

  const handlePickImage = async () => {
    if (!user) return;
    // Picker call must be inside the try too: if it throws (e.g. a permission
    // request failing on native) before setUploading ever ran, the failure
    // was silent — no spinner, no console reachable on a real device, nothing.
    setUploading(true);
    try {
      // ponytail: no forced crop aspect — the render layer already uses
      // resizeMode="cover", so a fixed 16:9 crop only letterboxed portrait
      // photos with black bars instead of framing them correctly.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (result.canceled) return;

      // The picker only gives a transient local uri (blob:/file:// cache path) that
      // doesn't survive a reload or app restart, so upload it to durable storage
      // and persist the resulting public URL instead.
      const asset = result.assets[0];
      const fileExt = asset.mimeType?.split('/')[1] || asset.uri.split('.').pop() || 'jpg';
      const storagePath = `${user.id}/background.${fileExt}`;
      const contentType = asset.mimeType || `image/${fileExt}`;

      // Supabase's own storage-js docs: Blob/File/FormData "does not work as intended"
      // on React Native (the request silently hangs, no reject, no timeout) — read
      // the file's raw bytes instead, which fetch can actually serialize correctly.
      const body = Platform.OS === 'web'
        ? await (await fetch(asset.uri)).blob()
        : await new File(asset.uri).bytes();

      // ponytail: a bare hang here previously looked identical to "nothing
      // happened" with zero feedback; bound it so a stalled request always
      // reaches the catch/Alert instead of spinning forever.
      const uploadPromise = supabase.storage
        .from('kanban-backgrounds')
        .upload(storagePath, body, { upsert: true, contentType });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timed out. Check your connection and try again.')), 20000)
      );
      const { error: uploadError } = await Promise.race([uploadPromise, timeoutPromise]);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('kanban-backgrounds').getPublicUrl(storagePath);
      updateKanban({ backgroundUrl: `${data.publicUrl}?v=${Date.now()}` });
    } catch (e) {
      console.error('Failed to upload kanban background', e);
      showAlert('Upload failed', e instanceof Error ? e.message : 'Could not upload background image.');
    } finally {
      setUploading(false);
    }
  };

  const presets = [
    { name: 'None', url: null },
    { name: 'Mesh Dark', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=2564&auto=format&fit=crop' },
    { name: 'Aurora', url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?q=80&w=2670&auto=format&fit=crop' },
    { name: 'Deep Space', url: 'https://images.unsplash.com/photo-1464802686167-b939a67e06a1?q=80&w=2669&auto=format&fit=crop' },
  ];

  const SettingToggle = ({ label, value, onToggle }: { label: string, value: boolean, onToggle: (v: boolean) => void }) => (
    <View className="flex-row items-center justify-between py-3 border-b border-surface-border">
      <Text className="text-typography-main text-sm font-bold">{label}</Text>
      <Switch 
        value={value} 
        onValueChange={onToggle}
        trackColor={{ false: colors.border, true: colors.primary }}
      />
    </View>
  );

  return (
    <Popup
      visible
      onClose={onClose}
      presentation="auto"
      dismissible={false}
      maxWidth={512}
      containerClassName="rounded-3xl overflow-hidden"
    >
        <View className="flex-row items-center justify-between p-6 border-b border-surface-border">
          <View>
            <Text className="text-typography-main font-black text-xl">Board Settings</Text>
            <Text className="text-typography-muted text-[10px] uppercase font-bold">Personalize your workspace</Text>
          </View>
          <Tooltip label="Close">
            <TouchableOpacity onPress={onClose} className="p-2 bg-surface-overlay rounded-full">
              <FontAwesome name="times" size={16} className="text-typography-muted" />
            </TouchableOpacity>
          </Tooltip>
        </View>

        <ScrollView className="p-6 max-h-[70vh]">
          {/* BACKGROUND SECTION */}
          <Text className="text-brand-primary text-[10px] font-black uppercase mb-4 tracking-widest">Background & Image</Text>
          
          <View className="flex-row flex-wrap gap-3 mb-6">
             <TouchableOpacity
              onPress={handlePickImage}
              disabled={uploading}
              className="w-20 h-28 rounded-xl border border-dashed border-surface-border items-center justify-center bg-surface-overlay"
             >
                {uploading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <FontAwesome name="upload" size={20} className="text-typography-dim" />
                )}
                <Text className="text-typography-muted text-[8px] mt-2 font-bold">{uploading ? 'Uploading' : 'Upload'}</Text>
             </TouchableOpacity>

             {presets.map((p, idx) => (
                <TouchableOpacity 
                  key={idx}
                  onPress={() => updateKanban({ backgroundUrl: p.url })}
                  className={`w-20 h-28 rounded-xl border-2 overflow-hidden ${kanban.backgroundUrl === p.url ? 'border-brand-primary' : 'border-transparent'}`}
                >
                   {p.url ? (
                     <View className="w-full h-full bg-surface-overlay flex-center">
                        {/* In a real app we'd use Image component, but for the placeholder/mockup we'll use a color or small preview */}
                        <View style={{ backgroundColor: idx === 1 ? '#1e1b4b' : idx === 2 ? '#064e3b' : '#171717' }} className="w-full h-full items-center justify-center">
                           <Text className="text-white text-[8px] font-bold text-center px-1">{p.name}</Text>
                        </View>
                     </View>
                   ) : (
                     <View className="w-full h-full bg-surface-background items-center justify-center">
                        <Text className="text-typography-muted text-[8px] font-bold">Default</Text>
                     </View>
                   )}
                </TouchableOpacity>
             ))}
          </View>

          {/* READABILITY */}
          {kanban.backgroundUrl && (
            <View className="mb-6 space-y-4">
               <View>
                  <Text className="text-typography-dim text-[10px] font-bold mb-2">Overlay Darkness</Text>
                  <View className="flex-row gap-2">
                     {[0.2, 0.4, 0.6, 0.8].map(v => (
                        <TouchableOpacity 
                          key={v}
                          onPress={() => updateKanban({ bgOverlay: v })}
                          className={`flex-1 py-2 rounded-lg border border-surface-border items-center ${kanban.bgOverlay === v ? 'bg-brand-primary border-brand-primary' : 'bg-surface-overlay'}`}
                        >
                           <Text className={`text-[10px] font-bold ${kanban.bgOverlay === v ? 'text-white' : 'text-typography-muted'}`}>{v*100}%</Text>
                        </TouchableOpacity>
                     ))}
                  </View>
               </View>

               <View>
                  <Text className="text-typography-dim text-[10px] font-bold mb-2">Glass Blur (Experimental)</Text>
                  <View className="flex-row gap-2">
                     {[0, 10, 20, 30].map(v => (
                        <TouchableOpacity 
                          key={v}
                          onPress={() => updateKanban({ bgBlur: v })}
                          className={`flex-1 py-2 rounded-lg border border-surface-border items-center ${kanban.bgBlur === v ? 'bg-brand-primary border-brand-primary' : 'bg-surface-overlay'}`}
                        >
                           <Text className={`text-[10px] font-bold ${kanban.bgBlur === v ? 'text-white' : 'text-typography-muted'}`}>{v}px</Text>
                        </TouchableOpacity>
                     ))}
                  </View>
               </View>
            </View>
          )}

          {/* FUNCTIONAL SETTINGS */}
          <Text className="text-brand-primary text-[10px] font-black uppercase mb-4 mt-2 tracking-widest">Board HUD & Data</Text>
          
          <SettingToggle 
            label="Show Pulse Statistics" 
            value={kanban.showPulse} 
            onToggle={(v) => updateKanban({ showPulse: v })} 
          />
          <SettingToggle 
            label="Show Stage Totals" 
            value={kanban.showStageTotals} 
            onToggle={(v) => updateKanban({ showStageTotals: v })} 
          />
          <SettingToggle 
            label="Show Active User Avatars" 
            value={kanban.showAvatars} 
            onToggle={(v) => updateKanban({ showAvatars: v })} 
          />
          <SettingToggle 
            label="Vibrant Theme Mode" 
            value={kanban.isVibrant} 
            onToggle={(v) => updateKanban({ isVibrant: v })} 
          />

          <View className="h-10" />
        </ScrollView>

        <View className="p-6 bg-surface-overlay border-t border-surface-border">
           <TouchableOpacity 
            onPress={onClose}
            className="w-full bg-brand-primary py-4 rounded-xl items-center"
           >
              <Text className="text-white font-black">Close Settings</Text>
           </TouchableOpacity>
        </View>
    </Popup>
  );
}

