import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';

const isWeb = Platform.OS === 'web';

export type PreviewKind = 'spreadsheet' | 'pdf' | 'docx' | 'text';

export function getPreviewKind(mimeType?: string | null, name?: string | null): PreviewKind | null {
  const m = (mimeType || '').toLowerCase();
  const ext = (name || '').split('.').pop()?.toLowerCase() || '';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv') || ['xlsx', 'xls', 'csv'].includes(ext)) return 'spreadsheet';
  if (m.includes('pdf') || ext === 'pdf') return 'pdf';
  if (m.includes('wordprocessing') || m.includes('msword') || ext === 'docx') return 'docx';
  if (m.startsWith('text/') || ['txt', 'json', 'md', 'log', 'xml', 'yml', 'yaml', 'ts', 'js'].includes(ext)) return 'text';
  return null;
}

// ─── Module-level caches (shared between teaser + modal, survive remounts) ──────
let XLSXmod: typeof import('xlsx') | null = null;
const wbCache = new Map<string, { names: string[] }>();
const wbObjCache = new Map<string, any>();
const rowsCache = new Map<string, any[][]>();
const htmlCache = new Map<string, string>();
const docxCache = new Map<string, string>();
const textCache = new Map<string, string>();

const COL_W = 130;
const ROW_H = 30;
const MAX_COLS = 40;

