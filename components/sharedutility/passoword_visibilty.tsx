import React, { useState } from 'react';
import { TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

interface PasswordInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholderTextColor?: string;
  colors: any;
}

export function PasswordInput({
  value,
  onChangeText,
  placeholderTextColor,
  colors
}: PasswordInputProps) {
  const [secureText, setSecureText] = useState(true);

  return (
    <View>
      <View className="relative justify-center">
        <TextInput
          className="w-full bg-surface-card border border-surface-border rounded-2xl px-6 py-4 text-typography-main font-bold focus:border-brand-primary pr-14"
          placeholder="Min. 8 characters"
          placeholderTextColor={placeholderTextColor}
          secureTextEntry={secureText}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
        />

        <TouchableOpacity 
          className="absolute right-5 p-1" 
          onPress={() => setSecureText(!secureText)}
          activeOpacity={0.7}
        >
          {secureText ? (
            <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colors.textDim || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <Path d="M2 12s3.5-6 10-6c2.2 0 4.1.7 5.7 1.7" />
              <Path d="M22 12s-3.5 6-10 6c-2.2 0-4.1-.7-5.7-1.7" />
              <Path d="M8.5 8.5A5 5 0 0 1 17 12" />
              <Path d="M15.5 15.5A5 5 0 0 1 7 12" />
              <Circle cx="12" cy="12" r="1.5" />
              <Line x1="4" y1="20" x2="20" y2="4" />
            </Svg>
          ) : (
            <Svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={colors.primary || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <Path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
              <Circle cx="12" cy="12" r="4" />
              <Circle cx="12" cy="12" r="1.5" />
            </Svg>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}