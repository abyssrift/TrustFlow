import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Tooltip from './Tooltip';

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
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (next: { kind: 'success' | 'error'; message: string }) => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    setFeedback(next);
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      setFeedback(null);
    }, 3200);
  };

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  const handlePaste = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text) {
        showFeedback({ kind: 'error', message: 'Clipboard is empty.' });
        return;
      }
      onPaste(text);
      showFeedback({ kind: 'success', message: 'Pasted from clipboard.' });
    } catch {
      showFeedback({ kind: 'error', message: 'Could not read the clipboard.' });
    }
  };

  const handleCopy = async () => {
    if (!value) {
      showFeedback({ kind: 'error', message: 'There is nothing to copy.' });
      return;
    }
    try {
      await Clipboard.setStringAsync(value);
      showFeedback({ kind: 'success', message: 'Copied to clipboard.' });
    } catch {
      showFeedback({ kind: 'error', message: 'Could not write to the clipboard.' });
    }
  };

  const copyActive = feedback?.kind === 'success' && feedback.message === 'Copied to clipboard.';
  const copyLabel = copyActive ? 'Copied' : 'Copy';

  return (
    <View className="flex-row flex-wrap items-center gap-3">
      {showCopy && (
        <Tooltip label={copyLabel} disabled={!iconOnly}>
          <TouchableOpacity
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel={copyLabel}
            accessibilityHint={value ? 'Copies the current value to the clipboard.' : 'There is no value to copy.'}
            className={`min-h-11 flex-row items-center justify-center gap-1 rounded-xl border px-2 ${iconOnly ? 'min-w-11' : ''} ${!value ? 'border-surface-border bg-surface-background' : 'border-brand-primary/20 active:bg-brand-primary/10'}`}
          >
            <FontAwesome name={copyActive ? 'check' : 'copy'} size={13} color={copyActive ? colors.success : colors.primary} />
            {!iconOnly && (
              <Text className={`text-[10px] font-black uppercase tracking-wider ${copyActive ? 'text-state-success' : 'text-brand-primary'}`}>{copyLabel}</Text>
            )}
          </TouchableOpacity>
        </Tooltip>
      )}
      {showPaste && (
        <Tooltip label="Paste" disabled={!iconOnly}>
          <TouchableOpacity
            onPress={handlePaste}
            accessibilityRole="button"
            accessibilityLabel="Paste"
            accessibilityHint="Reads text from the clipboard and inserts it into the field."
            className={`min-h-11 flex-row items-center justify-center gap-1 rounded-xl border border-brand-primary/20 px-2 active:bg-brand-primary/10 ${iconOnly ? 'min-w-11' : ''}`}
          >
            <FontAwesome name="clipboard" size={13} color={colors.primary} />
            {!iconOnly && (
              <Text className="text-brand-primary text-[10px] font-black uppercase tracking-wider">Paste</Text>
            )}
          </TouchableOpacity>
        </Tooltip>
      )}
      {feedback && (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className={`flex-row items-center rounded-lg border px-2 py-1 ${feedback.kind === 'success' ? 'border-state-success/30 bg-state-success/10' : 'border-state-danger/30 bg-state-danger/10'}`}
        >
          <Text className={`text-[10px] font-bold ${feedback.kind === 'success' ? 'text-state-success' : 'text-state-danger'}`}>
            {feedback.message}
          </Text>
        </View>
      )}
    </View>
  );
}
