import { FontAwesome } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Platform, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

// Make sure you have these accessible in scope, or pass them as props
// getMimeIcon, formatFileSize 

function AdaptiveFileGrid({ 
  files, 
  onRemove, 
  onAddMore,
  formatFileSize,
    getMimeIcon
}: { 
  files: any[]; 
  onRemove: (index: number) => void; 
  onAddMore: () => void; 
  formatFileSize: (bytes: number) => string;
  getMimeIcon: (mimeType: string | null) => { icon: string; color: string };
}) {
  const { width: screenWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);

  // --- 1. Adaptive Padding Strategy ---
  // Large desktop (>1024px): 100px padding
  // Tablets (768 - 1024px): 60px padding
  // Mobile (<768px): 24px padding (your standard app padding)
  const paddingHorizontal = screenWidth > 1024 ? 100 : screenWidth > 768 ? 60 : 24;

  // --- 2. Adaptive Grid Math ---
  const gap = 12; // Spacing between squares
  const minSquareSize = 100; // The smallest we ever want a square to be

  // Use the measured container width if available, otherwise estimate based on screen width
  const availableWidth = containerWidth > 0 ? containerWidth : screenWidth - (paddingHorizontal * 2);
  
  // Calculate how many columns can fit. Enforce at least 2 columns on tiny phones.
  let numCols = Math.floor((availableWidth + gap) / (minSquareSize + gap));
  if (numCols < 2) numCols = 2; 

  // Calculate the EXACT pixel size of each square to perfectly fill the row width
  const exactSquareSize = Math.floor((availableWidth - (gap * (numCols - 1))) / numCols);

  if (files.length === 0) return null;

  return (
    <View 
      className="w-full"
      style={{ paddingHorizontal }}
    >
      {/* Container Box */}
      <View 
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
        className="bg-surface-card border border-surface-border rounded-3xl p-4"
      >
        <View className="flex-row flex-wrap" style={{ gap }}>
          
          {files.map((pf, idx) => {
            const isImage = pf.type?.toLowerCase().startsWith('image/');
            const { icon, color } = getMimeIcon(pf.type ?? null);
            let imageSource = pf.uri;

            if (Platform.OS === 'web' && pf.webFile) {
            // Create a temporary browser-readable URL for the image
            imageSource = URL.createObjectURL(pf.webFile);
            }
            return (
              <View 
                key={`${pf.name}-${idx}`} 
                style={{ width: exactSquareSize, height: exactSquareSize }}
                className="rounded-2xl overflow-hidden border border-surface-border bg-surface-background relative"
              >
                {/* Visual Preview */}
                {isImage ? (
                 <Image 
                    source={{ uri: imageSource }} 
                    style={{ flex: 1, width: '100%', height: '100%' }} 
                    contentFit="cover" // Note: expo-image uses contentFit instead of resizeMode
                    cachePolicy="memory" // Keeps it snappy
                    />
                ) : (
                  <View className="flex-1 items-center justify-center p-2" style={{ backgroundColor: color + '12' }}>
                    <FontAwesome name={icon as any} size={exactSquareSize > 120 ? 36 : 28} color={color} />
                    <View className="mt-3 bg-surface-background px-2 py-1 rounded-lg border border-surface-border shadow-sm">
                      <Text className="text-[10px] font-black uppercase text-typography-muted" numberOfLines={1}>
                        {pf.name.split('.').pop() || 'FILE'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Delete Button */}
                <TouchableOpacity 
                  onPress={() => onRemove(idx)}
                  className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full items-center justify-center"
                  style={Platform.OS === 'web' ? { cursor: 'pointer' } : {}}
                >
                  <FontAwesome name="times" size={11} color="#fff" />
                </TouchableOpacity>

                {/* File Size Bar */}
                <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1.5 backdrop-blur-md">
                  <Text className="text-white text-[10px] font-bold text-center" numberOfLines={1}>
                    {formatFileSize(pf.size)}
                  </Text>
                </View>
              </View>
            );
          })}

          {/* Add More Button */}
          <TouchableOpacity 
            onPress={onAddMore} 
            style={{ width: exactSquareSize, height: exactSquareSize }}
            className="rounded-2xl border-2 border-dashed border-surface-border bg-surface-background items-center justify-center"
          >
            <FontAwesome name="plus" size={24} color="#94a3b8" />
            <Text className="text-typography-muted text-[11px] font-black mt-2 tracking-wide uppercase">Add</Text>
          </TouchableOpacity>

        </View>
      </View>
    </View>
  );
}

export default AdaptiveFileGrid;