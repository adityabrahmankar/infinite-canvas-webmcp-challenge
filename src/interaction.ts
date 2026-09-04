import { isFlexLayout, isRowLayout } from './layout';
import { store } from './store';
import type { CanvasTool, DesignNode, ResizeHandle } from './types';
import { panX, panY, screenToWorld, setCamera, zoom } from './viewport';

const HANDLE_HIT = 14;
const DRAG_THRESHOLD = 3;
const MIN_SIZE = 8;

let currentTool: CanvasTool = 'select';
let spaceHeld = false;
let pointerId: number | null = null;
let mode: 'idle' | 'pan' | 'drag' | 'resize' | 'marquee' | 'create' = 'idle';
let pointerStartScreen = { x: 0, y: 0 };
let pointerStartWorld = { x: 0, y: 0 };
let lastScreen = { x: 0, y: 0 };
let dragSnapshots: Array<{ id: string; x: number; y: number; worldX: number; worldY: number }> = [];
let dragKind: 'freeform' | 'reorder' | 'detach' = 'freeform';
let resizeSnapshot: { id: string; width: number; height: number; worldX: number; worldY: number } | null = null;
let activeHandle: ResizeHandle | null = null;
let marqueeStart = { x: 0, y: 0 };
let marqueeCurrent = { x: 0, y: 0 };
let marqueeBaseIds: string[] = [];
let createStart = { x: 0, y: 0 };
let createCurrent = { x: 0, y: 0 };
let createKind: 'frame' | 'rect' | 'text' | 'button' = 'frame';
let didMove = false;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeInteraction(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCanvasTool(): CanvasTool {
  return currentTool;
}

export function setCanvasTool(tool: CanvasTool): void {
  currentTool = tool;
  emit();
}

export function isSpaceHeld(): boolean {
  return spaceHeld;
}

export function setSpaceHeld(value: boolean): void {
  spaceHeld = value;
  emit();
}

export function interactionOverlay(): {
  marquee: { x: number; y: number; width: number; height: number } | null;
  create: { x: number; y: number; width: number; height: number; kind: string } | null;
} {
  const box = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  });
  return {
    marquee: mode === 'marquee' ? box(marqueeStart, marqueeCurrent) : null,
    create: mode === 'create' ? { ...box(createStart, createCurrent), kind: createKind } : null,
  };
}

function sceneRect(): DOMRect | null {
  return document.getElementById('canvas-scene')?.getBoundingClientRect() ?? null;
}

function hitTest(worldX: number, worldY: number): DesignNode | null {
  // worldBounds consumes the browser-resolved layout snapshot captured by
  // renderScene. This keeps hit-testing deterministic and usable by keyboard,
  // synthetic, and non-browser callers instead of coupling it to a DOM hit
  // stack.
  const visit = (ids: string[]): DesignNode | null => {
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const node = store.getNode(ids[index]);
      if (!node || node.hidden) continue;
      const bounds = store.worldBounds(node);
      if (worldX < bounds.x || worldY < bounds.y || worldX > bounds.x + bounds.width || worldY > bounds.y + bounds.height) continue;
      const child = visit(node.children);
      if (child) return child;
      return node;
    }
    return null;
  };
  return visit(store.rootIds);
}

function lowestCommonAncestor(a: DesignNode, b: DesignNode): DesignNode | null {
  const ancestors = new Set<string>();
  let current: DesignNode | undefined = a;
  while (current) {
    ancestors.add(current.id);
    current = current.parentId ? store.getNode(current.parentId) : undefined;
  }
  current = b;
  while (current) {
    if (ancestors.has(current.id)) return current;
    current = current.parentId ? store.getNode(current.parentId) : undefined;
  }
  return null;
}

function childOnPath(parent: DesignNode, descendant: DesignNode): DesignNode | null {
  if (parent.id === descendant.id) return parent;
  let child: DesignNode | undefined = descendant;
  while (child && child.parentId && child.parentId !== parent.id) child = store.getNode(child.parentId);
  return child && child.parentId === parent.id ? child : null;
}

