// `filehub-inbox` — the files people sent you, unread ones first.
//
// NOT a wrapper around FileHubOverview. That component pulls FileHubContext,
// useFileViewer, useShareFile, a lightbox and a channel list, and it renders its
// own ScrollView — a vertical scroller inside the dashboard's page ScrollView is
// a gesture conflict on native and an overflow trap on web, which is why no
// widget scrolls internally (registry.tsx header). What IS reused is its query,
// verbatim (FileHubOverview.tsx:71), plus ListRow and TaskFileResults' two file
// helpers.
//
// TILES, NOT ROWS — the one grid on this dashboard, and the only widget whose
// content earns one. An inbox is scanned, not read: the question is "is there
// anything new, and what kind of thing is it", which a type glyph and a weight
// answer at a glance where nine words of running text do not.
//
// It is still NOT `FilePreviewCard`. That tile's whole reason to be tall is a
// thumbnail, and a thumbnail here means a signed-URL round trip per file per
// dashboard load, for at most ten files, on a surface that is not the file
// browser. The glyph is the honest version of the same idea at a tenth of the
// cost — and it never layout-shifts, because there is no image to fail.
//
// 's' KEEPS THE LIST, deliberately. A 230px cell fits one tile per line, so the
// grid there would be a list of tall cards — the same three files in twice the
// height. Density has to genuinely fall with size, not get re-spent on chrome.
//
// ACCESS CONTROL IS THE SERVER'S. rpc_filehub_list is SECURITY DEFINER, raises
// on a caller without `filehub:view`, and returns only rows the caller is a
// recipient of; storage reads are separately gated by filehub_file_accessible /
// fn_task_file_accessible. Nothing here re-derives who may see a file — a
// client-side second opinion about file access can only ever be the wrong one.
// The row tap deep-links into /filehub, which re-checks server-side before it
// opens anything.

import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { ListRow } from '@/components/common/ListRow';
import {
  QuietLine,
  SeeAllRow,
  WidgetList,
  WidgetLoadingRows,
} from '@/components/dashboard/widgets/personalRows';
import type { WidgetBodyProps } from '@/components/dashboard/widgets/registry';
import { fileIcon, formatSize } from '@/components/intelligence/TaskFileResults';
import { useDashboardData } from '@/contexts/DashboardDataContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { ROWS_BY_SIZE } from '@/lib/dashboardWidgets';
import { supabase } from '@/lib/supabase';
import { formatRelative } from '@/lib/time';

/** The subset of rpc_filehub_list's inbox payload this widget reads. */
type InboxRow = {
  id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  uploader?: { full_name?: string | null } | null;
  /** Inbox mode only — a null `read_at` is what makes a row unread. */
  recipient_state?: { read_at: string | null } | null;
};

/**
 * One file as a tile. Everything on it encodes something:
 *
 *   glyph   — the file's TYPE (`fileIcon`, already shared with FileHub's own
 *             search results), which differs row to row. A glyph that were the
 *             same on every tile would be ornament and would be cut.
 *   weight  — unread. A tinted face, a brand-tinted edge and a bold name, all
 *             three together, because a 6px dot on a 44px row was carrying the
 *             single most important thing about an inbox on its own. That dot is
 *             gone; this replaces it rather than joining it.
 *   nothing — is coloured by file type. Type is the glyph's job, and this app's
 *             non-brand hues are the state palette (success/warning/danger); a
 *             green spreadsheet tile would read as "healthy", which is a lie.
 */
function InboxTile({
  file,
  unread,
  sender,
  onPress,
}: {
  file: InboxRow;
  unread: boolean;
  sender: string;
  onPress: () => void;
}) {
  const c = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread file' : 'File'} ${file.original_name} from ${sender}, ${formatRelative(file.created_at)}, ${formatSize(file.size_bytes)}`}
      className="rounded-xl border p-3 hover:bg-surface-overlay/40 transition-colors"
      style={{
        // flexBasis + grow + the 100% clamp is `sizeToFlex`'s own arithmetic
        // (lib/dashboardWidgets.ts) — the pattern the grid and DashboardFacts
        // both use, and the reason there is no breakpoint here: one column at
        // 230px, two in an 'm' cell, three or four at full desktop width. CSS
        // grid does not render in this RN-web build; flex-wrap does.
        flexBasis: 152,
        flexGrow: 1,
        maxWidth: '100%',
        minHeight: 44,
        borderColor: unread ? c.primary + '66' : c.border,
        backgroundColor: unread ? c.primary + '0D' : 'transparent',
      }}
    >
      <View
        className="rounded-lg items-center justify-center"
        style={{
          width: 30,
          height: 30,
          backgroundColor: unread ? c.primary + '24' : c.textMuted + '1A',
        }}
      >
        <FontAwesome name={fileIcon(file.mime_type)} size={14} color={unread ? c.primary : c.textMuted} />
      </View>
      <Text
        className={`text-typography-main text-[11px] mt-2 ${unread ? 'font-bold' : 'font-semibold'}`}
        numberOfLines={2}
      >
        {file.original_name}
      </Text>
      <Text className="text-typography-dim text-[10px] mt-0.5" numberOfLines={1}>
        {sender} · {formatRelative(file.created_at)}
      </Text>
    </TouchableOpacity>
  );
}

