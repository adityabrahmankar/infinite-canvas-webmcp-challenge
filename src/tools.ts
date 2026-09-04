import { store } from './store';
import { clearExportResults, exportDesign, parseProject, serializeSvg, svgToPng } from './exporter';
import type { DesignNode, LayoutMode, NodeKind, NodeStyle, SetLayoutInput, SizingMode, ToolResult, TreeNodeInput } from './types';

const operationResults = new Map<string, unknown>();
const MAX_REFERENCE_DATA_URL_LENGTH = 2_000_000;

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const asText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export function parseFlexibleNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const match = trimmed.match(/^-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function parseForgivingStyle(rawInput: unknown): NodeStyle {
  if (!rawInput || typeof rawInput !== 'object') return {};
  const record = rawInput as Record<string, unknown>;
  const raw: Record<string, unknown> = { ...record };
  if (record.style && typeof record.style === 'object') {
    Object.assign(raw, record.style as Record<string, unknown>);
  }
  if (record.styles && typeof record.styles === 'object') {
    Object.assign(raw, record.styles as Record<string, unknown>);
  }
  const style: NodeStyle = {};

  const bg = raw.background ?? raw.backgroundColor ?? raw.background_color ?? raw.bg ?? raw.fill;
  if (typeof bg === 'string' && bg.trim()) {
    style.background = bg.trim();
  }

  const color = raw.color ?? raw.textColor ?? raw.text_color ?? raw.fontColor ?? raw.font_color;
  if (typeof color === 'string' && color.trim()) {
    style.color = color.trim();
  }

  if (typeof raw.border === 'string' && raw.border.trim()) {
    style.border = raw.border.trim();
  } else if (raw.borderColor || raw.border_color || raw.borderWidth || raw.border_width || raw.borderStyle || raw.border_style) {
    const rawWidth = raw.borderWidth ?? raw.border_width;
    let widthNum = 1;
    const parsedWidth = parseFlexibleNumber(rawWidth);
    if (parsedWidth !== undefined) widthNum = Math.max(0, parsedWidth);
    const borderStyle = typeof (raw.borderStyle ?? raw.border_style) === 'string' && String(raw.borderStyle ?? raw.border_style).trim()
      ? String(raw.borderStyle ?? raw.border_style).trim()
      : 'solid';
    const borderColor = typeof (raw.borderColor ?? raw.border_color) === 'string' && String(raw.borderColor ?? raw.border_color).trim()
      ? String(raw.borderColor ?? raw.border_color).trim()
      : '#e2e8f0';
    style.border = `${widthNum}px ${borderStyle} ${borderColor}`;
  }

  const br = parseFlexibleNumber(raw.borderRadius ?? raw.border_radius ?? raw.rounded ?? raw.radius ?? raw.corner_radius ?? raw.cornerRadius);
  if (br !== undefined) {
    style.borderRadius = Math.max(0, br);
  }

  const ff = raw.fontFamily ?? raw.font_family ?? raw.font;
  if (typeof ff === 'string' && ff.trim()) {
    style.fontFamily = ff.trim();
  }

  const fs = parseFlexibleNumber(raw.fontSize ?? raw.font_size ?? raw.size);
  if (fs !== undefined) {
    style.fontSize = Math.max(6, fs);
  }

  const fw = raw.fontWeight ?? raw.font_weight ?? raw.weight;
  if (typeof fw === 'number' && Number.isFinite(fw)) {
    style.fontWeight = fw;
  } else if (typeof fw === 'string') {
    const lower = fw.toLowerCase().trim();
    if (lower === 'bold') style.fontWeight = 700;
    else if (lower === 'semibold' || lower === 'semi-bold') style.fontWeight = 600;
    else if (lower === 'medium') style.fontWeight = 500;
    else if (lower === 'regular' || lower === 'normal') style.fontWeight = 400;
    else if (lower === 'light') style.fontWeight = 300;
    else if (lower === 'extrabold' || lower === 'extra-bold') style.fontWeight = 800;
    else if (lower === 'black') style.fontWeight = 900;
    else {
      const parsedWeight = parseFlexibleNumber(lower);
      if (parsedWeight !== undefined) style.fontWeight = parsedWeight;
    }
  }

  const pad = parseFlexibleNumber(raw.padding);
  if (pad !== undefined) {
    style.padding = Math.max(0, pad);
  }

  const op = raw.opacity;
  if (typeof op === 'number' && Number.isFinite(op)) {
    style.opacity = op > 1 && op <= 100 ? op / 100 : Math.max(0, Math.min(1, op));
  } else if (typeof op === 'string') {
    const trimmed = op.trim();
    if (trimmed.endsWith('%')) {
      const pct = Number(trimmed.slice(0, -1));
      if (Number.isFinite(pct)) style.opacity = Math.max(0, Math.min(1, pct / 100));
    } else {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        style.opacity = parsed > 1 && parsed <= 100 ? parsed / 100 : Math.max(0, Math.min(1, parsed));
      }
    }
  }

  const ls = raw.letterSpacing ?? raw.letter_spacing ?? raw.tracking;
  if (typeof ls === 'string' && ls.trim()) {
    const trimmed = ls.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      style.letterSpacing = Math.abs(num) < 1 ? `${num}em` : `${num}px`;
    } else {
      style.letterSpacing = trimmed;
    }
  } else if (typeof ls === 'number' && Number.isFinite(ls)) {
    style.letterSpacing = Math.abs(ls) < 1 ? `${ls}em` : `${ls}px`;
  }

  return style;
}

