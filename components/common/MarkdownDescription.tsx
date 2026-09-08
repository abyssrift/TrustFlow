import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';
import { isAllowedMarkdownHref, MarkdownInline, markdownToPlainText, parseTaskDescriptionMarkdown } from '@/lib/taskDescriptionMarkdown';

function Inline({ nodes, colors, style }: { nodes: MarkdownInline[]; colors: ReturnType<typeof useThemeColors>; style?: any }) {
  return <Text style={[{ color: colors.textMain }, style]}>{nodes.map((node, i) => {
    if (node.type === 'link') return <Text key={i} accessibilityRole="link" onPress={() => { void Linking.openURL(node.href).catch(() => {}); }} style={{ color: colors.primary, textDecorationLine: 'underline' }}>{<Inline nodes={node.label} colors={colors} />}</Text>;
    if (node.type === 'code') return <Text key={i} style={{ color: colors.accent, backgroundColor: colors.background, fontFamily: 'monospace' }}>{node.value}</Text>;
    return <Text key={i} style={{ fontWeight: node.type === 'strong' ? '800' : undefined, fontStyle: node.type === 'emphasis' ? 'italic' : undefined, textDecorationLine: node.type === 'strike' ? 'line-through' : undefined }}>{node.type === 'text' ? node.value : <Inline nodes={node.children} colors={colors} />}</Text>;
  })}</Text>;
}

export default function MarkdownDescription({ value, markdown, testID, className, numberOfLines, style }: { value?: string; markdown?: string; testID?: string; className?: string; numberOfLines?: number; style?: any }) {
  const source = value ?? markdown ?? '';
  const colors = useThemeColors(); const blocks = parseTaskDescriptionMarkdown(source);
  if (numberOfLines !== undefined) return <Text testID={testID} className={className} style={[{ color: colors.textMain }, style]} numberOfLines={numberOfLines}>{markdownToPlainText(source)}</Text>;
  return <View testID={testID} className={className} style={style}>
    {blocks.map((block, i) => {
      if (block.type === 'divider') return <View key={i} style={{ borderTopWidth: 1, borderColor: colors.border, marginVertical: 10 }} />;
      if (block.type === 'code') return <ScrollView key={i} horizontal style={{ backgroundColor: colors.background, borderRadius: 8, padding: 10 }}><Text selectable style={{ color: colors.textMain, fontFamily: 'monospace', fontSize: 12 }}>{block.value}</Text></ScrollView>;
      if (block.type === 'table') return <ScrollView key={i} horizontal contentContainerStyle={{ minWidth: '100%' }}><View style={{ borderWidth: 1, borderColor: colors.border }}>{[block.headers, ...block.rows].map((row, r) => <View key={r} style={{ flexDirection: 'row', borderBottomWidth: r === block.rows.length ? 0 : 1, borderColor: colors.border }}>{row.map((cell, c) => <View key={c} style={{ minWidth: 100, padding: 8, borderRightWidth: 1, borderColor: colors.border }}><Inline nodes={cell} colors={colors} style={{ textAlign: block.alignments[c] }} /></View>)}</View>)}</View></ScrollView>;
      if (block.type === 'list') return <View key={i} style={{ marginVertical: 3 }}>{block.items.map((item, n) => <View key={n} style={{ flexDirection: 'row', marginBottom: 4, paddingLeft: 8 }}><Text style={{ color: colors.primary, width: 22 }}>{item.checked !== undefined ? <FontAwesome name={item.checked ? 'check-square-o' : 'square-o'} size={14} color={colors.primary} /> : block.ordered ? `${n + 1}.` : '•'}</Text><Inline nodes={item.children} colors={colors} /></View>)}</View>;
      return <View key={i} style={{ marginVertical: block.type === 'heading' ? 6 : 3, borderLeftWidth: block.type === 'quote' ? 3 : 0, borderColor: colors.primary, paddingLeft: block.type === 'quote' ? 10 : 0 }}><Text style={{ color: colors.textMain, fontSize: block.type === 'heading' ? Math.max(15, 22 - (block.level || 1) * 2) : 14, fontWeight: block.type === 'heading' ? '800' : undefined, lineHeight: 21 }}><Inline nodes={block.children} colors={colors} /></Text></View>;
    })}
  </View>;
}

export { isAllowedMarkdownHref, markdownToPlainText };