function isAdditiveSelect(event: PointerEvent | MouseEvent): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

function selectionNodeForPointer(hit: DesignNode): DesignNode {
  const artboard = store.artboardOf(hit);
  const selected = store.getNode(store.selectedId);
  if (!selected) return artboard;
  if (store.artboardOf(selected).id !== artboard.id) return artboard;
  // Enter the visible artboard's children with a normal click. Shift/⌘/Ctrl
  // then add sibling layers at this depth instead of replacing the selection.
  if (selected.id === artboard.id && hit.id !== artboard.id) return hit;
  if (selected.id === hit.id || store.isDescendant(hit.id, selected.id)) return selected;
  const lca = lowestCommonAncestor(selected, hit);
  if (lca) {
    const next = childOnPath(lca, hit);
    if (next) return next;
  }
  return artboard;
}

function intersectingNodes(minX: number, minY: number, maxX: number, maxY: number): string[] {
  const ids: string[] = [];
  const marqueeContains = (bounds: { x: number; y: number; width: number; height: number }): boolean => (
    bounds.x <= minX && bounds.y <= minY && bounds.x + bounds.width >= maxX && bounds.y + bounds.height >= maxY
  );
  const intersects = (bounds: { x: number; y: number; width: number; height: number }): boolean => (
    bounds.x < maxX && bounds.x + bounds.width > minX && bounds.y < maxY && bounds.y + bounds.height > minY
  );
  const visit = (id: string): void => {
    const node = store.getNode(id);
    if (!node || node.hidden) return;
    const bounds = store.worldBounds(node);
    if (intersects(bounds)) ids.push(id);
    node.children.forEach(visit);
  };
  store.rootIds.forEach(visit);
  const idSet = new Set(ids);
  return ids.filter((id) => {
    const node = store.getNode(id);
    if (!node) return false;
    if (!marqueeContains(store.worldBounds(node))) return true;
    return !node.children.some((childId) => idSet.has(childId));
  });
}

function handleAtPoint(clientX: number, clientY: number): ResizeHandle | null {
  if (store.selectedIds.length !== 1) return null;
  const node = store.getNode(store.selectedId);
  const scene = sceneRect();
  if (!node || !scene) return null;
  const bounds = store.worldBounds(node);
  const left = panX + bounds.x * zoom;
  const top = panY + bounds.y * zoom;
  const width = bounds.width * zoom;
  const height = bounds.height * zoom;
  const localX = clientX - scene.left;
  const localY = clientY - scene.top;
  const points: Array<{ handle: ResizeHandle; x: number; y: number }> = [
    { handle: 'nw', x: left, y: top },
    { handle: 'n', x: left + width / 2, y: top },
    { handle: 'ne', x: left + width, y: top },
    { handle: 'e', x: left + width, y: top + height / 2 },
    { handle: 'se', x: left + width, y: top + height },
    { handle: 's', x: left + width / 2, y: top + height },
    { handle: 'sw', x: left, y: top + height },
    { handle: 'w', x: left, y: top + height / 2 },
  ];
  return points.find((point) => Math.hypot(localX - point.x, localY - point.y) <= HANDLE_HIT)?.handle ?? null;
}

function frameAtPoint(worldX: number, worldY: number): DesignNode | null {
  let current = hitTest(worldX, worldY);
  while (current && current.kind !== 'frame') {
    current = current.parentId ? store.getNode(current.parentId) ?? null : null;
  }
  return current;
}

function flexParentOf(node: DesignNode): DesignNode | undefined {
  if (!node.parentId) return undefined;
  const parent = store.getNode(node.parentId);
  return parent && isFlexLayout(parent.layout) ? parent : undefined;
}