export function resetDocument(): void {
  operationResults.clear();
  clearExportResults();
  store.reset();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('canvas:reset'));
}

export function inspectCanvas(): Record<string, unknown> {
  const selected = store.getNode(store.selectedId);
  const selectedBounds = selected ? store.resolvedBounds(selected) : null;
  return {
    selected: selected ? { id: selected.id, name: selected.name, kind: selected.kind, width: selectedBounds?.width, height: selectedBounds?.height } : null,
    selectedIds: [...store.selectedIds],
    revision: store.revision,
    artboards: store.rootIds.map((id) => store.getNode(id)).filter((node): node is DesignNode => !!node && node.kind === 'frame').map((node) => ({ id: node.id, name: node.name, width: node.width, height: node.height })),
    references: store.referenceNodes().map((node) => ({ referenceId: node.referenceId ?? node.id, name: node.name, width: node.width, height: node.height })),
    nextActions: ['get_design_tree', 'find_nodes', 'create_tree', 'create_node', 'set_layout', 'delete_nodes', 'move_nodes', 'set_design_text', 'apply_design_styles', 'capture_preview', 'export_design'],
  };
}

export function getDesignTree(args: Record<string, unknown> = {}): Record<string, unknown> {
  const rootId = asText(args.rootNodeId || args.nodeId || args.id) || store.selectedId || store.rootIds[0] || '';
  const root = store.getNode(rootId);
  if (!root) {
    if (!store.rootIds.length) throw new Error('No artboard found on canvas.');
    throw new Error(`Design node not found: ${rootId}`);
  }
  const parsedMaxDepth = parseFlexibleNumber(args.maxDepth);
  const maxDepth = parsedMaxDepth !== undefined ? Math.max(0, parsedMaxDepth) : undefined;
  const isSummary = args.summary === true;

  const visit = (node: DesignNode, depth: number): Record<string, unknown> => {
    const bounds = store.resolvedBounds(node);
    const reachedMax = maxDepth !== undefined && depth >= maxDepth;
    const childrenNodes = reachedMax ? [] : node.children.map((id) => store.getNode(id)).filter((child): child is DesignNode => !!child);

    if (isSummary) {
      return {
        id: node.id,
        name: node.name,
        kind: node.kind,
        childCount: node.children.length,
        ...(node.text ? { text: node.text.length > 80 ? `${node.text.slice(0, 80)}…` : node.text } : {}),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        ...(node.layout ? { layout: node.layout } : {}),
        ...(childrenNodes.length > 0 ? { children: childrenNodes.map((child) => visit(child, depth + 1)) } : {}),
      };
    }

    return {
      id: node.id,
      name: node.name,
      kind: node.kind,
      text: node.text,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      style: node.style,
      referenceId: node.referenceId,
      imageAvailable: node.kind === 'image' ? !!node.imageSrc : undefined,
      layout: node.layout,
      gap: node.gap,
      widthSizing: node.widthSizing,
      heightSizing: node.heightSizing,
      childCount: node.children.length,
      children: childrenNodes.map((child) => visit(child, depth + 1)),
    };
  };
  return { root: visit(root, 0), revision: store.revision };
}

