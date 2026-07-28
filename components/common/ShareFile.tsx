import Popup from '@/components/common/Popup';
import { shareLinkUrl, useFileHubOptional, type FileHubShareLink } from '@/contexts/FileHubContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { logTaskFileActivity, openStorageFile, shareFile, signedUrlFor, type ShareTarget } from '@/lib/storage';
import { canCopyImage, copyImageToClipboard } from '@/lib/webShare';
import { FontAwesome } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Text, TouchableOpacity, View } from 'react-native';

/**
 * Any file to share. `fileId` is a `filehub_files` id — when present (and a
 * FileHubProvider is in the tree) it unlocks the link-based targets and
 * activity logging. Task-detail files pass it as null and still share the object.
 */
export type ShareableFile = ShareTarget & { fileId?: string | null };

const LINK_EXPIRY_HOURS = 168; // 7 days — same default as the manage-links UI

const isActive = (l: FileHubShareLink) =>
  !l.revoked_at && new Date(l.expires_at).getTime() > Date.now();

/**
 * Feeds the same Activity tab from both sides: FileHub files log against their
 * own id, task files against their pointer row resolved by path (a no-op for
 * files that have no pointer).
 */
function logShare(
  hub: { logActivity: (id: string, action: string, meta?: Record<string, any> | null) => void } | null,
  file: ShareableFile,
  action: 'share' | 'download',
  destination?: string,
) {
  const metadata = destination ? { destination } : null;
  if (file.fileId && hub) hub.logActivity(file.fileId, action, metadata);
  else logTaskFileActivity(file.bucket, file.storagePath, action, metadata);
}

/**
 * Fallback for browsers with no Web Share API (Firefox on every platform,
 * desktop Chrome on Linux, and any non-HTTPS origin) and for files too large to
 * hand to it.
 *
 * Real-object transfer comes first — copy the image to the clipboard, or save
 * the file — because that's what actually lands as an attachment. The link is
 * last, for when the recipient can't be reached with the bytes themselves:
 * WhatsApp on the web has no file-attach URL scheme or API. That link is an
 * outward publish, which is why it mints a real `filehub_share_links` row
 * (revocable, expiring) rather than leaking a raw signed URL into a chat.
 */
