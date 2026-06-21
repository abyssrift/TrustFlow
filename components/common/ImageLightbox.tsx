import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, Text, TouchableOpacity, View } from 'react-native';

type Format = { label: string; mime: string | null; ext: string };

// Re-encode targets offered in the dropdown (the original format is the main button).
const CONVERT_FORMATS: Format[] = [
  { label: 'PNG', mime: 'image/png', ext: 'png' },
  { label: 'JPG', mime: 'image/jpeg', ext: 'jpg' },
  { label: 'WEBP', mime: 'image/webp', ext: 'webp' },
];
const ORIGINAL: Format = { label: 'Original', mime: null, ext: '' };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function triggerBlobDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Bakes rotation + flips into a canvas and returns it.
function renderToCanvas(
  img: HTMLImageElement,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
  jpegBackground: boolean
): HTMLCanvasElement {
  const swap = rotation === 90 || rotation === 270;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d')!;
  // JPG has no alpha — flatten transparency onto white instead of black.
  if (jpegBackground) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(img, -w / 2, -h / 2);
  ctx.restore();
  return canvas;
}

/**
 * Full-screen image viewer with rotate/flip tools and prev/next navigation.
 * On web the download button re-encodes the (transformed) image — the main
 * button keeps the original format, the caret dropdown offers other formats.
 * On native it falls back to a single "Download" via `onDownloadOriginal`.
 */
