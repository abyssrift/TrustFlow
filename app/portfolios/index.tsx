import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import { BackButton } from '@/components/common/BackButton';
import Tooltip from '@/components/common/Tooltip';
import { EntityGlyph, EntityTag } from '@/components/entities/EntityUI';
import PortfolioGrid from '@/components/portfolios/PortfolioGrid';
import PortfolioViewModal from '@/components/portfolios/PortfolioViewModal';
import { useThemeColors } from '@/hooks/useThemeColors';
import { TAB_BAR_HEIGHT } from '@/lib/layout';

// /portfolios — Phase 10 (#191). The level above a project.
//
// `portfolios` has existed since the hierarchy migration and is written by
// every bulk instantiation and every spreadsheet import, but has never had a
// screen: a batch you could create and never look at again. This is the door.
//
// ONE file, no .web.tsx split — PortfolioGrid is a MultiViewList, which is
// Path B-resolution responsive (its own toolbar/density layouts adapt per
// width), so there is no desktop-only affordance here needing a mobile
// replacement.
//
// NOT a ScrollView page: the grid is a FlatList-backed MultiViewList (its
// own density switcher, virtualized scroll, persisted mode), which needs a
// bounded-height parent — so this is a fixed header + a flex-1 list, the
// same shape as Role Registry / File Hub Channels / Alert Rules.
//
// Since #260, OPENING a portfolio from the list presents it in the Multi-View
// Modal (PortfolioViewModal) instead of navigating to /portfolios/[id]. The
// route stays for deep links; the list's "open" presentation is now a modal.
export default function PortfoliosScreen() {
  const c = useThemeColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isLargeScreen = width > 768;
  const [openPortfolioId, setOpenPortfolioId] = useState<string | null>(null);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-surface-background">
        <View
          className="flex-1 w-full"
          style={{
            maxWidth: 1600,
            alignSelf: 'center',
            padding: isLargeScreen ? 24 : 16,
            paddingBottom: isWeb ? 48 : TAB_BAR_HEIGHT.native + 24,
          }}
        >
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

          <View className="flex-1">
            <PortfolioGrid
              onOpenPortfolio={setOpenPortfolioId}
              onCreate={() => router.push('/(tabs)/projects' as any)}
            />
          </View>
        </View>
      </View>
      <PortfolioViewModal
        portfolioId={openPortfolioId}
        onClose={() => setOpenPortfolioId(null)}
      />
    </>
  );
}