// ─── Spreadsheet ────────────────────────────────────────────────────────────
function useWorkbook(uri: string) {
  const cached = wbCache.get(uri);
  const [state, setState] = useState<{ loading: boolean; error: boolean; names: string[] }>(
    cached ? { loading: false, error: false, names: cached.names } : { loading: true, error: false, names: [] }
  );

  useEffect(() => {
    const c = wbCache.get(uri);
    if (c) { setState({ loading: false, error: false, names: c.names }); return; }
    let cancelled = false;
    setState({ loading: true, error: false, names: [] });
    (async () => {
      try {
        const buf = await (await fetch(uri)).arrayBuffer();
        if (!XLSXmod) XLSXmod = await import('xlsx');
        const wb = XLSXmod.read(buf, { type: 'array' });
        wbObjCache.set(uri, wb);
        wbCache.set(uri, { names: wb.SheetNames });
        if (!cancelled) setState({ loading: false, error: false, names: wb.SheetNames });
      } catch {
        if (!cancelled) setState({ loading: false, error: true, names: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [uri]);

  return state;
}

function useSheetRows(uri: string, sheetName: string | undefined): any[][] | null {
  const key = sheetName ? `${uri}::${sheetName}` : '';
  const [rows, setRows] = useState<any[][] | null>(() => (key ? rowsCache.get(key) ?? null : null));

  useEffect(() => {
    if (!sheetName) { setRows(null); return; }
    const cached = rowsCache.get(key);
    if (cached) { setRows(cached); return; }
    const wb = wbObjCache.get(uri);
    if (!wb || !XLSXmod) { setRows(null); return; }
    setRows(null);
    let cancelled = false;
    // Defer the (synchronous, potentially heavy) conversion so the spinner can paint.
    const t = setTimeout(() => {
      try {
        const r = XLSXmod!.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: '' }) as any[][];
        rowsCache.set(key, r);
        if (!cancelled) setRows(r);
      } catch {
        if (!cancelled) setRows([]);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [uri, sheetName, key]);

  return rows;
}

// Full-table HTML (web only) — the browser renders/scrolls thousands of cells far
// faster than RN Views, and avoids nested-scroll layout issues.
function useSheetHtml(uri: string, sheetName: string | undefined): string | null {
  const key = sheetName ? `${uri}::${sheetName}::html` : '';
  const [html, setHtml] = useState<string | null>(() => (key ? htmlCache.get(key) ?? null : null));
  useEffect(() => {
    if (!sheetName) { setHtml(null); return; }
    const cached = htmlCache.get(key);
    if (cached != null) { setHtml(cached); return; }
    const wb = wbObjCache.get(uri);
    if (!wb || !XLSXmod) { setHtml(null); return; }
    setHtml(null);
    let cancelled = false;
    const t = setTimeout(() => {
      try {
        const h = XLSXmod!.utils.sheet_to_html(wb.Sheets[sheetName], { editable: false });
        htmlCache.set(key, h);
        if (!cancelled) setHtml(h);
      } catch {
        if (!cancelled) setHtml('');
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [uri, sheetName, key]);
  return html;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View className="flex-1 items-center justify-center py-8 px-4">{children}</View>;
}

function SheetTabs({ names, active, setActive, colors }: { names: string[]; active: number; setActive: (i: number) => void; colors: ReturnType<typeof useThemeColors> }) {
  if (names.length <= 1) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 8 }}>
      {names.map((name, i) => (
        <TouchableOpacity
          key={name}
          onPress={() => setActive(i)}
          className="mr-2 px-3 py-1.5 rounded-lg border"
          style={[
            { backgroundColor: i === active ? colors.primary + '22' : colors.background, borderColor: i === active ? colors.primary + '55' : colors.border },
            isWeb ? ({ cursor: 'pointer' } as any) : null,
          ]}
        >
          <Text style={{ color: i === active ? colors.primary : colors.textMuted }} className="text-[11px] font-bold">{name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

function SpreadsheetView({ uri, compact = false, maxRows }: { uri: string; compact?: boolean; maxRows?: number }) {
  const colors = useThemeColors();
  const { loading, error, names } = useWorkbook(uri);
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [uri]);

  // Teaser + native use parsed rows (lightweight); web full view uses an HTML table.
  const useHtml = isWeb && !compact;
  const rows = useSheetRows(uri, useHtml ? undefined : names[active]);
  const html = useSheetHtml(uri, useHtml ? names[active] : undefined);

  if (loading) return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  if (error) return <Centered><FontAwesome name="exclamation-triangle" size={20} color={colors.muted} /><Text style={{ color: colors.textMuted }} className="text-xs mt-2">Couldn’t preview</Text></Centered>;

  // ── Web full view: native HTML table (fast scroll both axes, sticky header) ──
  if (useHtml) {
    if (html === null) return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
    const styled =
      `<style>` +
      `.tfwrap{overflow:auto;height:100%;width:100%;}` +
      `.tfwrap table{border-collapse:collapse;font-family:sans-serif;font-size:11px;}` +
      `.tfwrap td{border:1px solid ${colors.border};padding:4px 8px;color:${colors.textMuted};white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis;}` +
      `.tfwrap tr:first-child td{background:${colors.background};color:${colors.textMain};font-weight:700;position:sticky;top:0;z-index:1;}` +
      `</style>` +
      `<div class="tfwrap">${html}</div>`;
    return (
      <View className="flex-1">
        <SheetTabs names={names} active={active} setActive={setActive} colors={colors} />
        <View className="flex-1">
          {React.createElement('div', { dangerouslySetInnerHTML: { __html: styled }, style: { height: '100%', width: '100%' } })}
        </View>
      </View>
    );
  }

  // ── Teaser + native: lightweight RN render ──
  const display = (rows ?? []).slice(0, compact ? (maxRows ?? 6) : 100);
  if (rows === null) return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  if (display.length === 0) return <Centered><Text style={{ color: colors.textMuted }} className="text-xs">Empty sheet</Text></Centered>;

  const colCount = Math.min(MAX_COLS, display.reduce((m, r) => Math.max(m, r.length), 0));
  const cols = Array.from({ length: colCount });
  const renderRow = (row: any[], r: number) => (
    <View key={r} className="flex-row" style={{ height: ROW_H }}>
      {cols.map((_, c) => {
        const isHeader = r === 0;
        return (
          <View key={c} style={{ width: COL_W, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: isHeader ? colors.background : colors.card, justifyContent: 'center', paddingHorizontal: 8 }}>
            <Text numberOfLines={1} style={{ color: isHeader ? colors.textMain : colors.textMuted, fontWeight: isHeader ? '800' : '500', fontSize: 11 }}>
              {row[c] != null ? String(row[c]) : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );

  if (compact) return <View pointerEvents="none">{display.map(renderRow)}</View>;

  return (
    <View className="flex-1">
      <SheetTabs names={names} active={active} setActive={setActive} colors={colors} />
      <ScrollView style={{ flex: 1 }}>
        <ScrollView horizontal>
          <View>{display.map(renderRow)}</View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
function PdfView({ uri }: { uri: string }) {
  const colors = useThemeColors();
  if (!isWeb) {
    return <Centered><FontAwesome name="file-pdf-o" size={28} color={colors.danger} /><Text style={{ color: colors.textMuted }} className="text-xs mt-2 text-center">Open or download to view this PDF</Text></Centered>;
  }
  return React.createElement('iframe', { src: uri, style: { border: 'none', width: '100%', height: '100%', borderRadius: 8, background: '#fff' } });
}

// ─── DOCX ─────────────────────────────────────────────────────────────────────
function useDocxHtml(uri: string) {
  const [state, setState] = useState<{ loading: boolean; error: boolean; html: string }>(
    () => (docxCache.has(uri) ? { loading: false, error: false, html: docxCache.get(uri)! } : { loading: true, error: false, html: '' })
  );
  useEffect(() => {
    if (docxCache.has(uri)) { setState({ loading: false, error: false, html: docxCache.get(uri)! }); return; }
    let cancelled = false;
    setState({ loading: true, error: false, html: '' });
    (async () => {
      try {
        const buf = await (await fetch(uri)).arrayBuffer();
        const mammoth = await import('mammoth');
        const { value } = await mammoth.convertToHtml({ arrayBuffer: buf });
        docxCache.set(uri, value);
        if (!cancelled) setState({ loading: false, error: false, html: value });
      } catch {
        if (!cancelled) setState({ loading: false, error: true, html: '' });
      }
    })();
    return () => { cancelled = true; };
  }, [uri]);
  return state;
}

function DocxView({ uri }: { uri: string }) {
  const colors = useThemeColors();
  const { loading, error, html } = useDocxHtml(uri);
  if (!isWeb) return <Centered><FontAwesome name="file-word-o" size={28} color={colors.info} /><Text style={{ color: colors.textMuted }} className="text-xs mt-2 text-center">Open or download to view this document</Text></Centered>;
  if (loading) return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  if (error) return <Centered><FontAwesome name="exclamation-triangle" size={20} color={colors.muted} /><Text style={{ color: colors.textMuted }} className="text-xs mt-2">Couldn’t preview</Text></Centered>;
  return React.createElement('div', {
    dangerouslySetInnerHTML: { __html: html },
    style: { overflow: 'auto', height: '100%', background: '#fff', color: '#1a1a1a', padding: '32px 40px', borderRadius: 8, lineHeight: 1.6, fontFamily: 'Georgia, serif', fontSize: 15 },
  });
}

// ─── Text ─────────────────────────────────────────────────────────────────────
function useText(uri: string) {
  const [state, setState] = useState<{ loading: boolean; error: boolean; text: string }>(
    () => (textCache.has(uri) ? { loading: false, error: false, text: textCache.get(uri)! } : { loading: true, error: false, text: '' })
  );
  useEffect(() => {
    if (textCache.has(uri)) { setState({ loading: false, error: false, text: textCache.get(uri)! }); return; }
    let cancelled = false;
    setState({ loading: true, error: false, text: '' });
    fetch(uri)
      .then(r => r.text())
      .then(t => { textCache.set(uri, t); if (!cancelled) setState({ loading: false, error: false, text: t }); })
      .catch(() => { if (!cancelled) setState({ loading: false, error: true, text: '' }); });
    return () => { cancelled = true; };
  }, [uri]);
  return state;
}

function TextView({ uri, compact = false, maxRows = 8 }: { uri: string; compact?: boolean; maxRows?: number }) {
  const colors = useThemeColors();
  const { loading, error, text } = useText(uri);
  if (loading) return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  if (error) return <Centered><Text style={{ color: colors.textMuted }} className="text-xs">Couldn’t preview</Text></Centered>;
  const shown = compact ? text.split('\n').slice(0, maxRows).join('\n') : text;
  const body = (
    <Text selectable={!compact} style={{ color: colors.textMuted, fontSize: 12, fontFamily: Platform.select({ web: 'monospace', default: undefined }) }}>
      {shown}
    </Text>
  );
  if (compact) return <View pointerEvents="none" className="p-3">{body}</View>;
  return <ScrollView className="flex-1 p-3" horizontal={false}><ScrollView horizontal>{body}</ScrollView></ScrollView>;
}

// ─── Public: teaser + modal ─────────────────────────────────────────────────
function KindBody({ uri, kind, compact, teaserHeight }: { uri: string; kind: PreviewKind; compact?: boolean; teaserHeight?: number }) {
  const colors = useThemeColors();
  switch (kind) {
    case 'spreadsheet':
      return <SpreadsheetView uri={uri} compact={compact} maxRows={teaserHeight ? Math.max(4, Math.floor(teaserHeight / ROW_H)) : undefined} />;
    case 'text':
      return <TextView uri={uri} compact={compact} />;
    case 'pdf':
      if (compact) return <Centered><FontAwesome name="file-pdf-o" size={26} color={colors.danger} /><Text style={{ color: colors.textMuted }} className="text-[10px] font-bold mt-1.5 uppercase tracking-wide">Tap to preview PDF</Text></Centered>;
      return <PdfView uri={uri} />;
    case 'docx':
      if (compact) return <Centered><FontAwesome name="file-word-o" size={26} color={colors.info} /><Text style={{ color: colors.textMuted }} className="text-[10px] font-bold mt-1.5 uppercase tracking-wide">Tap to preview document</Text></Centered>;
      return <DocxView uri={uri} />;
  }
}

/** Clickable compact preview for a file's detail header. */
export function FilePreviewTeaser({
  uri,
  kind,
  onPress,
  height = 120,
}: {
  uri: string;
  kind: PreviewKind;
  onPress: () => void;
  height?: number;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      className="w-full rounded-2xl mb-3 overflow-hidden border relative"
      style={[{ height, backgroundColor: colors.card, borderColor: colors.border }, isWeb ? ({ cursor: 'pointer' } as any) : null]}
    >
      <KindBody uri={uri} kind={kind} compact teaserHeight={height} />
      <View className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-black/55 items-center justify-center">
        <FontAwesome name="search-plus" size={11} color="#fff" />
      </View>
    </TouchableOpacity>
  );
}

/** Full-screen viewer for non-image files. */
export function FilePreviewModal({
  visible,
  uri,
  fileName,
  kind,
  onClose,
  onDownload,
}: {
  visible: boolean;
  uri: string;
  fileName: string;
  kind: PreviewKind;
  onClose: () => void;
  onDownload?: () => void;
}) {
  const colors = useThemeColors();
  const icon = kind === 'spreadsheet' ? 'table' : kind === 'pdf' ? 'file-pdf-o' : kind === 'docx' ? 'file-word-o' : 'file-text-o';
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/90 px-4" style={{ paddingTop: 48, paddingBottom: 24 }}>
        <View className="flex-row items-center mb-3 gap-2">
          <FontAwesome name={icon as any} size={14} color="#fff" />
          <Text numberOfLines={1} className="flex-1 text-white font-bold text-sm">{fileName}</Text>
          {onDownload && (
            <TouchableOpacity onPress={onDownload} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} className="w-9 h-9 rounded-full bg-white/10 items-center justify-center" style={isWeb ? ({ cursor: 'pointer' } as any) : undefined}>
              <FontAwesome name="download" size={14} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} className="w-9 h-9 rounded-full bg-white/10 items-center justify-center" style={isWeb ? ({ cursor: 'pointer' } as any) : undefined}>
            <FontAwesome name="times" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
        <View className="flex-1 rounded-2xl overflow-hidden border" style={{ borderColor: colors.border, backgroundColor: colors.card, padding: kind === 'spreadsheet' || kind === 'text' ? 8 : 0 }}>
          {visible && <KindBody uri={uri} kind={kind} />}
        </View>
      </View>
    </Modal>
  );
}
