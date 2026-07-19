import { useThemeColors } from '@/hooks/useThemeColors';
import React from 'react';
import { Linking, Text, TextProps } from 'react-native';

const URL_REGEX = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/g;

interface LinkifiedTextProps extends TextProps {
  children: string;
}

function splitTextByUrls(text: string): Array<{ type: 'text' | 'url'; value: string }> {
  const parts: Array<{ type: 'text' | 'url'; value: string }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    let url = match[0];
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    parts.push({ type: 'url', value: url });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts;
}

export default function LinkifiedText({ children, ...textProps }: LinkifiedTextProps) {
  const colors = useThemeColors();
  const parts = splitTextByUrls(children);

  if (parts.length === 1 && parts[0].type === 'text') {
    return <Text {...textProps}>{children}</Text>;
  }

  return (
    <Text {...textProps}>
      {parts.map((part, i) =>
        part.type === 'url' ? (
          <Text
            key={i}
            onPress={() => Linking.openURL(part.value)}
            style={{ color: colors.primary, textDecorationLine: 'underline' }}
          >
            {part.value}
          </Text>
        ) : (
          <Text key={i}>{part.value}</Text>
        )
      )}
    </Text>
  );
}
