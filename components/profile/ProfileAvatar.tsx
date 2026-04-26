import React, { useState } from 'react';
import { View, Text, Image, Pressable, ActivityIndicator, Platform } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAlert } from '@/contexts/AlertContext';

interface ProfileAvatarProps {
  url: string | null;
  name: string;
  onUpload: (url: string) => void;
  size?: number;
}

export default function ProfileAvatar({ url, name, onUpload, size = 120 }: ProfileAvatarProps) {
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

      let fileBody;
      if (Platform.OS === 'web') {
        const response = await fetch(image.uri);
        fileBody = await response.blob();
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
        .upload(filePath, fileBody);

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
            <ActivityIndicator color="rgb(var(--brand-primary))" />
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