export function findNodes(args: Record<string, unknown> = {}): Record<string, unknown> {
  const query = asText(args.query).toLowerCase();
  const kind = asText(args.kind).toLowerCase();
  const parentId = asText(args.parentId);
  const parsedLimit = parseFlexibleNumber(args.limit);
  const limit = Math.max(1, Math.min(100, parsedLimit !== undefined ? parsedLimit : 25));

  const results: Array<Record<string, unknown>> = [];
  for (const node of store.nodes.values()) {
    if (kind && node.kind.toLowerCase() !== kind) continue;
    if (parentId && node.parentId !== parentId) continue;
    if (query) {
      const matchName = node.name.toLowerCase().includes(query);
      const matchId = node.id.toLowerCase().includes(query);
      const matchText = node.text ? node.text.toLowerCase().includes(query) : false;
      if (!matchName && !matchId && !matchText) continue;
    }
    const bounds = store.resolvedBounds(node);
    results.push({
      id: node.id,
      name: node.name,
      kind: node.kind,
      parentId: node.parentId,
      text: node.text,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      layout: node.layout,
      childCount: node.children.length,
      style: node.style,
    });
    if (results.length >= limit) break;
  }
  return { count: results.length, nodes: results, revision: store.revision };
}

export function setDesignText(args: Record<string, unknown> = {}): Record<string, unknown> {
  const id = asText(args.nodeId) || store.selectedId || '';
  const node = store.updateText(id, asText(args.text));
  return { id: node.id, text: node.text, revision: store.revision };
}

export function applyDesignStyles(args: Record<string, unknown> = {}): Record<string, unknown> {
  const id = asText(args.nodeId) || store.selectedId || '';
  const raw = (args.styles && typeof args.styles === 'object' ? args.styles : args) as Record<string, unknown>;
  const patch = parseForgivingStyle(raw);
  const node = store.updateStyle(id, patch);
  return { id: node.id, style: node.style, revision: store.revision };
}

function referenceDataUrl(args: Record<string, unknown>): string {
  const dataUrl = asText(args.dataUrl);
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) throw new Error('Reference images must be provided as a base64 data URL from a local image or clipboard.');
  if (dataUrl.length > MAX_REFERENCE_DATA_URL_LENGTH) throw new Error('Reference image is too large. Keep pasted images under 2 MB.');
  return dataUrl;
}

export function addReferenceImage(args: Record<string, unknown> = {}): Record<string, unknown> {
  const operationId = asText(args.operationId);
  if (operationId && operationResults.has(`reference:${operationId}`)) return copy(operationResults.get(`reference:${operationId}`) as Record<string, unknown>);
  const dataUrl = referenceDataUrl(args);
  const references = store.referenceNodes();
  const number = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : fallback;
  };
  const width = Math.min(720, number(args.width, 420));
  const height = Math.min(560, number(args.height, 280));
  const x = Number.isFinite(Number(args.x)) ? Number(args.x) : 960 + (references.length % 2) * 40;
  const y = Number.isFinite(Number(args.y)) ? Number(args.y) : 120 + Math.floor(references.length / 2) * 320;
  const name = asText(args.name) || `Reference image ${references.length + 1}`;
  const node = store.addReferenceImage({ name, dataUrl, width, height, x, y });
  store.select(node.id);
  const result = { referenceId: node.id, name: node.name, width: node.width, height: node.height, x: node.x, y: node.y, revision: store.revision };
  if (operationId) operationResults.set(`reference:${operationId}`, result);
  return result;
}

export function listReferenceImages(): Record<string, unknown> {
  return {
    revision: store.revision,
    references: store.referenceNodes().map((node) => ({
      referenceId: node.referenceId ?? node.id,
      name: node.name,
      width: node.width,
      height: node.height,
      x: node.x,
      y: node.y,
      imageAvailable: !!node.imageSrc,
    })),
    nextActions: ['inspect_reference_image', 'recreate_from_reference'],
  };
}

