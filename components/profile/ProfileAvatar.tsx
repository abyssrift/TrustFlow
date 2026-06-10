import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

interface ProfileAvatarProps {
  url: string | null;
  name: string;
  onUpload: (url: string) => void;
  size?: number;
}

export default function ProfileAvatar({ url, name, onUpload, size = 120 }: ProfileAvatarProps) {
  const colors = useThemeColors();
  const { showAlert } = useAlert();
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);

  const getInitials = (n: string) => {
    return n.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  };

  const uploadAvatar = async () => {
    try {
      setUploading(true);

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const image = result.assets[0];
      const fileExt = image.mimeType?.split('/')[1] || image.uri.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user?.id}/${fileName}`;

      let fileBody: Blob | File | FormData | null = null;
      if (Platform.OS === 'web') {
        try {
          const response = await fetch(image.uri);
          const blob = await response.blob();
          // Create a File so Supabase receives a proper filename/type in the browser
          fileBody = new File([blob], fileName, { type: blob.type || `image/${fileExt}` });
        } catch (err) {
          // Fallback: some web pickers may provide base64 instead of a stable blob URL
          if ((image as any).base64) {
            const base64 = (image as any).base64 as string;
            const binary = atob(base64);
            const len = binary.length;
            const u8 = new Uint8Array(len);
            for (let i = 0; i < len; i++) u8[i] = binary.charCodeAt(i);
            fileBody = new File([u8.buffer], fileName, { type: `image/${fileExt}` });
          } else {
            throw err;
          }
        }
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
        .from('avatars')
        .upload(filePath, fileBody as any, { contentType: (fileBody as any)?.type });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      // 1. Update public users table
      const { error: dbError } = await supabase
        .from('users')
        .update({ avatar_url: publicUrl })
        .eq('id', user?.id);
      
      if (dbError) throw dbError;

      // 2. Update auth metadata for cross-app sync
      const { error: authError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl }
      });
      
      if (authError) throw authError;

      onUpload(publicUrl);

    } catch (error: any) {
      console.error('Avatar upload error:', error);
      showAlert('Error', 'Failed to update profile picture: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <View className="items-center justify-center">
      <View 
        style={{ width: size, height: size }}
        className="relative overflow-hidden rounded-full border-4 border-surface-border bg-surface-card"
      >
        {url ? (
          <Image source={{ uri: url }} className="h-full w-full" />
        ) : (
          <View className="h-full w-full items-center justify-center bg-brand-primary/10">
            <Text 
              style={{ fontSize: size * 0.4 }}
              className="font-black text-brand-primary"
            >
              {getInitials(name)}
            </Text>
          </View>
        )}
        
        {uploading && (
          <View className="absolute inset-0 items-center justify-center bg-surface-background/60">
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
      </View>

      <Pressable
        onPress={uploadAvatar}
        disabled={uploading}
        className="absolute bottom-0 right-0 h-10 w-10 items-center justify-center rounded-full border-2 border-surface-card bg-brand-primary shadow-lg active:scale-95 transition-transform"
      >
        <FontAwesome name="camera" size={16} color="white" />
      </Pressable>
    </View>
  );
}
