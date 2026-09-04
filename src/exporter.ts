import { borderWidthOf, htmlLayoutDeclarations } from './layout';
import { store } from './store';
import type { DesignNode, DocumentSnapshot, ExportArtifact, ExportFormat, NodeStyle } from './types';

export const PROJECT_FORMAT = 'infinite-canvas.project';
export const PROJECT_VERSION = 1;
const MAX_PROJECT_NODES = 500;
const MAX_NODE_DIMENSION = 4_000;
const MAX_PROJECT_BYTES = 8_000_000;
const MAX_TEXT_LENGTH = 10_000;
const MAX_IMAGE_DATA_URL_LENGTH = 2_000_000;

const exportResults = new Map<string, ExportArtifact>();

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const asText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function checksum(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return value.length;
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeHtml(value: unknown): string {
  return escapeXml(value);
}

function safeCss(value: unknown, fallback = ''): string {
  const candidate = asText(value);
  return candidate && /^[#a-z0-9(),.%\s+/_-]+$/i.test(candidate) ? candidate : fallback;
}

function safeNumber(value: unknown, fallback: number, min = -10_000, max = 10_000): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function dimensions(node: DesignNode): { width: number; height: number } {
  const width = Math.round(safeNumber(node.width, 1, 1, MAX_NODE_DIMENSION));
  const height = Math.round(safeNumber(node.height, 1, 1, MAX_NODE_DIMENSION));
  return { width, height };
}

function visible(node: DesignNode | undefined): node is DesignNode {
  return !!node && !node.hidden;
}

function childrenOf(node: DesignNode): DesignNode[] {
  return node.children.map((id) => store.getNode(id)).filter(visible);
}

function rootFor(nodeId?: string): DesignNode {
  const requested = store.getNode(asText(nodeId) || store.selectedId);
  if (!requested) throw new Error('Select a visible artboard before exporting.');
  let root = requested;
  while (root.parentId) {
    const parent = store.getNode(root.parentId);
    if (!parent) break;
    root = parent;
  }
  if (!visible(root)) throw new Error('Only visible design content can be exported.');
  if (root.kind !== 'frame' && root.kind !== 'image') throw new Error('Export requires an artboard or image root.');
  const { width, height } = dimensions(root);
  if (width > MAX_NODE_DIMENSION || height > MAX_NODE_DIMENSION) throw new Error('The selected artboard is too large to export.');
  return root;
}

function borderParts(border: string | undefined): { width: number; color: string } | null {
  const value = safeCss(border);
  if (!value || value.toLowerCase() === 'none') return null;
  const width = Number(value.match(/(\d+(?:\.\d+)?)px/i)?.[1] ?? 1);
  const color = value.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i)?.[1] ?? '#000000';
  return { width: Number.isFinite(width) ? Math.max(0, width) : 1, color: safeCss(color, '#000000') };
}

function nodeText(node: DesignNode): string {
  return typeof node.text === 'string' ? node.text.slice(0, MAX_TEXT_LENGTH) : '';
}

function renderSvgText(node: DesignNode, centered = false): string {
  const box = store.resolvedBounds(node);
  const width = Math.round(safeNumber(box.width, 1, 1, MAX_NODE_DIMENSION));
  const height = Math.round(safeNumber(box.height, 1, 1, MAX_NODE_DIMENSION));
  const style = node.style;
  const color = safeCss(style.color, '#f8fafc');
  const fontSize = safeNumber(style.fontSize, 14, 6, 144);
  const fontWeight = safeNumber(style.fontWeight, 400, 100, 900);
  const letterSpacing = safeCss(style.letterSpacing);
  const attrs = centered
    ? `x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle"`
    : 'x="0" y="0" dominant-baseline="hanging"';
  return `<text ${attrs} fill="${escapeXml(color)}" font-size="${fontSize}" font-weight="${fontWeight}"${letterSpacing ? ` letter-spacing="${escapeXml(letterSpacing)}"` : ''}>${escapeXml(nodeText(node))}</text>`;
}

function renderSvgNode(node: DesignNode, isRoot = false): string {
  const measured = store.resolvedBounds(node);
  const size = isRoot ? (node.parentId ? measured : dimensions(node)) : measured;
  const parent = node.parentId ? store.getNode(node.parentId) : undefined;
  const inset = !isRoot && parent ? borderWidthOf(parent) : 0;
  const width = Math.round(safeNumber(size.width, 1, 1, MAX_NODE_DIMENSION));
  const height = Math.round(safeNumber(size.height, 1, 1, MAX_NODE_DIMENSION));
  const x = Math.round(safeNumber(measured.x + inset, 0));
  const y = Math.round(safeNumber(measured.y + inset, 0));
  const style = node.style;
  const background = safeCss(style.background, 'transparent');
  const border = borderParts(style.border);
  const radius = Math.max(0, safeNumber(style.borderRadius, 0, 0, 500));
  const opacity = Math.min(1, Math.max(0, safeNumber(style.opacity, 1, 0, 1)));
  const transform = isRoot ? '' : ` transform="translate(${x} ${y})"`;
  const rect = node.kind === 'image'
    ? `<image href="${escapeXml(node.imageSrc ?? '')}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none"/>`
    : `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${escapeXml(background)}"${border ? ` stroke="${escapeXml(border.color)}" stroke-width="${border.width}"` : ''}/>`;
  const text = node.kind === 'text' ? renderSvgText(node) : (node.kind === 'button' || node.kind === 'rect') && nodeText(node) ? renderSvgText(node, true) : '';
  const content = `${rect}${text}${childrenOf(node).map((child) => renderSvgNode(child)).join('')}`;
  return `<g${transform}${opacity < 1 ? ` opacity="${opacity}"` : ''}>${content}</g>`;
}

export function serializeSvg(root: DesignNode): string {
  const measured = store.resolvedBounds(root);
  const size = root.parentId ? measured : dimensions(root);
  const width = Math.round(safeNumber(size.width, 1, 1, MAX_NODE_DIMENSION));
  const height = Math.round(safeNumber(size.height, 1, 1, MAX_NODE_DIMENSION));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${renderSvgNode(root, true)}</svg>`;
}

function htmlStyle(node: DesignNode, isRoot: boolean): string {
  const style = node.style;
  const parent = node.parentId ? store.getNode(node.parentId) : undefined;
  const declarations = [
    ...htmlLayoutDeclarations(node, parent, isRoot),
    `background:${safeCss(style.background, 'transparent')}`,
    `color:${safeCss(style.color, '#f8fafc')}`,
    `border:${safeCss(style.border, 'none')}`,
    `border-radius:${Math.max(0, safeNumber(style.borderRadius, 0, 0, 500))}px`,
    `opacity:${Math.min(1, Math.max(0, safeNumber(style.opacity, 1, 0, 1)))}`,
    style.fontFamily ? `font-family:"${safeCss(style.fontFamily)}",system-ui,sans-serif` : '',
    style.fontSize === undefined ? '' : `font-size:${safeNumber(style.fontSize, 14, 6, 144)}px`,
    `font-weight:${safeNumber(style.fontWeight, 400, 100, 900)}`,
    style.letterSpacing ? `letter-spacing:${safeCss(style.letterSpacing)}` : '',
    style.padding === undefined ? '' : `padding:${Math.max(0, safeNumber(style.padding, 0, 0, 500))}px`,
    node.kind === 'text' ? 'line-height:1.32;white-space:pre-wrap' : '',
    node.kind === 'button' ? 'align-items:center;justify-content:center;text-align:center;white-space:nowrap' : '',
    node.kind === 'rect' ? 'align-items:center;justify-content:center' : '',
    node.kind === 'button' || node.kind === 'rect' ? 'display:flex' : '',
    node.kind === 'image' ? 'overflow:hidden' : '',
  ];
  return declarations.filter(Boolean).join(';');
}

function renderHtmlNode(node: DesignNode, isRoot = false): string {
  const tag = node.kind === 'button' ? 'button' : isRoot ? 'main' : 'div';
  const attrs = `class="canvas-node node-${node.kind}" style="${escapeHtml(htmlStyle(node, isRoot))}" data-node-id="${escapeHtml(node.id)}"`;
  const content = node.kind === 'image'
    ? `<img src="${escapeHtml(node.imageSrc ?? '')}" alt="${escapeHtml(node.name)}" draggable="false" style="display:block;width:100%;height:100%;object-fit:cover"/>`
    : node.kind === 'text' || node.kind === 'button' || node.kind === 'rect' ? escapeHtml(nodeText(node) || (node.kind === 'button' ? node.name : '')) : '';
  return `<${tag} ${attrs}>${content}${childrenOf(node).map((child) => renderHtmlNode(child)).join('')}</${tag}>`;
}

export function serializeHtml(root: DesignNode): string {
  const { width, height } = dimensions(root);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(root.name)}</title><style>html,body{margin:0;min-height:100%;background:#fff;font-family:system-ui,-apple-system,sans-serif}.canvas-node{overflow:visible;user-select:none}.node-image img{display:block}</style></head><body><div style="width:${width}px;height:${height}px">${renderHtmlNode(root, true)}</div></body></html>`;
}

interface ExportProjectFile {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  revision: number;
  rootIds: string[];
  selectedId: string | null;
  selectedIds?: string[];
  nodes: DesignNode[];
  checksum?: string;
}

function visibleRoots(): DesignNode[] {
  return store.rootIds.map((id) => store.getNode(id)).filter(visible);
}

function collectVisible(root: DesignNode, output: DesignNode[]): void {
  if (!visible(root)) return;
  output.push(root);
  childrenOf(root).forEach((child) => collectVisible(child, output));
}

function projectFile(nodeId?: string, includeReferences = true): ExportProjectFile {
  const selectedRoot = nodeId ? rootFor(nodeId) : null;
  const roots = selectedRoot ? [selectedRoot] : visibleRoots();
  const references = includeReferences
    ? visibleRoots().filter((node) => node.kind === 'image' && node.referenceId && !roots.some((root) => root.id === node.id))
    : [];
  const allRoots = [...roots, ...references];
  const nodes: DesignNode[] = [];
  allRoots.forEach((root) => collectVisible(root, nodes));
  const includedIds = new Set(nodes.map((node) => node.id));
  const sanitizedNodes = nodes.map((node) => ({
    ...clone(node),
    parentId: node.parentId && includedIds.has(node.parentId) ? node.parentId : null,
    children: node.children.filter((childId) => includedIds.has(childId)),
    hidden: false,
  }));
  const selectedId = store.selectedId && includedIds.has(store.selectedId) ? store.selectedId : (selectedRoot?.id ?? allRoots[0]?.id ?? null);
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    revision: store.revision,
    rootIds: allRoots.map((root) => root.id),
    selectedId,
    selectedIds: store.selectedIds.filter((id) => includedIds.has(id)),
    nodes: sanitizedNodes,
  };
}

