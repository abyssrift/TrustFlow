import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import type { OnboardingQuestion } from '@/lib/onboardingProfile';
import OptionTile from './OptionTile';

type Glyph = React.ComponentProps<typeof FontAwesome>['name'];

// Catalog option values are stable selection keys, so the glyph belongs here in the
// presentation layer rather than in the catalog payload alongside the copy.
const OPTION_ICONS: Record<string, Glyph> = {
  solo: 'user',
  small: 'users',
  growing: 'sitemap',
  scaling: 'building',
  client_delivery: 'handshake-o',
  internal_operations: 'cogs',
  product_development: 'code',
  portfolio_intake: 'inbox',
  governed_regulatory: 'shield',
};

export default function OnboardingQuestionStep({
  question,
  value,
  onChange,
  onContinue,
  onBack,
  loading = false,
}: {
  question: OnboardingQuestion;
  value?: string | string[];
  onChange: (value: string | string[]) => void;
  onContinue: () => void;
  onBack: () => void;
  loading?: boolean;
}) {
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const canContinue = selected.length > 0;
  const select = (option: string) => {
    if (question.type === 'multi') {
      onChange(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]);
    } else {
      onChange(option);
    }
  };

  return (
    <View>
      <Text className={`font-extrabold text-typography-main ${compact ? 'text-[22px]' : 'text-[28px]'}`}>
        {question.label}
      </Text>
      <Text className="mt-2 text-sm text-typography-muted">
        {question.type === 'multi' ? 'Pick all that apply.' : 'Pick the closest fit.'}
      </Text>

      <View className="mt-6 flex-row flex-wrap gap-3">
        {question.options.map((option) => (
          <OptionTile
            key={option.value}
            label={option.label}
            icon={OPTION_ICONS[option.value] ?? 'circle-o'}
            selected={selected.includes(option.value)}
            compact={compact}
            onPress={() => select(option.value)}
          />
        ))}
      </View>

      <View className={`mt-8 gap-3 ${compact ? 'flex-col-reverse' : 'flex-row justify-between'}`}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          className={`min-h-[48px] items-center justify-center rounded-2xl px-6 ${compact ? '' : 'border border-surface-border'}`}
        >
          <Text className="font-bold text-typography-muted">Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Continue setup"
          onPress={onContinue}
          disabled={loading || !canContinue}
          className={`min-h-[48px] items-center justify-center rounded-2xl px-10 ${compact ? '' : 'min-w-[200px]'} ${
            loading || !canContinue ? 'bg-brand-primary/50' : 'bg-brand-primary'
          }`}
        >
          <Text className="font-black text-brand-on-primary">{loading ? 'Setting up…' : 'Continue'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
