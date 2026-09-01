import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { walkEntry } from '@/lib/fileDropEntries';

// react-native-web's View/TouchableOpacity only forward an allowlist of DOM
// props (click/mouse/touch/pointer/aria) — draggable/onDragStart/onDrop are
// NOT in that list, so passing them as props silently does nothing. Instead
// we grab the underlying DOM node via ref (ref forwarding IS allowlisted)
// and attach real browser drag events to it.
// ponytail: web-only DnD; native mobile uses long-press move-to-folder instead.

// Same-page drags carry a JS object, not text. Round-tripping it through
// dataTransfer.getData('application/json') is unreliable — several browsers
// return an empty string for custom MIME types on `drop` even though setData
// succeeded on `dragstart`, which silently killed every file→folder move.
// A module-level ref is the source of truth (only one drag is ever active);
// dataTransfer.setData still runs so the browser treats it as a valid drag.
let activeDragPayload: unknown = null;

// ─── Global "an OS file drag is in progress somewhere in the window" signal ───
// True from the moment an OS file drag enters the browser window until it drops
// or leaves — so every mounted drop zone can show its idle affordance at once
// (Slack/Notion pattern), not just the one zone the cursor has reached.
// Installed once at import, web-only, same shape as lib/webModifierKeys.

// True only for a real OS file drag (Explorer/Finder), never an in-app row drag
// (those carry activeDragPayload and no 'Files' type). Shared by useFileDrop and
// the window-level tracker below so the guard lives in exactly one place.
const isOsFileDrag = (e: DragEvent) =>
  activeDragPayload === null && !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

// Pure counter step, exported for the self-check. dragenter/dragleave fire per
// element boundary so they're balanced; drop/dragend hard-reset to 0.
export function nextDragDepth(depth: number, kind: 'enter' | 'leave' | 'reset'): number {
  if (kind === 'reset') return 0;
  return kind === 'enter' ? depth + 1 : Math.max(0, depth - 1);
}

let _dragDepth = 0;
const _dragListeners = new Set<() => void>();
function _setDragDepth(next: number) {
  const wasActive = _dragDepth > 0;
  _dragDepth = Math.max(0, next);
  if ((_dragDepth > 0) !== wasActive) _dragListeners.forEach(l => l());
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('dragenter', e => { if (isOsFileDrag(e as DragEvent)) _setDragDepth(nextDragDepth(_dragDepth, 'enter')); }, true);
  window.addEventListener('dragleave', e => { if (isOsFileDrag(e as DragEvent)) _setDragDepth(nextDragDepth(_dragDepth, 'leave')); }, true);
  // ponytail: best-effort — a drag that leaves the window without a final
  // balancing dragleave is caught by these. Upgrade to pointer tracking only if
  // a stuck overlay is ever actually reported.
  window.addEventListener('drop', () => _setDragDepth(0), true);
  window.addEventListener('dragend', () => _setDragDepth(0), true);
}

const _dragActiveStore = {
  subscribe(cb: () => void) { _dragListeners.add(cb); return () => { _dragListeners.delete(cb); }; },
  getSnapshot: () => _dragDepth > 0,
};

/** True while an OS file drag is anywhere over the window (web); always false on native. */
export function useIsFileDragActive(): boolean {
  return useSyncExternalStore(_dragActiveStore.subscribe, _dragActiveStore.getSnapshot, () => false);
}

export function useDragSource<T>(payload: T, enabled: boolean = true) {
  const ref = useRef<any>(null);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    if (!enabled) return;

    el.setAttribute('draggable', 'true');
    el.style.cursor = 'grab';
    const onDragStart = (e: DragEvent) => {
      activeDragPayload = payloadRef.current;
      // Still set data so the browser registers a valid drag (some browsers
      // won't start one otherwise); the value itself is read back from the ref.
      e.dataTransfer?.setData('application/json', JSON.stringify(payloadRef.current));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    };
    const onDragEnd = () => { activeDragPayload = null; };
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragend', onDragEnd);
    return () => {
      el.removeEventListener('dragstart', onDragStart);
      el.removeEventListener('dragend', onDragEnd);
      el.removeAttribute('draggable');
      el.style.cursor = '';
    };
  }, [enabled]);

  return ref;
}