export function serializeProject(nodeId?: string, includeReferences = true): string {
  const file = projectFile(nodeId, includeReferences);
  const withoutChecksum = JSON.stringify(file, null, 2);
  const result = { ...file, checksum: checksum(withoutChecksum) };
  const serialized = JSON.stringify(result, null, 2);
  if (byteLength(serialized) > MAX_PROJECT_BYTES) throw new Error('Project export is too large. Remove some reference images and try again.');
  return serialized;
}

function validStyle(input: unknown): NodeStyle {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const style: NodeStyle = {};
  if (typeof raw.background === 'string') style.background = safeCss(raw.background, 'transparent');
  if (typeof raw.color === 'string') style.color = safeCss(raw.color, '#f8fafc');
  if (typeof raw.border === 'string') style.border = safeCss(raw.border, 'none');
  if (Number.isFinite(Number(raw.borderRadius))) style.borderRadius = Math.max(0, Math.min(500, Number(raw.borderRadius)));
  if (typeof raw.fontFamily === 'string') style.fontFamily = raw.fontFamily;
  if (Number.isFinite(Number(raw.fontSize))) style.fontSize = Math.max(6, Math.min(144, Number(raw.fontSize)));
  if (Number.isFinite(Number(raw.fontWeight))) style.fontWeight = Math.max(100, Math.min(900, Number(raw.fontWeight)));
  if (Number.isFinite(Number(raw.opacity))) style.opacity = Math.max(0, Math.min(1, Number(raw.opacity)));
  if (Number.isFinite(Number(raw.padding))) style.padding = Math.max(0, Math.min(500, Number(raw.padding)));
  if (typeof raw.letterSpacing === 'string') style.letterSpacing = safeCss(raw.letterSpacing);
  return style;
}

