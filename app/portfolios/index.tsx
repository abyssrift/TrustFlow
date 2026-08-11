import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { Platform, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import { BackButton } from '@/components/common/BackButton';
import Tooltip from '@/components/common/Tooltip';
import { EntityGlyph, EntityTag } from '@/components/entities/EntityUI';
import PortfolioGrid from '@/components/portfolios/PortfolioGrid';
import { useThemeColors } from '@/hooks/useThemeColors';
import { TAB_BAR_HEIGHT } from '@/lib/layout';

// /portfolios — Phase 10 (#191). The level above a project.
//
// `portfolios` has existed since the hierarchy migration and is written by
// every bulk instantiation and every spreadsheet import, but has never had a
// screen: a batch you could create and never look at again. This is the door.
//
// A route, not a sheet, for the same reason /projects/templates is one (#184):
// this is a place you go and stay, link someone to, and come back to. A modal
// is none of those.
//
// ONE file, no .web.tsx split — PortfolioGrid is Path A responsive and there is
// no desktop-only affordance here needing a mobile replacement.
export default function PortfoliosScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isLargeScreen = width > 768;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-surface-background">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            padding: isLargeScreen ? 24 : 16,
            paddingBottom: isWeb ? 48 : TAB_BAR_HEIGHT.native + 24,
          }}
        >
          <View className="w-full" style={{ maxWidth: 1600, alignSelf: 'center' }}>
            <View className="flex-row items-center justify-between mb-5" style={{ gap: 16 }}>
              <View className="flex-row items-center flex-1" style={{ gap: 12, minWidth: 0 }}>
                {!isLargeScreen && <BackButton />}
                <EntityGlyph kind="portfolio" size={isLargeScreen ? 44 : 34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <EntityTag kind="portfolio" />
                  <Text
                    className={`${isLargeScreen ? 'text-3xl' : 'text-xl'} text-typography-main font-black tracking-tight`}
                  >
                    Portfolios
                  </Text>
                  {isLargeScreen && (
                    <Text className="text-typography-muted text-sm mt-0.5">
                      One portfolio is one batch of work — everything created together, from one spreadsheet or one
                      template.
                    </Text>
                  )}
                </View>
              </View>

              <Tooltip label="Back to projects">
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)/projects' as any)}
                  accessibilityRole="button"
                  accessibilityLabel="Projects"
                  className="bg-surface-card border border-surface-border rounded-xl flex-row items-center justify-center px-4"
                  style={{ minHeight: 44, gap: 8 }}
                >
                  <FontAwesome name="folder-open-o" size={13} color={c.textMuted} />
                  {isLargeScreen && <Text className="text-typography-main text-sm font-semibold">Projects</Text>}
                </TouchableOpacity>
              </Tooltip>
            </View>

            <PortfolioGrid
              onOpenPortfolio={id => router.push(`/portfolios/${id}` as any)}
              onCreate={() => router.push('/(tabs)/projects' as any)}
            />
          </View>
        </ScrollView>
      </View>
    </>
  );
}
