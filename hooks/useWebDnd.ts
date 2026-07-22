import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

// react-native-web's View/TouchableOpacity only forward an allowlist of DOM
// props (click/mouse/touch/pointer/aria) — draggable/onDragStart/onDrop are
// NOT in that list, so passing them as props silently does nothing. Instead
// we grab the underlying DOM node via ref (ref forwarding IS allowlisted)
// and attach real browser drag events to it.
// ponytail: web-only DnD; native mobile uses long-press move-to-folder instead.

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
      e.dataTransfer?.setData('application/json', JSON.stringify(payloadRef.current));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    };
    el.addEventListener('dragstart', onDragStart);
    return () => {
      el.removeEventListener('dragstart', onDragStart);
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