function ShareFallbackSheet({ file, onClose }: { file: ShareableFile; onClose: () => void }) {
  const colors = useThemeColors();
  const { successToast, errorToast } = useToast();
  // Absent outside FileHub (task detail) — the object-sharing rows work anyway,
  // only the link section needs it.
  const hub = useFileHubOptional();
  const linkable = !!file.fileId && !!hub;

  const canCopy = canCopyImage(file.mimeType);
  const [copying, setCopying] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(linkable);

  // Resolve the link up front, not on click: creating one is an RPC round trip,
  // and opening wa.me after an await gets eaten by the popup blocker (same trap
  // as the signed-URL open in lib/storage.ts).
  useEffect(() => {
    if (!linkable) return;
    let cancelled = false;

    (async () => {
      try {
        const existing = (await hub!.listShareLinks(file.fileId!)).find(isActive);
        const link = existing ?? (await hub!.createShareLink(file.fileId!, LINK_EXPIRY_HOURS));
        if (!cancelled) setUrl(shareLinkUrl(link.token));
      } catch {
        /* context alerts; the sheet degrades to the object-only rows */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [linkable, file.fileId, hub]);

  const publish = (destination: string) => logShare(hub, file, 'share', destination);

  const openWhatsApp = () => {
    if (!url) return;
    publish('whatsapp');
    const wa = `https://wa.me/?text=${encodeURIComponent(`${file.name}\n${url}`)}`;
    if (Platform.OS === 'web') window.open(wa, '_blank', 'noopener');
    else Linking.openURL(wa).catch(() => errorToast('Could not open WhatsApp'));
    onClose();
  };

  const copyLink = async () => {
    if (!url) return;
    publish('link');
    await Clipboard.setStringAsync(url);
    successToast('Link copied');
    onClose();
  };

  const download = () => {
    logShare(hub, file, 'download');
    openStorageFile(file.bucket, file.storagePath, file.name, file.mimeType);
    onClose();
  };

  const copyImage = async () => {
    setCopying(true);
    const signed = await signedUrlFor(file.bucket, file.storagePath);
    const ok = signed ? await copyImageToClipboard(signed) : false;
    setCopying(false);
    if (!ok) { errorToast('Could not copy this image'); return; }
    publish('clipboard');
    successToast('Image copied — paste it into WhatsApp, Drive or an email');
    onClose();
  };

  return (
    <Popup visible onClose={onClose} presentation="auto" maxWidth={400} scrollable={false} containerClassName="rounded-2xl">
      <View className="px-6 pt-5 pb-2">
        <Text className="font-black text-lg" style={{ color: colors.textMain }} numberOfLines={1}>
          Share &quot;{file.name}&quot;
        </Text>
        <Text className="text-xs mt-1" style={{ color: colors.textDim }}>
          This browser can’t hand files to apps directly — Firefox has no share API, and
          neither does a non-HTTPS origin.
        </Text>
      </View>

      <View className="px-5 pb-5 pt-3 gap-2">
        {canCopy && (
          <Row
            icon="clipboard"
            label={copying ? 'Copying…' : 'Copy image'}
            hint="Paste it straight into WhatsApp, Drive or an email"
            onPress={copying ? () => {} : copyImage}
            colors={colors}
            tint={colors.primary}
          />
        )}
        <Row
          icon="download"
          label="Save the file"
          hint="Then attach it wherever you like"
          onPress={download}
          colors={colors}
          tint={colors.primary}
        />

        {loading ? (
          <View className="py-6 items-center"><ActivityIndicator color={colors.primary} /></View>
        ) : url ? (
          <>
            <Text className="text-[10px] font-black uppercase tracking-widest mt-3 mb-1 px-1" style={{ color: colors.textMuted }}>
              Or send a link
            </Text>
            <Row icon="whatsapp" label="Send on WhatsApp" hint="Sends a 7-day link, not the file" onPress={openWhatsApp} colors={colors} tint="#25D366" />
            <Row icon="link" label="Copy link" hint="Expires in 7 days · revocable" onPress={copyLink} colors={colors} tint={colors.textMuted} />
          </>
        ) : null}
      </View>
    </Popup>
  );
}

function Row({ icon, label, hint, onPress, colors, tint }: {
  icon: any; label: string; hint?: string; onPress: () => void; colors: any; tint: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center gap-3 border rounded-xl px-4 py-3.5"
      style={{ backgroundColor: colors.background, borderColor: colors.border }}
    >
      <FontAwesome name={icon} size={16} color={tint} style={{ width: 20, textAlign: 'center' }} />
      <View className="flex-1">
        <Text className="font-black text-sm" style={{ color: colors.textMain }}>{label}</Text>
        {hint && <Text className="text-[11px] mt-0.5" style={{ color: colors.textDim }}>{hint}</Text>}
      </View>
    </TouchableOpacity>
  );
}

/**
 * Single entry point for the "share this file outward" action.
 *
 * Tries the OS share sheet first (a real file attachment — WhatsApp, Drive,
 * OneDrive and every other install-time target come free from it), and falls
 * back to the link sheet above only where the platform has no share API.
 *
 * Render `shareSheet` once in the component tree; call `share(file)` from the
 * button. Works outside a FileHubProvider (task detail) — there the object still
 * shares, but there's no share link to fall back to and nothing to log against.
 */
export function useShareFile() {
  const hub = useFileHubOptional();
  const [target, setTarget] = useState<ShareableFile | null>(null);

  const share = useCallback(async (file: ShareableFile) => {
    const result = await shareFile(file);
    if (result === 'shared') logShare(hub, file, 'share', 'os_sheet');
    if (result === 'unsupported') setTarget(file);
  }, [hub]);

  const shareSheet = target
    ? <ShareFallbackSheet file={target} onClose={() => setTarget(null)} />
    : null;

  return { share, shareSheet };
}
