import { useEffect, useRef, useState } from 'react';

/**
 * Shared hover+click trigger for the topbar's small popovers (pinned
 * shortcuts, notifications): hovering opens it, leaving schedules a close
 * (bridging the trigger→panel gap), and a click latches it open so it
 * survives the cursor leaving — closed only by an outside click or an
 * explicit close. Extracted from the copy this used to be in
 * PinnedShortcuts.web.tsx; same `el instanceof Element ? el :
 * el.getDOMNode?.()` escape hatch so it works whether `wrapperRef` lands on
 * a raw `<div>` or an RN View/Pressable (RNW's hover props on those aren't
 * reliable — see the sibling note on drag props in hooks/useWebDnd.ts).
 */
export function useDropdownTrigger(closeDelayMs = 0) {
  const [hovered, setHovered] = useState(false);
  const [clickedOpen, setClickedOpen] = useState(false);
  const wrapperRef = useRef<any>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = hovered || clickedOpen;

  const resolveDomNode = () => {
    const el = wrapperRef.current;
    return el instanceof Element ? el : (el as any)?.getDOMNode?.() ?? null;
  };

  useEffect(() => {
    const domNode = resolveDomNode();
    if (!domNode) return;
    const onEnter = () => {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setHovered(true);
    };
    const onLeave = () => {
      if (closeDelayMs <= 0) { setHovered(false); return; }
      closeTimer.current = setTimeout(() => { closeTimer.current = null; setHovered(false); }, closeDelayMs);
    };
    domNode.addEventListener('mouseenter', onEnter);
    domNode.addEventListener('mouseleave', onLeave);
    return () => {
      domNode.removeEventListener('mouseenter', onEnter);
      domNode.removeEventListener('mouseleave', onLeave);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click still works as a fallback (e.g. touch input, where hover never
  // fires) and is what makes the panel stick around once the cursor leaves.
  useEffect(() => {
    if (!clickedOpen) return;
    const onDown = (e: MouseEvent) => {
      const domNode = resolveDomNode();
      if (domNode && !domNode.contains(e.target as Node)) setClickedOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [clickedOpen]);

  const toggle = () => setClickedOpen((v) => !v);
  const closeNow = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setHovered(false);
    setClickedOpen(false);
  };

  return { open, hovered, clickedOpen, setClickedOpen, wrapperRef, toggle, closeNow };
}
