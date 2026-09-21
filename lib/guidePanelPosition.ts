export interface GuidePanelPoint {
  x: number;
  y: number;
}

export interface GuidePanelSize {
  width: number;
  height: number;
}

export interface GuidePanelViewport {
  width: number;
  height: number;
}

export const EDGE_INSET = 16;
export const DEFAULT_TOP_OFFSET = 72;
export const DEFAULT_LAUNCHER_BOTTOM = 24;
export const GUIDE_LAUNCHER_HEIGHT = 44;
export const GUIDE_PANEL_LAUNCHER_GAP = 8;
export const KEYBOARD_STEP = 16;
export const ACCELERATED_KEYBOARD_STEP = 48;

export function isGuidePanelPosition(raw: unknown): raw is GuidePanelPoint {
  if (typeof raw !== 'object' || raw === null) return false;
  const position = raw as Record<string, unknown>;
  return typeof position.x === 'number' && Number.isFinite(position.x)
    && typeof position.y === 'number' && Number.isFinite(position.y);
}

export function clampGuidePanelPosition(
  position: GuidePanelPoint,
  panelSize: GuidePanelSize,
  viewport: GuidePanelViewport,
): GuidePanelPoint {
  const maxX = Math.max(viewport.width - panelSize.width - EDGE_INSET, EDGE_INSET);
  const minY = viewport.width >= 768 ? DEFAULT_TOP_OFFSET : EDGE_INSET;
  const maxY = Math.max(viewport.height - panelSize.height - EDGE_INSET, minY);
  return {
    x: Math.min(Math.max(position.x, EDGE_INSET), maxX),
    y: Math.min(Math.max(position.y, minY), maxY),
  };
}

export function getDefaultGuidePanelPosition(
  panelSize: GuidePanelSize,
  viewport: GuidePanelViewport,
  launcherBottom = DEFAULT_LAUNCHER_BOTTOM,
): GuidePanelPoint {
  if (viewport.width >= 768) {
    return clampGuidePanelPosition({ x: viewport.width - panelSize.width - EDGE_INSET, y: DEFAULT_TOP_OFFSET }, panelSize, viewport);
  }
  return clampGuidePanelPosition({
    x: viewport.width - panelSize.width - EDGE_INSET,
    y: viewport.height - launcherBottom - GUIDE_LAUNCHER_HEIGHT - GUIDE_PANEL_LAUNCHER_GAP - panelSize.height,
  }, panelSize, viewport);
}

export function moveGuidePanelByKey(
  position: GuidePanelPoint,
  key: string,
  accelerated: boolean,
  panelSize: GuidePanelSize,
  viewport: GuidePanelViewport,
): GuidePanelPoint {
  const step = accelerated ? ACCELERATED_KEYBOARD_STEP : KEYBOARD_STEP;
  const movement: Record<string, GuidePanelPoint> = {
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 },
  };
  const delta = movement[key];
  if (!delta) return { x: position.x, y: position.y };
  return clampGuidePanelPosition({ x: position.x + delta.x, y: position.y + delta.y }, panelSize, viewport);
}