function insertionIndex(parent: DesignNode, draggedIds: string[], worldX: number, worldY: number): number {
  const row = isRowLayout(parent.layout);
  const pointer = row ? worldX : worldY;
  const siblings = parent.children.filter((id) => !draggedIds.includes(id));
  for (let index = 0; index < siblings.length; index += 1) {
    const sibling = store.getNode(siblings[index]);
    if (!sibling) continue;
    const bounds = store.worldBounds(sibling);
    const mid = row ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2;
    if (pointer < mid) return index;
  }
  return siblings.length;
}

function defaultSize(kind: 'frame' | 'rect' | 'text' | 'button'): { width: number; height: number } {
  if (kind === 'frame') return { width: 320, height: 240 };
  if (kind === 'rect') return { width: 200, height: 140 };
  if (kind === 'button') return { width: 140, height: 36 };
  return { width: 180, height: 32 };
}

function parentForCreate(kind: 'frame' | 'rect' | 'text' | 'button', startX: number, startY: number): DesignNode | null {
  const container = frameAtPoint(startX, startY);
  if (kind === 'frame' && !container) return null;
  return container;
}

function commitCreate(): void {
  let width = Math.abs(createCurrent.x - createStart.x);
  let height = Math.abs(createCurrent.y - createStart.y);
  const defaults = defaultSize(createKind);
  if (width <= 10 || height <= 10) {
    width = defaults.width;
    height = defaults.height;
  }
  const worldX = Math.min(createStart.x, createCurrent.x);
  const worldY = Math.min(createStart.y, createCurrent.y);
  const parent = parentForCreate(createKind, createStart.x, createStart.y);
  const origin = parent ? store.worldOrigin(parent) : { x: 0, y: 0 };
  store.createNode({
    kind: createKind,
    parentId: parent?.id ?? null,
    x: worldX - origin.x,
    y: worldY - origin.y,
    width,
    height,
  });
  setCanvasTool('select');
}

function applyLiveResize(worldX: number, worldY: number, shift: boolean): void {
  const initial = resizeSnapshot;
  const node = initial ? store.getNode(initial.id) : undefined;
  if (!initial || !node || !activeHandle) return;
  const dx = worldX - pointerStartWorld.x;
  const dy = worldY - pointerStartWorld.y;
  let width = initial.width;
  let height = initial.height;
  let worldLeft = initial.worldX;
  let worldTop = initial.worldY;
  if (activeHandle.includes('e')) width = Math.max(MIN_SIZE, initial.width + dx);
  if (activeHandle.includes('s')) height = Math.max(MIN_SIZE, initial.height + dy);
  if (activeHandle.includes('w')) {
    width = Math.max(MIN_SIZE, initial.width - dx);
    worldLeft = initial.worldX + initial.width - width;
  }
  if (activeHandle.includes('n')) {
    height = Math.max(MIN_SIZE, initial.height - dy);
    worldTop = initial.worldY + initial.height - height;
  }
  if (shift && initial.width > 0 && initial.height > 0 && activeHandle.length === 2) {
    const ratio = initial.width / initial.height;
    const max = Math.max(width, height * ratio);
    width = max;
    height = max / ratio;
    if (activeHandle.includes('w')) worldLeft = initial.worldX + initial.width - width;
    if (activeHandle.includes('n')) worldTop = initial.worldY + initial.height - height;
  }
  const parent = node.parentId ? store.getNode(node.parentId) : undefined;
  const parentOrigin = parent ? store.worldOrigin(parent) : { x: 0, y: 0 };
  store.applyGeometry(node, {
    x: worldLeft - parentOrigin.x,
    y: worldTop - parentOrigin.y,
    width,
    height,
  });
  store.notify();
}

export function deleteSelection(): boolean {
  if (!store.selectedIds.length) return false;
  store.deleteNodes(store.selectedIds);
  return true;
}

export function nudgeSelection(dx: number, dy: number): boolean {
  const roots = store.selectedRoots();
  if (!roots.length) return false;
  store.moveNodes(roots.map((node) => node.id), dx, dy);
  return true;
}