// Windows-Explorer-style rubber-band selection: mousedown on empty space
// (not on a row) starts a marquee; any element rendered with
// dataSet={{ marqueeId: '<id>' }} that the marquee rectangle overlaps gets
// selected. Hit-testing uses getBoundingClientRect() (viewport-relative) for
// both the marquee and the rows; the returned marqueeRect is converted to
// container-relative coordinates since it's meant to be rendered as an
// absolutely-positioned child of the (position: relative) container.
export function useMarqueeSelect(onSelectionChange: (ids: string[]) => void, enabled: boolean = true) {
  const containerRef = useRef<any>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const container = containerRef.current as HTMLElement | null;
    if (!container || typeof container.addEventListener !== 'function' || !enabled) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let containerRect = { left: 0, top: 0 };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      setMarqueeRect({ x: x - containerRect.left, y: y - containerRect.top, w, h });

      const right = x + w;
      const bottom = y + h;
      const selected: string[] = [];
      container.querySelectorAll('[data-marquee-id]').forEach(el => {
        const r = el.getBoundingClientRect();
        const intersects = r.right >= x && r.left <= right && r.bottom >= y && r.top <= bottom;
        if (intersects) {
          const id = el.getAttribute('data-marquee-id');
          if (id) selected.push(id);
        }
      });
      onSelectionChangeRef.current(selected);
    };
    const onMouseUp = () => {
      dragging = false;
      setMarqueeRect(null);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Start the marquee unless the mousedown originated on (or inside) a
      // selectable row — clicking a row should drag/select it normally, not
      // start a rubber-band over the whole list.
      if ((e.target as HTMLElement).closest?.('[data-marquee-id]')) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      containerRect = container.getBoundingClientRect();
      setMarqueeRect({ x: startX - containerRect.left, y: startY - containerRect.top, w: 0, h: 0 });
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    container.addEventListener('mousedown', onMouseDown);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [enabled]);

  return { containerRef, marqueeRect };
}

export function useDropTarget<T>(onDrop: (payload: T) => void, canAccept: (payload: T) => boolean, enabled: boolean = true) {
  const ref = useRef<any>(null);
  const [isOver, setIsOver] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const canAcceptRef = useRef(canAccept);
  canAcceptRef.current = canAccept;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = ref.current as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    if (!enabled) return;

    const readPayload = (e: DragEvent): T | null => {
      // Prefer the module-level ref (reliable); fall back to dataTransfer for
      // completeness (e.g. a drag that started outside this hook).
      if (activeDragPayload !== null) return activeDragPayload as T;
      const raw = e.dataTransfer?.getData('application/json');
      if (!raw) return null;
      try { return JSON.parse(raw) as T; } catch { return null; }
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    };
    const onDragEnter = () => setIsOver(true);
    const onDragLeave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node)) setIsOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsOver(false);
      const payload = readPayload(e);
      // canAccept === false is a legitimate no-op (e.g. folder dropped on
      // itself), so it stays silent; a null payload would be a real bug now
      // that the module-level ref backs it, hence not logged either.
      if (payload !== null && canAcceptRef.current(payload)) onDropRef.current(payload);
    };
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragenter', onDragEnter);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [enabled]);

  return { ref, isOver };
}

// ─── OS-file drop (drag files in from Explorer/Finder) ───────────────────────
// Distinct from useDropTarget above: that moves rows around inside the app
// (an app-authored JS payload); this accepts real files dropped from the OS.
// The returned File[] is shaped exactly like an <input type=file> / webkitdir
// pick — folder drops recurse and each file carries a webkitRelativePath, so
// the existing upload pipelines (relDir + rpc p_rel_dir) nest them unchanged.
// ponytail: web-only; native has no OS drag source. Wire the ref to any View.

