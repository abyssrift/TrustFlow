// react-dom has no @types package installed (web-only usage is rare in this
// RN codebase); declare just what CalendarOverlay.web.tsx needs.
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactPortal;
}