export function inspectReferenceImage(args: Record<string, unknown> = {}): Record<string, unknown> {
  const id = asText(args.referenceId);
  const node = store.referenceNodes().find((candidate) => (candidate.referenceId ?? candidate.id) === id);
  if (!node || !node.imageSrc) throw new Error(`Reference image not found: ${id}`);
  return { referenceId: node.referenceId ?? node.id, name: node.name, width: node.width, height: node.height, x: node.x, y: node.y, dataUrl: node.imageSrc };
}

export function recreateFromReference(args: Record<string, unknown> = {}): Record<string, unknown> {
  const operationId = asText(args.operationId);
  if (operationId && operationResults.has(`recreate:${operationId}`)) return copy(operationResults.get(`recreate:${operationId}`) as Record<string, unknown>);
  const referenceId = asText(args.referenceId);
  const reference = store.referenceNodes().find((candidate) => (candidate.referenceId ?? candidate.id) === referenceId);
  if (!reference) throw new Error(`Reference image not found: ${referenceId}`);
  const recreation = store.createEditableRecreation(reference.id, asText(args.name), args);
  store.select(recreation.id);
  const result = { referenceId, recreationNodeId: recreation.id, name: recreation.name, width: recreation.width, height: recreation.height, revision: store.revision };
  if (operationId) operationResults.set(`recreate:${operationId}`, result);
  return result;
}

export function undoDocument(): Record<string, unknown> {
  const snapshot = store.undo();
  return { undone: true, revision: snapshot.revision, selectedId: snapshot.selectedId, canUndo: store.canUndo(), canRedo: store.canRedo() };
}

export function redoDocument(): Record<string, unknown> {
  const snapshot = store.redo();
  return { redone: true, revision: snapshot.revision, selectedId: snapshot.selectedId, canUndo: store.canUndo(), canRedo: store.canRedo() };
}

export function createNode(args: Record<string, unknown> = {}): Record<string, unknown> {
  const kind = asText(args.kind).toLowerCase() as DesignNode['kind'];
  if (!['frame', 'text', 'rect', 'button'].includes(kind)) throw new Error('kind must be frame, text, rect, or button.');
  const parentId = asText(args.parentId) || null;
  const parsedX = parseFlexibleNumber(args.x);
  const parsedY = parseFlexibleNumber(args.y);
  const parsedW = parseFlexibleNumber(args.width);
  const parsedH = parseFlexibleNumber(args.height);
  const parsedGap = parseFlexibleNumber(args.gap);
  const parsedPadding = parseFlexibleNumber(args.padding);

  const rawLayout = asText(args.layout) as LayoutMode;
  const layout = ['absolute', 'flex-row', 'flex-column'].includes(rawLayout) ? rawLayout : undefined;
  const rawWidthSizing = asText(args.widthSizing).toLowerCase() as SizingMode;
  const widthSizing = ['fixed', 'fill', 'hug'].includes(rawWidthSizing) ? rawWidthSizing : undefined;
  const rawHeightSizing = asText(args.heightSizing).toLowerCase() as SizingMode;
  const heightSizing = ['fixed', 'fill', 'hug'].includes(rawHeightSizing) ? rawHeightSizing : undefined;

  const rawStyle = (args.style && typeof args.style === 'object' ? args.style : (args.styles && typeof args.styles === 'object' ? args.styles : args)) as Record<string, unknown>;
  const style = parseForgivingStyle(rawStyle);
  if (args.styles && typeof args.styles === 'object' && rawStyle !== args.styles) {
    Object.assign(style, parseForgivingStyle(args.styles as Record<string, unknown>));
  }

  const node = store.createNode({
    kind,
    parentId,
    x: parsedX !== undefined ? parsedX : 80,
    y: parsedY !== undefined ? parsedY : 80,
    width: Math.max(1, parsedW !== undefined ? parsedW : (kind === 'frame' ? 320 : kind === 'rect' ? 200 : kind === 'button' ? 140 : 180)),
    height: Math.max(1, parsedH !== undefined ? parsedH : (kind === 'frame' ? 240 : kind === 'rect' ? 140 : 36)),
    name: asText(args.name) || undefined,
    text: args.text === undefined ? undefined : asText(args.text),
    style,
    layout,
    gap: parsedGap !== undefined ? Math.max(0, parsedGap) : undefined,
    padding: parsedPadding !== undefined ? Math.max(0, parsedPadding) : style.padding,
    widthSizing,
    heightSizing,
  });
  return {
    id: node.id,
    name: node.name,
    kind: node.kind,
    parentId: node.parentId,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    layout: node.layout,
    widthSizing: node.widthSizing,
    heightSizing: node.heightSizing,
    revision: store.revision,
  };
}

