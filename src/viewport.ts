export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;
export const ZOOM_STEP = 1.25;

export let zoom = 0.78;
export let panX = 20;
export let panY = 18;

export type WorldRect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function getSceneRect(): DOMRect | null {
  return document.getElementById('canvas-scene')?.getBoundingClientRect() ?? null;
}

export function setCamera(next: { zoom?: number; panX?: number; panY?: number }): void {
  if (next.zoom !== undefined) zoom = clampZoom(next.zoom);
  if (next.panX !== undefined) panX = next.panX;
  if (next.panY !== undefined) panY = next.panY;
}

export function panBy(deltaX: number, deltaY: number): void {
  panX += deltaX;
  panY += deltaY;
}

export function sceneCenterAnchor(scene = getSceneRect()): { clientX: number; clientY: number } | undefined {
  if (!scene) return undefined;
  return { clientX: scene.left + scene.width / 2, clientY: scene.top + scene.height / 2 };
}

export function setZoom(nextZoom: number, anchor?: { clientX: number; clientY: number }): void {
  const scene = getSceneRect();
  const current = zoom;
  const next = clampZoom(nextZoom);
  if (scene && next !== current) {
    const localX = (anchor?.clientX ?? scene.left + scene.width / 2) - scene.left;
    const localY = (anchor?.clientY ?? scene.top + scene.height / 2) - scene.top;
    panX = localX - ((localX - panX) / current) * next;
    panY = localY - ((localY - panY) / current) * next;
  }
  zoom = next;
}

export function zoomIn(anchor?: { clientX: number; clientY: number }): void {
  setZoom(zoom * ZOOM_STEP, anchor ?? sceneCenterAnchor());
}

export function zoomOut(anchor?: { clientX: number; clientY: number }): void {
  setZoom(zoom / ZOOM_STEP, anchor ?? sceneCenterAnchor());
}

export function resetZoom(anchor?: { clientX: number; clientY: number }): void {
  setZoom(1, anchor ?? sceneCenterAnchor());
}

export function fitWorldRect(
  world: WorldRect | null,
  options: { padding?: number; minScale?: number; maxScale?: number } = {},
): void {
  const scene = getSceneRect();
  if (!world || !scene || scene.width < 1 || scene.height < 1) {
    resetZoom();
    return;
  }
  const padding = options.padding ?? 80;
  const minScale = options.minScale ?? 0.05;
  const maxScale = options.maxScale ?? 2;
  const docW = Math.max(1, world.maxX - world.minX);
  const docH = Math.max(1, world.maxY - world.minY);
  const scale = clampZoom(Math.max(
    minScale,
    Math.min(maxScale, Math.min(scene.width / (docW + padding * 2), scene.height / (docH + padding * 2))),
  ));
  const centerX = world.minX + docW / 2;
  const centerY = world.minY + docH / 2;
  zoom = scale;
  panX = scene.width / 2 - centerX * scale;
  panY = scene.height / 2 - centerY * scale;
}

export function screenToWorld(clientX: number, clientY: number, scene: DOMRect): { x: number; y: number } {
  return {
    x: (clientX - scene.left - panX) / zoom,
    y: (clientY - scene.top - panY) / zoom,
  };
}

export function worldToScreen(x: number, y: number, scene: DOMRect): { x: number; y: number } {
  return {
    x: scene.left + panX + x * zoom,
    y: scene.top + panY + y * zoom,
  };
}
