import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/contexts/ThemeContext';
import { cssInterop } from 'react-native-css-interop';

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
  const { kanban, updateKanban } = useTheme();

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });

    if (!result.canceled) {
      updateKanban({ backgroundUrl: result.assets[0].uri });
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
        trackColor={{ false: 'var(--color-surface-border)', true: 'var(--color-primary)' }}
      />
    </View>
  );

  return (
    <View className="absolute inset-0 bg-black/60 z-50 items-center justify-center p-6">
      <View className="bg-surface-card w-full max-w-lg rounded-3xl border border-surface-border overflow-hidden">
        <View className="flex-row items-center justify-between p-6 border-b border-surface-border">
          <View>
            <Text className="text-typography-main font-black text-xl">Board Settings</Text>
            <Text className="text-typography-muted text-[10px] uppercase font-bold">Personalize your workspace</Text>
          </View>
          <TouchableOpacity onPress={onClose} className="p-2 bg-surface-overlay rounded-full">
            <FontAwesome name="times" size={16} className="text-typography-muted" />
          </TouchableOpacity>
        </View>

        <ScrollView className="p-6 max-h-[70vh]">
          {/* BACKGROUND SECTION */}
          <Text className="text-brand-primary text-[10px] font-black uppercase mb-4 tracking-widest">Background & Image</Text>
          
          <View className="flex-row flex-wrap gap-3 mb-6">
             <TouchableOpacity 
              onPress={handlePickImage}
              className="w-20 h-28 rounded-xl border border-dashed border-surface-border items-center justify-center bg-surface-overlay"
             >
                <FontAwesome name="upload" size={20} className="text-typography-dim" />
                <Text className="text-typography-muted text-[8px] mt-2 font-bold">Upload</Text>
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
      </View>
    </View>
  );
}