function normalizeTreeNodeInput(input: Record<string, unknown>, depth = 0): TreeNodeInput {
  const kind = (asText(input.kind).toLowerCase() || 'frame') as NodeKind;
  const rawLayout = asText(input.layout) as LayoutMode;
  const layout = ['absolute', 'flex-row', 'flex-column'].includes(rawLayout) ? rawLayout : undefined;
  const rawWidthSizing = asText(input.widthSizing).toLowerCase() as SizingMode;
  const widthSizing = ['fixed', 'fill', 'hug'].includes(rawWidthSizing) ? rawWidthSizing : undefined;
  const rawHeightSizing = asText(input.heightSizing).toLowerCase() as SizingMode;
  const heightSizing = ['fixed', 'fill', 'hug'].includes(rawHeightSizing) ? rawHeightSizing : undefined;

  const rawStyle = (input.style && typeof input.style === 'object' ? input.style : (input.styles && typeof input.styles === 'object' ? input.styles : input)) as Record<string, unknown>;
  const style = parseForgivingStyle(rawStyle);
  if (input.styles && typeof input.styles === 'object' && rawStyle !== input.styles) {
    Object.assign(style, parseForgivingStyle(input.styles as Record<string, unknown>));
  }

  const rawChildren = depth < 20 && Array.isArray(input.children) ? input.children : [];
  const children = rawChildren
    .map((c) => (c && typeof c === 'object' ? normalizeTreeNodeInput(c as Record<string, unknown>, depth + 1) : null))
    .filter((c): c is TreeNodeInput => !!c);

  const parentId = input.parentId !== undefined ? (asText(input.parentId) || null) : undefined;
  const parsedX = parseFlexibleNumber(input.x);
  const parsedY = parseFlexibleNumber(input.y);
  const parsedW = parseFlexibleNumber(input.width);
  const parsedH = parseFlexibleNumber(input.height);
  const parsedGap = parseFlexibleNumber(input.gap);
  const parsedPadding = parseFlexibleNumber(input.padding);

  return {
    parentId,
    kind,
    name: asText(input.name) || undefined,
    text: input.text !== undefined ? asText(input.text) : undefined,
    x: parsedX,
    y: parsedY,
    width: parsedW,
    height: parsedH,
    layout,
    gap: parsedGap !== undefined ? Math.max(0, parsedGap) : undefined,
    padding: parsedPadding !== undefined ? Math.max(0, parsedPadding) : style.padding,
    widthSizing,
    heightSizing,
    style,
    children: children.length > 0 ? children : undefined,
  };
}

export function createTree(args: Record<string, unknown> = {}): Record<string, unknown> {
  const rawTree = (args.tree && typeof args.tree === 'object' ? args.tree : (args.root && typeof args.root === 'object' ? args.root : args)) as Record<string, unknown>;
  const treeInput = normalizeTreeNodeInput(rawTree);
  const parentId = asText(args.parentId) || treeInput.parentId || null;
  const root = store.createTree(treeInput, parentId);
  const createdNodeIds: string[] = [];
  const collect = (node: DesignNode) => {
    createdNodeIds.push(node.id);
    for (const childId of node.children) {
      const child = store.getNode(childId);
      if (child) collect(child);
    }
  };
  collect(root);
  return {
    id: root.id,
    rootNodeId: root.id,
    name: root.name,
    kind: root.kind,
    parentId: root.parentId,
    layout: root.layout,
    childCount: root.children.length,
    nodeCount: createdNodeIds.length,
    createdNodeIds,
    revision: store.revision,
  };
}