export default function FileHubInboxWidget({ instance, size }: WidgetBodyProps) {
  const { refreshKey } = useDashboardData();
  const c = useThemeColors();
  const router = useRouter();

  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // The same four arguments FileHubOverview.tsx:71 passes. `p_folder_id: null`
    // means root level only, NOT "any folder" (20260719_filehub_list_folder_root_
    // scoping_fix.sql) — a file the sender filed into a folder is not listed
    // here, which is the behaviour the FileHub Overview screen already has.
    // Widening it is a folder-agnostic mode on the RPC, not a second client call.
    supabase
      .rpc('rpc_filehub_list', { p_mode: 'inbox', p_search: null, p_folder_id: null, p_tag: null })
      .then(({ data, error }) => {
        if (cancelled) return;
        // A viewer without `filehub:view` makes the RPC raise, but the type's
        // requiredPermission already stops the instance existing. Anything else
        // that fails is an empty inbox as far as the dashboard is concerned.
        if (error) console.error('[FileHubInboxWidget] inbox error', error);
        setRows((data as InboxRow[]) || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Unread first, newest within each group. The RPC already orders created_at
  // DESC and Array.prototype.sort is stable, so this one comparator is the whole
  // ordering: what needs you on top, what you have already seen underneath.
  const sorted = [...rows].sort(
    (a, b) => Number(!!a.recipient_state?.read_at) - Number(!!b.recipient_state?.read_at),
  );

  // 3 / 6 / 10, the house pattern — the cap is what makes an 's' instance
  // genuinely shorter than an 'l' one.
  // ponytail: sliced client-side because rpc_filehub_list takes no limit, the
  // same cap FileHubOverview applies (`.slice(0, 6)`). Add p_limit to the RPC if
  // an inbox ever gets big enough for the payload to matter.
  const shown = sorted.slice(0, ROWS_BY_SIZE[size]);

  if (loading && rows.length === 0) return <WidgetLoadingRows />;

  // Deliberately NOT reported as empty (registry's useReportWidgetEmpty), which
  // would hide the card: an empty inbox is an answer, and the footer is where
  // you go to send something. Same call MyWorkWidget makes for the same reason.
  if (shown.length === 0) {
    return (
      <WidgetList type={instance.type}>
        <QuietLine text="Nothing new. Files people send you land here." />
        <SeeAllRow label="Open File Hub" onPress={() => router.push('/filehub' as any)} />
      </WidgetList>
    );
  }

  const unreadCount = sorted.filter(f => !f.recipient_state?.read_at).length;

  const openFile = (id: string) => router.push(`/filehub?tab=inbox&file=${id}` as any);
  const senderOf = (f: InboxRow) => f.uploader?.full_name || 'Someone';

  // PATH A (ui-style-guide.md §3), not a platform split: one component whose
  // layout is chosen by the widget's own stored size, which is the same value
  // on native, mobile web and desktop web. Nothing here is hover- or
  // pointer-only, and the tiles reflow by flex-wrap rather than by breakpoint,
  // so a 390px phone and a 1600px desktop run identical code.
  return (
    <WidgetList type={instance.type}>
      {size === 's' ? (
        shown.map((f, idx) => {
          const unread = !f.recipient_state?.read_at;
          return (
            <ListRow
              key={f.id}
              className="gap-3"
              // ListRow's py-3 clears 44px once a row has two lines; here it has
              // one, and a 40px tap target is not one (ui-style-guide.md:38).
              style={{ minHeight: 44 }}
              // Deep link, not an in-widget viewer: /filehub owns previewing,
              // and it re-checks access server-side before it opens the file.
              onPress={() => openFile(f.id)}
              isLast={idx === shown.length - 1}
              accessibilityLabel={`${unread ? 'Unread file' : 'File'} ${f.original_name} from ${senderOf(f)}`}
            >
              <FontAwesome name={fileIcon(f.mime_type)} size={14} color={unread ? c.primary : c.textDim} />
              <Text
                className={`text-typography-main text-xs flex-1 min-w-0 ${unread ? 'font-bold' : 'font-semibold'}`}
                numberOfLines={1}
              >
                {f.original_name}
              </Text>
              {/* The one thing 's' cannot drop: unread is why you looked. */}
              {unread && (
                <View className="rounded-full" style={{ width: 6, height: 6, backgroundColor: c.primary }} />
              )}
            </ListRow>
          );
        })
      ) : (
        // The body is `flush` (edge-to-edge rows), so the grid pays for its own
        // padding; SeeAllRow below stays full-bleed, as everywhere else.
        <View className="flex-row flex-wrap gap-2 px-4 pb-4">
          {shown.map(f => (
            <InboxTile
              key={f.id}
              file={f}
              unread={!f.recipient_state?.read_at}
              sender={senderOf(f)}
              onPress={() => openFile(f.id)}
            />
          ))}
        </View>
      )}

      {/* Cap-and-link, the house overflow affordance — widgets never scroll. */}
      <SeeAllRow
        label={unreadCount > 0 ? `${unreadCount} unread in my inbox` : 'Open my inbox'}
        onPress={() => router.push('/filehub?tab=inbox' as any)}
      />
    </WidgetList>
  );
}