export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean = true) {
  // Callback ref (+ node state) rather than a plain useRef so the listeners
  // re-attach when the target mounts/unmounts — several drop zones live inside
  // conditionally-rendered or collapsible containers.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const ref = useCallback((el: any) => setNode(el ?? null), []);
  const [isOver, setIsOver] = useState(false);
  const isDragActive = useIsFileDragActive();
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;
    const el = node;
    if (!el || typeof el.addEventListener !== 'function') return;

    // Only react to OS file drags. An in-app row drag (activeDragPayload set, or
    // a non-Files dataTransfer) must pass through untouched. Same guard the
    // window-level tracker uses.
    const isFileDrag = isOsFileDrag;

    let depth = 0; // dragenter/leave fire per descendant; count to avoid flicker
    const onDragOver = (e: DragEvent) => { if (!isFileDrag(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const onDragEnter = (e: DragEvent) => { if (!isFileDrag(e)) return; e.preventDefault(); depth++; setIsOver(true); };
    const onDragLeave = () => { depth = Math.max(0, depth - 1); if (depth === 0) setIsOver(false); };
    const onDrop = async (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth = 0; setIsOver(false);
      const dt = e.dataTransfer!;
      const entries = dt.items && dt.items.length
        ? Array.from(dt.items).map(it => (it as any).webkitGetAsEntry?.()).filter(Boolean)
        : [];
      let files: File[];
      if (entries.length) {
        const nested = await Promise.all(entries.map(en => walkEntry(en, '')));
        files = nested.flat();
      } else {
        files = Array.from(dt.files || []);
      }
      if (files.length) onFilesRef.current(files);
    };

    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragenter', onDragEnter);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, [enabled, node]);

  // isDragActive: an OS file drag is somewhere over the window (any zone should
  // show its idle affordance); isOver: the cursor is over this specific node.
  return { ref, isOver, isDragActive };
}

// ─── Shared drop-indicator pulse ──────────────────────────────────────────────
// Every OS-file drop zone (FileHub upload modal, task composer, submission
// panel, brief panel) wants the same "breathing" affordance while a file is
// dragged over it. Lives here once, driven by that zone's own `isOver` flag,
// so the animation stays visually identical everywhere instead of each screen
// re-implementing its own loop.
export function useDropPulse(active: boolean) {
  const pulse = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!active) { pulse.setValue(0); return; }
    // Reduced motion: hold a static mid-affordance instead of looping.
    if (reduceMotion) { pulse.setValue(0.5); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse, reduceMotion]);

  return {
    iconScale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }),
    glowOpacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
  };
}

// ─── Smart clipboard paste (Ctrl/Cmd+V of files, images, or text) ─────────────
// Web-only sibling of useFileDrop: a single window-level `paste` listener that
// routes clipboard files/images to onFiles and bare text to onText. Files are
// always intercepted (a text field can't hold a pasted image); text is only
// intercepted when nothing editable is focused, so Ctrl+V into an input /
// textarea / contenteditable still does the normal in-field paste.
// ponytail: web-only; native has no bare-Ctrl+V idiom — the "Paste Image"
// button in the composer covers the native path.

// Pure parse of a paste's DataTransfer, split out so the self-check can exercise
// it without a real ClipboardEvent. The editable-target check + preventDefault
// routing stay in the hook below.
export function extractClipboardPayload(dt: DataTransfer): { files: File[]; text: string } {
  const files: File[] = [];
  // items[] is the reliable source for inline/screenshot images, which several
  // browsers never surface in .files.
  for (const item of Array.from(dt.items || [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (f) files.push(f);
    }
  }
  // Fallback: some browsers populate .files but leave .items empty.
  if (files.length === 0 && dt.files && dt.files.length) {
    files.push(...Array.from(dt.files));
  }
  return { files, text: dt.getData('text/plain') || '' };
}

export function useSmartPaste(
  handlers: { onFiles?: (files: File[]) => void; onText?: (text: string) => void },
  enabled: boolean = true,
): void {
  // Ref so a new handlers object every render doesn't re-subscribe the listener.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return; // native: no `paste` event, no-op
    if (typeof window === 'undefined') return;

    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const { files, text } = extractClipboardPayload(dt);
      const { onFiles, onText } = handlersRef.current;

      // Files win, even when a text field is focused — a textarea can't hold an image.
      if (files.length && onFiles) {
        e.preventDefault();
        onFiles(files);
        return;
      }
      if (onText && text) {
        const el = document.activeElement as HTMLElement | null;
        const tag = el?.tagName;
        const editable = tag === 'INPUT' || tag === 'TEXTAREA' || !!el?.isContentEditable;
        if (editable) return; // let the browser paste into the focused field
        e.preventDefault();
        onText(text);
      }
    };

    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [enabled]);
}