export function setLayout(args: Record<string, unknown> = {}): Record<string, unknown> {
  const id = asText(args.nodeId) || store.selectedId || '';
  const rawLayout = asText(args.layout) as LayoutMode;
  const layout = ['absolute', 'flex-row', 'flex-column'].includes(rawLayout) ? rawLayout : undefined;
  const parsedGap = parseFlexibleNumber(args.gap);
  const gap = parsedGap !== undefined ? Math.max(0, parsedGap) : undefined;
  const parsedPadding = parseFlexibleNumber(args.padding);
  const padding = parsedPadding !== undefined ? Math.max(0, parsedPadding) : undefined;
  const rawWidthSizing = asText(args.widthSizing).toLowerCase() as SizingMode;
  const widthSizing = ['fixed', 'fill', 'hug'].includes(rawWidthSizing) ? rawWidthSizing : undefined;
  const rawHeightSizing = asText(args.heightSizing).toLowerCase() as SizingMode;
  const heightSizing = ['fixed', 'fill', 'hug'].includes(rawHeightSizing) ? rawHeightSizing : undefined;

  const node = store.setLayout(id, { layout, gap, padding, widthSizing, heightSizing });
  return {
    id: node.id,
    name: node.name,
    layout: node.layout,
    gap: node.gap,
    padding: node.style.padding,
    widthSizing: node.widthSizing,
    heightSizing: node.heightSizing,
    revision: store.revision,
  };
}

export async function capturePreview(args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const targetId = asText(args.nodeId) || store.selectedId || store.rootIds[0] || '';
  const node = store.getNode(targetId);
  if (!node) throw new Error(`Design node not found: ${targetId}`);
  const bounds = store.resolvedBounds(node);
  const width = Math.max(1, Math.round(bounds.width || node.width));
  const height = Math.max(1, Math.round(bounds.height || node.height));
  const parsedScale = parseFlexibleNumber(args.scale);
  const scale = Math.min(3, Math.max(1, parsedScale !== undefined ? parsedScale : 1));
  const format = asText(args.format) === 'svg' ? 'svg' : 'png';

  const svg = serializeSvg(node);
  const dataUrl = format === 'svg'
    ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
    : await svgToPng(svg, width, height, scale);

  return {
    nodeId: node.id,
    name: node.name,
    format,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    dataUrl,
    previewAvailable: Boolean(dataUrl),
    revision: store.revision,
  };
}

export function deleteNodes(args: Record<string, unknown> = {}): Record<string, unknown> {
  const ids = Array.isArray(args.nodeIds) ? args.nodeIds.map(asText).filter(Boolean) : (asText(args.nodeId) ? [asText(args.nodeId)] : [...store.selectedIds]);
  if (!ids.length) throw new Error('Select one or more layers to delete.');
  const removed = store.deleteNodes(ids);
  return { deleted: removed, selectedIds: [...store.selectedIds], revision: store.revision };
}

export function moveNodes(args: Record<string, unknown> = {}): Record<string, unknown> {
  const ids = Array.isArray(args.nodeIds) ? args.nodeIds.map(asText).filter(Boolean) : (asText(args.nodeId) ? [asText(args.nodeId)] : [...store.selectedIds]);
  if (!ids.length) throw new Error('Select one or more layers to move.');
  const dx = parseFlexibleNumber(args.dx) ?? 0;
  const dy = parseFlexibleNumber(args.dy) ?? 0;
  const moved = store.moveNodes(ids, dx, dy);
  return { moved: moved.map((node) => ({ id: node.id, x: node.x, y: node.y })), revision: store.revision };
}

export function resizeNode(args: Record<string, unknown> = {}): Record<string, unknown> {
  const id = asText(args.nodeId) || store.selectedId || '';
  const node = store.getNode(id);
  if (!node) throw new Error(`Design node not found: ${id}`);
  const patch: Partial<Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>> = {};
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (args[key] !== undefined) {
      const value = parseFlexibleNumber(args[key]);
      if (value === undefined) throw new Error(`Invalid ${key}.`);
      patch[key] = value;
    }
  }
  const updated = store.updateGeometry(id, patch);
  return { id: updated.id, x: updated.x, y: updated.y, width: updated.width, height: updated.height, revision: store.revision };
}