export function parseProject(input: string | Record<string, unknown>): DocumentSnapshot {
  let raw: Record<string, unknown>;
  try {
    raw = typeof input === 'string' ? JSON.parse(input) as Record<string, unknown> : input;
  } catch {
    throw new Error('That project file is not valid JSON.');
  }
  if (raw.format !== PROJECT_FORMAT || raw.version !== PROJECT_VERSION) throw new Error(`Unsupported project format. Expected ${PROJECT_FORMAT} v${PROJECT_VERSION}.`);
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0 || raw.nodes.length > MAX_PROJECT_NODES) throw new Error('Project file has an invalid node count.');
  const nodes = raw.nodes.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('Project file contains an invalid node.');
    const value = candidate as Record<string, unknown>;
    const id = asText(value.id);
    if (!id || id.length > 120) throw new Error('Project file contains an invalid node ID.');
    const kind = value.kind;
    if (!['frame', 'text', 'rect', 'button', 'image'].includes(String(kind))) throw new Error(`Unsupported node kind: ${String(kind)}`);
    const width = safeNumber(value.width, 0, 1, MAX_NODE_DIMENSION);
    const height = safeNumber(value.height, 0, 1, MAX_NODE_DIMENSION);
    if (!width || !height) throw new Error(`Node ${id} has invalid dimensions.`);
    const imageSrc = typeof value.imageSrc === 'string' ? value.imageSrc : undefined;
    if (imageSrc && (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(imageSrc) || imageSrc.length > MAX_IMAGE_DATA_URL_LENGTH)) throw new Error(`Node ${id} contains an unsafe or oversized image.`);
    const text = typeof value.text === 'string' ? value.text.slice(0, MAX_TEXT_LENGTH) : undefined;
    return {
      id,
      name: asText(value.name).slice(0, 200) || id,
      kind: kind as DesignNode['kind'],
      parentId: value.parentId === null || value.parentId === undefined ? null : asText(value.parentId),
      children: Array.isArray(value.children) ? value.children.map(asText).filter(Boolean) : [],
      x: safeNumber(value.x, 0),
      y: safeNumber(value.y, 0),
      width,
      height,
      ...(text === undefined ? {} : { text }),
      style: validStyle(value.style),
      hidden: false,
      locked: value.locked === true,
      ...(imageSrc ? { imageSrc } : {}),
      ...(typeof value.referenceId === 'string' ? { referenceId: value.referenceId.slice(0, 120) } : {}),
    } satisfies DesignNode;
  });
  const ids = new Set<string>();
  nodes.forEach((node) => {
    if (ids.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`);
    ids.add(node.id);
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  nodes.forEach((node) => {
    if (node.parentId && !byId.has(node.parentId)) throw new Error(`Missing parent for node ${node.id}.`);
    node.children.forEach((childId) => {
      const child = byId.get(childId);
      if (!child || child.parentId !== node.id) throw new Error(`Invalid child relationship for node ${node.id}.`);
    });
  });
  const rootIds = Array.isArray(raw.rootIds) ? raw.rootIds.map(asText).filter(Boolean) : [];
  if (!rootIds.length || rootIds.some((id) => !byId.has(id) || byId.get(id)?.parentId !== null)) throw new Error('Project file has invalid root nodes.');
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) throw new Error('Project file contains a cycle.');
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id)?.children.forEach(walk);
    visiting.delete(id);
    visited.add(id);
  };
  rootIds.forEach(walk);
  if (visited.size !== nodes.length) throw new Error('Project file contains unreachable nodes.');
  const selectedId = typeof raw.selectedId === 'string' && byId.has(raw.selectedId) ? raw.selectedId : rootIds[0];
  const selectedIds = Array.isArray(raw.selectedIds)
    ? raw.selectedIds.map(asText).filter((id) => byId.has(id))
    : (selectedId ? [selectedId] : []);
  const revision = Math.max(1, Math.round(safeNumber(raw.revision, 1, 1, Number.MAX_SAFE_INTEGER)));
  return { nodes, rootIds, selectedId, selectedIds, revision };
}

export async function svgToPng(svg: string, width: number, height: number, scale: number, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot create a PNG canvas.');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => reject(new DOMException('Export cancelled.', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      image.onload = () => { signal?.removeEventListener('abort', abort); resolve(); };
      image.onerror = () => { signal?.removeEventListener('abort', abort); reject(new Error('The SVG could not be rendered as PNG.')); };
      image.src = url;
    });
    throwIfAborted(signal);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function formatFrom(value: unknown): ExportFormat {
  const format = asText(value) || 'svg';
  if (!['png', 'svg', 'html', 'json'].includes(format)) throw new Error('Choose PNG, SVG, HTML, or JSON export.');
  return format as ExportFormat;
}

function filenameFor(root: DesignNode, format: ExportFormat, requested: unknown): string {
  const requestedName = asText(requested).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  const base = (requestedName || root.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'infinite-canvas-design').replace(/\.(png|svg|html|json)$/i, '');
  return `${base}.${format}`;
}

function announce(artifact: ExportArtifact): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('canvas:export-ready', { detail: clone(artifact) }));
}

export async function exportDesign(args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ExportArtifact> {
  const format = formatFrom(args.format);
  const operationId = asText(args.operationId);
  if (operationId && exportResults.has(operationId)) return clone(exportResults.get(operationId)!);
  const root = rootFor(asText(args.nodeId) || undefined);
  const suppliedRevision = Number(args.baseRevision);
  if (Number.isFinite(suppliedRevision) && suppliedRevision !== store.revision) throw new Error(`STALE_REVISION: Expected revision ${store.revision}, received ${suppliedRevision}.`);
  const includeReferences = args.includeReferences !== false;
  const { width, height } = dimensions(root);
  let data = '';
  let outputWidth = width;
  let outputHeight = height;
  const warnings: string[] = [];
  if (format === 'svg') data = serializeSvg(root);
  else if (format === 'html') data = serializeHtml(root);
  else if (format === 'json') {
    data = serializeProject(asText(args.nodeId) || undefined, includeReferences);
    warnings.push('Project JSON contains the visible document and embedded local reference images.');
  } else {
    const scale = Math.min(3, Math.max(1, safeNumber(args.scale, 1, 1, 3)));
    outputWidth = Math.round(width * scale);
    outputHeight = Math.round(height * scale);
    if (outputWidth > 8_000 || outputHeight > 8_000) throw new Error('PNG export is too large at that scale.');
    data = await svgToPng(serializeSvg(root), width, height, scale, signal);
  }
  throwIfAborted(signal);
  if (byteLength(data) > MAX_PROJECT_BYTES) throw new Error('Export is too large to download safely.');
  const mimeType = format === 'png' ? 'image/png' : format === 'svg' ? 'image/svg+xml' : format === 'html' ? 'text/html' : 'application/json';
  const digest = checksum(data);
  const artifact: ExportArtifact = {
    artifactId: `artifact-${format}-${store.revision}-${digest}`,
    format,
    filename: filenameFor(root, format, args.filename),
    mimeType,
    bytes: byteLength(data),
    width: outputWidth,
    height: outputHeight,
    rootNodeId: root.id,
    revision: store.revision,
    checksum: digest,
    data,
    warnings,
  };
  if (operationId) exportResults.set(operationId, artifact);
  announce(artifact);
  return clone(artifact);
}

export function clearExportResults(): void {
  exportResults.clear();
}
