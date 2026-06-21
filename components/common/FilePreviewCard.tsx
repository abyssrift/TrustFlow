import { FilePreviewTeaser, getPreviewKind } from '@/components/common/FilePreview';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useState } from 'react';
import { Image, Platform, Text, TouchableOpacity, View } from 'react-native';

const isWeb = Platform.OS === 'web';

function getMimeIcon(mimeType: string | null | undefined, colors: ReturnType<typeof useThemeColors>): { icon: string; color: string } {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('image')) return { icon: 'file-image-o', color: colors.warning };
  if (t.includes('pdf')) return { icon: 'file-pdf-o', color: colors.danger };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { icon: 'file-excel-o', color: colors.success };
  if (t.includes('word') || t.includes('document') || t.includes('text')) return { icon: 'file-text-o', color: colors.info };
  return { icon: 'file-o', color: colors.textMuted };
}

export type FileTile = {
  key: string;
  fileName: string;
  mimeType?: string | null;
  subtitle?: string;
  imageUri?: string;
  previewUri?: string;
  onPress: () => void;
};

/**
 * A compact preview tile: a small box showing the file's inline preview (the
 * same teaser FileHub uses — spreadsheet rows, text lines, labelled PDF/Word
 * box, image thumbnail) with a tight filename footer. Tap opens the viewer.
 */
export function FilePreviewCard({
  fileName,
  mimeType,
  subtitle,
  imageUri,
  previewUri,
  width,
  previewHeight = 104,
  onPress,
}: Omit<FileTile, 'key'> & { width?: number; previewHeight?: number }) {
  const colors = useThemeColors();
  const kind = getPreviewKind(mimeType, fileName);
  const isImage = !!mimeType?.toLowerCase().includes('image');
  const { icon, color } = getMimeIcon(mimeType, colors);

  return (
    <View
      style={width != null ? { width } : undefined}
      className="rounded-xl border border-surface-border/60 bg-surface-background overflow-hidden"
    >
      {/* Inline preview box */}
      {isImage && imageUri ? (
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.9}
          className="w-full overflow-hidden relative"
          style={[{ height: previewHeight, backgroundColor: colors.card }, isWeb ? ({ cursor: 'pointer' } as any) : null]}
        >
          <Image source={{ uri: imageUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          <View className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/55 items-center justify-center">
            <FontAwesome name="search-plus" size={9} color="#fff" />
          </View>
        </TouchableOpacity>
      ) : kind && previewUri ? (
        <View className="-mb-3">
          <FilePreviewTeaser uri={previewUri} kind={kind} height={previewHeight} onPress={onPress} />
        </View>
      ) : (
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.9}
          className="w-full items-center justify-center"
          style={[{ height: previewHeight, backgroundColor: color + '0d' }, isWeb ? ({ cursor: 'pointer' } as any) : null]}
        >
          <FontAwesome name={icon as any} size={28} color={color} />
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-wide mt-1.5">
            {fileName.split('.').pop() || 'File'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Meta footer */}
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        className="flex-row items-center px-2.5 py-2 gap-2 border-t border-surface-border/40"
      >
        <FontAwesome name={icon as any} size={12} color={color} />
        <View className="flex-1">
          <Text className="text-typography-main text-[11px] font-bold" numberOfLines={1}>{fileName}</Text>
          {!!subtitle && <Text className="text-typography-muted text-[9px] mt-0.5" numberOfLines={1}>{subtitle}</Text>}
        </View>
        <FontAwesome
          name={isImage || kind ? 'search-plus' : 'external-link'}
          size={9}
          color={colors.textMuted}
        />
      </TouchableOpacity>
    </View>
  );
}

/**
 * Responsive wrapping grid of {@link FilePreviewCard} tiles. Measures its own
 * width and packs as many ~`minTileWidth` columns as fit.
 */
export function FilePreviewGrid({
  items,
  minTileWidth = 150,
  previewHeight = 104,
}: {
  items: FileTile[];
  minTileWidth?: number;
  previewHeight?: number;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const gap = 10;
  const avail = containerWidth > 0 ? containerWidth : 320;
  let cols = Math.floor((avail + gap) / (minTileWidth + gap));
  if (cols < 1) cols = 1;
  const tileWidth = Math.floor((avail - gap * (cols - 1)) / cols);

  if (items.length === 0) return null;

  return (
    <View
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      className="flex-row flex-wrap"
      style={{ gap }}
    >
      {items.map(({ key, ...tile }) => (
        <FilePreviewCard key={key} width={tileWidth} previewHeight={previewHeight} {...tile} />
      ))}
    </View>
  );
}