export function selectNodes(args: Record<string, unknown> = {}): Record<string, unknown> {
  const ids = Array.isArray(args.nodeIds) ? args.nodeIds.map(asText).filter(Boolean) : (asText(args.nodeId) ? [asText(args.nodeId)] : []);
  store.selectMany(ids);
  return { selectedIds: [...store.selectedIds], selectedId: store.selectedId };
}

export function importProject(args: Record<string, unknown> = {}): Record<string, unknown> {
  const operationId = asText(args.operationId);
  if (operationId && operationResults.has(`import:${operationId}`)) return copy(operationResults.get(`import:${operationId}`) as Record<string, unknown>);
  const raw = typeof args.projectJson === 'string' ? args.projectJson : typeof args.data === 'string' ? args.data : '';
  if (!raw) throw new Error('Provide a project JSON file to import.');
  const snapshot = parseProject(raw);
  store.restoreSnapshot(snapshot, { clearHistory: true });
  clearExportResults();
  const result = {
    imported: true,
    format: 'infinite-canvas.project',
    version: 1,
    nodeCount: snapshot.nodes.length,
    rootCount: snapshot.rootIds.length,
    revision: store.revision,
    selectedId: store.selectedId,
  };
  if (operationId) operationResults.set(`import:${operationId}`, result);
  return result;
}

export async function handleChallengeTool(name: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ToolResult> {
  try {
    let value: unknown;
    switch (name) {
      case 'inspect_canvas': value = inspectCanvas(); break;
      case 'get_design_tree': value = getDesignTree(args); break;
      case 'find_nodes': value = findNodes(args); break;
      case 'set_design_text': value = setDesignText(args); break;
      case 'apply_design_styles': value = applyDesignStyles(args); break;
      case 'set_layout': value = setLayout(args); break;
      case 'add_reference_image': value = addReferenceImage(args); break;
      case 'list_reference_images': value = listReferenceImages(); break;
      case 'inspect_reference_image': value = inspectReferenceImage(args); break;
      case 'recreate_from_reference': value = recreateFromReference(args); break;
      case 'create_node': value = createNode(args); break;
      case 'create_tree':
      case 'create_component': value = createTree(args); break;
      case 'delete_nodes': value = deleteNodes(args); break;
      case 'move_nodes': value = moveNodes(args); break;
      case 'resize_node': value = resizeNode(args); break;
      case 'select_nodes': value = selectNodes(args); break;
      case 'capture_preview': value = await capturePreview(args); break;
      case 'undo_document': value = undoDocument(); break;
      case 'redo_document': value = redoDocument(); break;
      case 'import_project': value = importProject(args); break;
      case 'export_design': value = await exportDesign(args, signal); break;
      case 'reset_document':
      case 'reset_challenge': resetDocument(); value = { reset: true }; break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    if (name === 'export_design') {
      const artifact = value as Record<string, unknown>;
      const { data: _data, ...metadata } = artifact;
      return { structuredContent: metadata, content: [{ type: 'text', text: JSON.stringify(metadata) }] };
    }
    if (name === 'inspect_reference_image') {
      const inspected = value as Record<string, unknown>;
      const dataUrl = typeof inspected.dataUrl === 'string' ? inspected.dataUrl : '';
      const { dataUrl: _dataUrl, ...metadata } = inspected;
      const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
      return {
        structuredContent: { ...metadata, imageAvailable: !!match },
        content: [
          { type: 'text', text: JSON.stringify({ ...metadata, imageAvailable: !!match }) },
          ...(match ? [{ type: 'image' as const, data: match[2], mimeType: match[1] }] : []),
        ],
      };
    }
    if (name === 'capture_preview') {
      const inspected = value as Record<string, unknown>;
      const dataUrl = typeof inspected.dataUrl === 'string' ? inspected.dataUrl : '';
      const { dataUrl: _dataUrl, ...metadata } = inspected;
      const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
      return {
        structuredContent: inspected,
        content: [
          { type: 'text', text: JSON.stringify({ ...metadata, previewAvailable: !!dataUrl }) },
          ...(match ? [{ type: 'image' as const, data: match[2], mimeType: match[1] }] : []),
        ],
      };
    }
    return { structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
}