export default function ImageLightbox({
  visible,
  uri,
  fileName,
  onClose,
  onDownloadOriginal,
  onInfo,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  index,
  total,
}: {
  visible: boolean;
  uri: string;
  fileName: string;
  onClose: () => void;
  onDownloadOriginal?: () => void;
  /** When provided, shows an info button (e.g. to open the file's detail view). */
  onInfo?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  index?: number;
  total?: number;
}) {
  const colors = useThemeColors();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Edit state.
  const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const edited = rotation !== 0 || flipH || flipV;

  const baseName = fileName.replace(/\.[^/.]+$/, '') || 'image';
  const originalExt = (fileName.split('.').pop() || '').toLowerCase();

  // Reset everything when the displayed image changes (navigation) or reopens.
  useEffect(() => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setErrored(false);
    setMenuOpen(false);
    setDownloading(null);
  }, [uri]);

  // Keyboard: arrows navigate, Escape closes (web only).
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrev) onPrev?.();
      else if (e.key === 'ArrowRight' && hasNext) onNext?.();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, hasPrev, hasNext, onPrev, onNext, onClose]);

  const rotate = (delta: number) => setRotation((r) => (r + delta + 360) % 360);
  const reset = () => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
  };

  const download = async (fmt: Format) => {
    if (Platform.OS !== 'web' || !uri) return;
    setMenuOpen(false);
    setDownloading(fmt.label);
    try {
      const res = await fetch(uri);
      const blob = await res.blob();

      // Untouched original + no edits → ship the exact bytes.
      if (!fmt.mime && !edited) {
        triggerBlobDownload(blob, fileName);
        return;
      }

      const objUrl = URL.createObjectURL(blob);
      try {
        const img = await loadImage(objUrl);
        const targetMime = fmt.mime ?? (blob.type || 'image/png');
        const outName = fmt.mime ? `${baseName}.${fmt.ext}` : fileName;
        const canvas = renderToCanvas(img, rotation, flipH, flipV, targetMime === 'image/jpeg');
        const out = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, targetMime, 0.92)
        );
        if (out) triggerBlobDownload(out, outName);
      } finally {
        URL.revokeObjectURL(objUrl);
      }
    } catch {
      // network/canvas failure — leave the modal open so the user can retry or close
    } finally {
      setDownloading(null);
    }
  };

  // Preview transform mirrors the canvas output.
  const previewTransform = [
    { rotate: `${rotation}deg` },
    { scaleX: flipH ? -1 : 1 },
    { scaleY: flipV ? -1 : 1 },
  ];

  const Tool = ({ icon, onPress, active }: { icon: string; onPress: () => void; active?: boolean }) => (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      className="w-9 h-9 rounded-lg items-center justify-center border"
      style={[
        {
          backgroundColor: active ? colors.primary + '33' : colors.background,
          borderColor: active ? colors.primary + '66' : colors.border,
        },
        Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
      ]}
    >
      <FontAwesome name={icon as any} size={13} color={active ? colors.primary : colors.muted} />
    </TouchableOpacity>
  );

  const NavArrow = ({ side, onPress }: { side: 'left' | 'right'; onPress?: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      className={`absolute ${side === 'left' ? 'left-4' : 'right-4'} top-1/2 w-11 h-11 rounded-full bg-white/10 items-center justify-center z-10`}
      style={[{ marginTop: -22 }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
    >
      <FontAwesome name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={18} color="#fff" />
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/90 items-center justify-center" onPress={onClose}>
        {/* Close */}
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 items-center justify-center z-10"
          style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : undefined}
        >
          <FontAwesome name="times" size={18} color="#fff" />
        </TouchableOpacity>

        {onInfo && (
          <TouchableOpacity
            onPress={onInfo}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            className="absolute top-6 left-6 w-10 h-10 rounded-full bg-white/10 items-center justify-center z-10"
            style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : undefined}
          >
            <FontAwesome name="info" size={16} color="#fff" />
          </TouchableOpacity>
        )}

        {hasPrev && <NavArrow side="left" onPress={onPrev} />}
        {hasNext && <NavArrow side="right" onPress={onNext} />}

        {/* Image — own Pressable so taps on it don't close the modal */}
        <Pressable onPress={() => {}} className="w-[88%] h-[66%] items-center justify-center">
          {errored ? (
            <View className="items-center">
              <FontAwesome name="exclamation-triangle" size={28} color={colors.muted} />
              <Text className="text-white/70 text-xs mt-2">Couldn’t load image</Text>
            </View>
          ) : uri ? (
            <Image
              source={{ uri }}
              style={{ width: '100%', height: '100%', transform: previewTransform }}
              resizeMode="contain"
              onError={() => setErrored(true)}
            />
          ) : (
            <ActivityIndicator color="#fff" />
          )}
        </Pressable>

        {/* Bottom action bar */}
        <Pressable onPress={() => {}} className="absolute bottom-8 left-0 right-0 items-center px-4">
          <View
            className="border rounded-2xl px-4 py-3 max-w-full"
            style={{ backgroundColor: colors.card, borderColor: colors.border }}
          >
            <Text className="text-xs font-bold text-center" style={{ color: colors.textMain }} numberOfLines={1}>
              {fileName}
            </Text>
            {typeof index === 'number' && typeof total === 'number' && total > 1 && (
              <Text className="text-[9px] font-bold text-center mt-0.5" style={{ color: colors.textMuted }}>
                {index + 1} / {total}
              </Text>
            )}

            {Platform.OS === 'web' && !errored && (
              <View className="flex-row gap-1.5 justify-center mt-2.5">
                <Tool icon="rotate-left" onPress={() => rotate(-90)} />
                <Tool icon="rotate-right" onPress={() => rotate(90)} />
                <Tool icon="arrows-h" onPress={() => setFlipH((v) => !v)} active={flipH} />
                <Tool icon="arrows-v" onPress={() => setFlipV((v) => !v)} active={flipV} />
                <Tool icon="refresh" onPress={reset} active={edited} />
              </View>
            )}

            {Platform.OS === 'web' ? (
              <View className="items-center mt-3">
                {/* Format dropdown — opens upward, above the split button */}
                {menuOpen && (
                  <View
                    className="mb-2 w-44 border rounded-lg overflow-hidden"
                    style={{ backgroundColor: colors.background, borderColor: colors.border }}
                  >
                    {CONVERT_FORMATS.filter((f) => f.ext !== originalExt).map((f, i) => (
                      <TouchableOpacity
                        key={f.label}
                        onPress={() => download(f)}
                        disabled={!!downloading}
                        className="flex-row items-center px-3 py-2 active:opacity-70"
                        style={[
                          i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : null,
                          Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
                        ]}
                      >
                        {downloading === f.label ? (
                          <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.7 }] }} />
                        ) : (
                          <FontAwesome name="download" size={10} color={colors.muted} />
                        )}
                        <Text className="text-[11px] font-bold ml-2.5" style={{ color: colors.textMain }}>{f.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Split button: download original | caret */}
                <View className="flex-row rounded-lg overflow-hidden border" style={{ borderColor: colors.border }}>
                  <TouchableOpacity
                    onPress={() => download(ORIGINAL)}
                    disabled={!!downloading}
                    className="flex-row items-center px-4 py-2 active:opacity-70"
                    style={[{ backgroundColor: colors.background }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                  >
                    {downloading === ORIGINAL.label ? (
                      <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.7 }] }} />
                    ) : (
                      <FontAwesome name="download" size={11} color={colors.primary} />
                    )}
                    <Text className="text-[11px] font-black uppercase ml-2" style={{ color: colors.primary }}>
                      Download{originalExt ? ` ${originalExt}` : ''}
                    </Text>
                  </TouchableOpacity>
                  <View style={{ width: 1, backgroundColor: colors.border }} />
                  <TouchableOpacity
                    onPress={() => setMenuOpen((o) => !o)}
                    disabled={!!downloading}
                    className="items-center justify-center px-2.5 active:opacity-70"
                    style={[{ backgroundColor: colors.background }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                  >
                    <FontAwesome name={menuOpen ? 'caret-up' : 'caret-down'} size={14} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={onDownloadOriginal}
                className="flex-row items-center justify-center border rounded-lg px-4 py-2 mt-3 active:opacity-70"
                style={{ backgroundColor: colors.background, borderColor: colors.border }}
              >
                <FontAwesome name="download" size={11} color={colors.primary} />
                <Text className="text-[11px] font-black uppercase ml-2" style={{ color: colors.primary }}>Download</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
