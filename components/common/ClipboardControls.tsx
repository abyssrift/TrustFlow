import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

type Props = {
  /** Current field value — enables the Copy button. */
  value?: string;
  /** Called with the clipboard text when the user taps Paste. */
  onPaste: (text: string) => void;
  /** Hide the Copy button (e.g. for write-only quick paste). */
  showCopy?: boolean;
  /** Hide the Paste button (e.g. for read-only copy of existing content). */
  showPaste?: boolean;
  /** Compact icon-only buttons (no labels). */
  iconOnly?: boolean;
};

/**
 * One-tap Copy / Paste affordances for text fields.
 * System copy/paste still works; this just makes it a single tap.
 */
export default function ClipboardControls({ value, onPaste, showCopy = true, showPaste = true, iconOnly = false }: Props) {
  const colors = useThemeColors();
  const [copied, setCopied] = useState(false);

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) onPaste(text);
  };

  const handleCopy = async () => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <View className="flex-row items-center gap-3">
      {showCopy && (
        <TouchableOpacity
          onPress={handleCopy}
          disabled={!value}
          className={`flex-row items-center gap-1 ${!value ? 'opacity-30' : 'active:opacity-60'}`}
        >
          <FontAwesome name={copied ? 'check' : 'copy'} size={11} color={copied ? colors.success : colors.primary} />
          {!iconOnly && (
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</Text>
          )}
        </TouchableOpacity>
      )}
      {showPaste && (
        <TouchableOpacity onPress={handlePaste} className="flex-row items-center gap-1 active:opacity-60">
          <FontAwesome name="clipboard" size={11} color={colors.primary} />
          {!iconOnly && (
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-wider">Paste</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}