function updateCursor(scene: HTMLElement, event?: PointerEvent): void {
  if (spaceHeld || currentTool === 'hand' || mode === 'pan') {
    scene.style.cursor = mode === 'pan' ? 'grabbing' : 'grab';
    return;
  }
  if (currentTool === 'frame' || currentTool === 'rect' || currentTool === 'text' || currentTool === 'button') {
    scene.style.cursor = 'crosshair';
    return;
  }
  const handle = event ? handleAtPoint(event.clientX, event.clientY) : null;
  if (handle) {
    const cursors: Record<ResizeHandle, string> = {
      n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
      ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
    };
    scene.style.cursor = cursors[handle];
    return;
  }
  scene.style.cursor = mode === 'drag' && didMove ? 'grabbing' : 'default';
}

export function installInteraction(): void {
  const scene = document.getElementById('canvas-scene');
  if (!scene) return;

  scene.addEventListener('pointerdown', (event) => {
    if (event.button === 2) return;
    event.preventDefault();
    const rect = scene.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY, rect);
    pointerId = event.pointerId;
    pointerStartScreen = { x: event.clientX, y: event.clientY };
    pointerStartWorld = world;
    lastScreen = { x: event.clientX, y: event.clientY };
    didMove = false;
    try { scene.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
    scene.focus({ preventScroll: true });

    if (event.button === 1 || spaceHeld || currentTool === 'hand') {
      mode = 'pan';
      scene.classList.add('is-panning');
      updateCursor(scene, event);
      return;
    }

    if (currentTool === 'frame' || currentTool === 'rect' || currentTool === 'text' || currentTool === 'button') {
      mode = 'create';
      createKind = currentTool;
      createStart = world;
      createCurrent = world;
      emit();
      return;
    }

    const handle = handleAtPoint(event.clientX, event.clientY);
    const solo = store.getNode(store.selectedId);
    if (handle && solo && store.selectedIds.length === 1) {
      const bounds = store.resolvedBounds(solo);
      const origin = store.worldOrigin(solo);
      store.beginGesture();
      activeHandle = handle;
      resizeSnapshot = { id: solo.id, width: bounds.width, height: bounds.height, worldX: origin.x, worldY: origin.y };
      mode = 'resize';
      updateCursor(scene, event);
      emit();
      return;
    }

    const hit = hitTest(world.x, world.y);
    if (hit) {
      const target = selectionNodeForPointer(hit);
      if (isAdditiveSelect(event)) store.toggleSelect(target.id);
      else if (!store.isSelected(target.id)) store.select(target.id);
      dragSnapshots = store.selectedRoots().filter((node) => !node.locked).map((node) => {
        const origin = store.worldOrigin(node);
        return { id: node.id, x: node.x, y: node.y, worldX: origin.x, worldY: origin.y };
      });
      dragKind = 'freeform';
      mode = 'drag';
    } else {
      if (!isAdditiveSelect(event)) store.clearSelection();
      marqueeBaseIds = isAdditiveSelect(event) ? [...store.selectedIds] : [];
      mode = 'marquee';
      marqueeStart = world;
      marqueeCurrent = world;
      emit();
    }
    updateCursor(scene, event);
  });

  const roundGestureNodes = (): void => {
    if (mode === 'drag' && dragKind === 'reorder') return;
    const ids = mode === 'resize' && resizeSnapshot
      ? [resizeSnapshot.id]
      : dragSnapshots.map((snapshot) => snapshot.id);
    for (const id of ids) {
      const node = store.getNode(id);
      if (!node) continue;
      const patch: Partial<Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>> = {
        width: Math.max(1, Math.round(node.width)),
        height: Math.max(1, Math.round(node.height)),
      };
      if (mode !== 'resize') {
        patch.x = Math.round(node.x);
        patch.y = Math.round(node.y);
      }
      store.applyGeometry(node, patch);
    }
  };

  const finish = (event: PointerEvent): void => {
    if (pointerId !== event.pointerId) return;
    if (mode === 'create') commitCreate();
    if ((mode === 'drag' && didMove) || mode === 'resize') {
      roundGestureNodes();
      store.endGesture();
    } else store.cancelGesture();
    if (mode === 'pan') scene.classList.remove('is-panning');
    mode = 'idle';
    pointerId = null;
    dragSnapshots = [];
    dragKind = 'freeform';
    marqueeBaseIds = [];
    resizeSnapshot = null;
    activeHandle = null;
    if (scene.hasPointerCapture(event.pointerId)) scene.releasePointerCapture(event.pointerId);
    updateCursor(scene, event);
    emit();
  };

  window.addEventListener('pointermove', (event) => {
    if (pointerId !== event.pointerId) {
      if (event.target instanceof Node && scene.contains(event.target)) updateCursor(scene, event);
      return;
    }
    const rect = scene.getBoundingClientRect();
    const world = screenToWorld(event.clientX, event.clientY, rect);
    if (Math.hypot(event.clientX - pointerStartScreen.x, event.clientY - pointerStartScreen.y) > DRAG_THRESHOLD) didMove = true;

    if (mode === 'pan') {
      setCamera({ panX: panX + event.clientX - lastScreen.x, panY: panY + event.clientY - lastScreen.y });
      lastScreen = { x: event.clientX, y: event.clientY };
      emit();
      return;
    }
    if (mode === 'create') {
      createCurrent = world;
      emit();
      return;
    }
    if (mode === 'marquee') {
      marqueeCurrent = world;
      const hits = intersectingNodes(
        Math.min(marqueeStart.x, world.x),
        Math.min(marqueeStart.y, world.y),
        Math.max(marqueeStart.x, world.x),
        Math.max(marqueeStart.y, world.y),
      );
      store.selectMany(marqueeBaseIds.length ? [...marqueeBaseIds, ...hits] : hits);
      emit();
      return;
    }
    if (mode === 'resize') {
      applyLiveResize(world.x, world.y, event.shiftKey);
      return;
    }
    if (mode === 'drag' && didMove && dragSnapshots.length) {
      if (!store.isGesturing()) store.beginGesture();
      let dx = world.x - pointerStartWorld.x;
      let dy = world.y - pointerStartWorld.y;
      if (event.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const nodes = dragSnapshots.map((snapshot) => store.getNode(snapshot.id)).filter((node): node is DesignNode => !!node);
      const sharedParent = nodes[0] ? flexParentOf(nodes[0]) : undefined;
      const allFlexSiblings = !!sharedParent && nodes.every((node) => flexParentOf(node)?.id === sharedParent.id);

      if (event.altKey) {
        dragKind = 'detach';
        dragSnapshots.forEach((snapshot, index) => {
          const node = nodes[index];
          if (!node) return;
          if (flexParentOf(node)) store.detachFromFlow(node.id, snapshot.worldX + dx, snapshot.worldY + dy);
          else {
            const freeform = !node.parentId;
            store.applyGeometry(node, {
              x: (freeform ? snapshot.worldX : snapshot.x) + dx,
              y: (freeform ? snapshot.worldY : snapshot.y) + dy,
            });
          }
        });
      } else if (allFlexSiblings && sharedParent) {
        dragKind = 'reorder';
        const draggedIds = nodes.map((node) => node.id);
        let index = insertionIndex(sharedParent, draggedIds, world.x, world.y);
        for (const id of draggedIds) {
          store.reorderChild(sharedParent.id, id, index);
          index += 1;
        }
      } else {
        dragKind = 'freeform';
        for (const snapshot of dragSnapshots) {
          const node = store.getNode(snapshot.id);
          if (node) store.applyGeometry(node, { x: snapshot.x + dx, y: snapshot.y + dy });
        }
      }
      store.notify();
    }
    updateCursor(scene, event);
  });
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}
