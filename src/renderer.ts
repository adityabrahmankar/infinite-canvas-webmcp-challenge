import {
  addReferenceImage,
  applyDesignStyles,
  importProject,
  recreateFromReference,
  resetDocument,
  redoDocument,
  undoDocument,
} from './tools';
import {
  closeColorPicker,
  initColorPicker,
  initInspectorColorFields,
  isInspectorRenderPaused,
  shouldCloseColorPicker,
  updateInspectorColorField,
  type ColorField,
} from './color-picker';
import { colorToCss, normalizeHex } from './color';
import { compileNodeToTailwind, compileSelection, copyCompiledCode, type CodeExportFormat } from './compiler';
import { exportDesign } from './exporter';
import {
  deleteSelection,
  getCanvasTool,
  installInteraction,
  interactionOverlay,
  isSpaceHeld,
  nudgeSelection,
  setCanvasTool,
  setSpaceHeld,
  subscribeInteraction,
} from './interaction';
import { applyLayoutToElement } from './layout';
import { store } from './store';
import { initPanelResize } from './panels';
import { setWebMcpStatus } from './webmcp';
import { initCanvasAgentOrbs, syncCanvasAgentOrbs } from './thinking-orb';
import {
  fitWorldRect,
  panBy as panCamera,
  panX,
  panY,
  resetZoom as resetCameraZoom,
  setZoom as setCameraZoom,
  zoom,
  zoomIn as zoomCameraIn,
  zoomOut as zoomCameraOut,
} from './viewport';
import type { DesignNode, ExportArtifact, ExportFormat, LayoutBounds, NodeStyle, ResizeHandle } from './types';

let exportPanelOpen = false;
let exportFormat: ExportFormat = 'svg';
let exportScale = 1;
let exportArtifact: ExportArtifact | null = null;
let exportBusy = false;
let exportError = '';
let inspectorTab: 'styles' | 'code' = 'styles';
let codeFormat: CodeExportFormat = 'react';
let codeCopyMessage = '';
let lastRenderedSelection: string | null = null;
const collapsedNodes = new Set<string>();
type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  try { return window.localStorage.getItem('infinite-canvas-theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

let theme: Theme = initialTheme();

const UI_WHEEL_CHROME = '.sidebar, .inspector, .canvas-toolbar, .panel-resize, .color-picker-popover, input, textarea, select';

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function cssColor(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

function isFlexChild(node: DesignNode): boolean {
  if (!node.parentId) return false;
  const parent = store.getNode(node.parentId);
  return !!parent && (parent.layout === 'flex-row' || parent.layout === 'flex-column');
}

function applyNodeStyle(element: HTMLElement, node: DesignNode): void {
  const parent = node.parentId ? store.getNode(node.parentId) : undefined;
  applyLayoutToElement(element, node, parent);

  const style = node.style;
  element.style.background = style.background ?? 'transparent';
  element.style.color = style.color ?? '#f8fafc';
  element.style.border = style.border ?? 'none';
  element.style.borderRadius = `${style.borderRadius ?? 0}px`;
  element.style.opacity = `${style.opacity ?? 1}`;
  element.style.fontFamily = style.fontFamily ? `"${style.fontFamily}", system-ui, sans-serif` : '';
  element.style.fontSize = style.fontSize ? `${style.fontSize}px` : '';
  element.style.fontWeight = `${style.fontWeight ?? 400}`;
  element.style.letterSpacing = style.letterSpacing ?? '';
  if (style.padding !== undefined) element.style.padding = `${style.padding}px`;
}

function renderNode(node: DesignNode): HTMLElement {
  const element = document.createElement(node.kind === 'button' ? 'div' : 'div');
  element.className = `canvas-node node-${node.kind}${store.isSelected(node.id) ? ' is-selected' : ''}`;
  element.dataset.nodeId = node.id;
  element.setAttribute('role', node.kind === 'text' ? 'text' : 'group');
  applyNodeStyle(element, node);
  if (node.kind === 'image') {
    const image = document.createElement('img');
    image.src = node.imageSrc ?? '';
    image.alt = node.name;
    image.draggable = false;
    element.appendChild(image);
  } else if (node.kind === 'text' || node.kind === 'button' || node.kind === 'rect') {
    element.textContent = node.text ?? (node.kind === 'rect' ? '' : node.name);
  }
  node.children.forEach((childId) => {
    const child = store.getNode(childId);
    if (child) element.appendChild(renderNode(child));
  });
  return element;
}

/**
 * Adopt the browser's resolved positions for every rendered layer.
 *
 * CSS flex layout owns the location of flow children, so their authored AST
 * x/y values are not meaningful for hit-testing. The full editor uses the
 * same boundary: read offsetLeft/offsetTop and border-box dimensions after
 * layout, then let interaction consume those runtime values. Keeping this
 * separate from the persisted node avoids turning a measurement into an
 * undoable document edit.
 */
function syncRuntimeBounds(world: HTMLElement): void {
  const bounds = new Map<string, LayoutBounds>();
  world.querySelectorAll<HTMLElement>('[data-node-id]').forEach((element) => {
    const id = element.dataset.nodeId;
    const node = store.getNode(id);
    if (!id || !node || node.hidden) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    bounds.set(id, {
      x: Number.isFinite(element.offsetLeft) ? element.offsetLeft : node.x,
      y: Number.isFinite(element.offsetTop) ? element.offsetTop : node.y,
      width: width > 0 ? width : node.width,
      height: height > 0 ? height : node.height,
    });
  });
  store.replaceRuntimeBounds(bounds);
}

function visibleNodeIds(): string[] {
  const ids: string[] = [];
  const visit = (id: string): void => {
    const node = store.getNode(id);
    if (!node || node.hidden) return;
    ids.push(id);
    node.children.forEach(visit);
  };
  store.rootIds.forEach(visit);
  return ids;
}

function patchPaint(element: HTMLElement, node: DesignNode): void {
  applyNodeStyle(element, node);
  element.classList.toggle('is-selected', store.isSelected(node.id));
  if ((node.kind === 'text' || node.kind === 'button' || node.kind === 'rect') && node.children.length === 0) {
    const next = node.text ?? (node.kind === 'rect' ? '' : node.name);
    if (element.childElementCount === 0 && element.textContent !== next) element.textContent = next;
  }
  if (node.kind === 'image') {
    const image = element.querySelector('img');
    if (image && node.imageSrc && image.getAttribute('src') !== node.imageSrc) image.src = node.imageSrc;
  }
}

function patchScene(world: HTMLElement): boolean {
  const expected = visibleNodeIds();
  const elements = [...world.querySelectorAll<HTMLElement>('[data-node-id]')];
  if (!elements.length || elements.length !== expected.length) return false;
  const byId = new Map<string, HTMLElement>();
  for (const element of elements) {
    const id = element.dataset.nodeId;
    if (!id || byId.has(id) || !store.getNode(id)) return false;
    byId.set(id, element);
  }
  if (expected.some((id) => !byId.has(id))) return false;

  const place = (parentElement: HTMLElement, childIds: string[]): void => {
    for (const id of childIds) {
      const node = store.getNode(id);
      if (!node || node.hidden) continue;
      const element = byId.get(id);
      if (!element) return;
      patchPaint(element, node);
      if (element.parentElement !== parentElement) parentElement.appendChild(element);
      else parentElement.appendChild(element);
      place(element, node.children);
    }
  };
  place(world, store.rootIds);
  return true;
}

function rebuildScene(world: HTMLElement): void {
  world.innerHTML = '';
  store.rootIds.forEach((rootId) => {
    const root = store.getNode(rootId);
    if (!root || root.hidden) return;
    world.appendChild(renderNode(root));
  });
}

function renderScene(): void {
  const world = document.getElementById('canvas-world');
  if (!world) return;
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  if (!patchScene(world)) rebuildScene(world);
  syncRuntimeBounds(world);
  renderOverlay();
  const zoomLabel = document.querySelector<HTMLElement>('.zoom-label');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function treeNode(node: DesignNode, depth = 0): string {
  const selected = store.isSelected(node.id) ? ' is-selected' : '';
  const icon = node.kind === 'text' ? 'Aa' : node.kind === 'button' ? '↗' : node.kind === 'rect' ? '□' : node.kind === 'image' ? '▧' : '▱';
  const hasChildren = node.children.length > 0;
  const expanded = !collapsedNodes.has(node.id);
  const toggle = hasChildren
    ? `<button class="tree-toggle" data-toggle-id="${escapeHtml(node.id)}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(node.name)}" aria-expanded="${expanded}">${expanded ? '⌄' : '›'}</button>`
    : '<span class="tree-toggle-spacer" aria-hidden="true"></span>';
  const children = expanded ? node.children.map((id) => store.getNode(id)).filter((child): child is DesignNode => !!child)
    .map((child) => treeNode(child, depth + 1)).join('') : '';
  return `<div class="tree-row${selected}" data-select-id="${escapeHtml(node.id)}" style="--depth:${depth}">
    ${toggle}<span class="tree-icon">${icon}</span><span class="tree-name">${escapeHtml(node.name)}</span>
  </div>${children}`;
}

function renderTree(): void {
  const tree = document.getElementById('layers-tree');
  if (!tree) return;
  tree.innerHTML = store.rootIds.map((id) => store.getNode(id)).filter((node): node is DesignNode => !!node)
    .map((node) => treeNode(node)).join('');
  const expandable = [...store.nodes.values()].filter((node) => node.children.length > 0);
  const allCollapsed = expandable.length > 0 && expandable.every((node) => collapsedNodes.has(node.id));
  const collapseAll = document.getElementById('layers-collapse-all');
  if (collapseAll) {
    collapseAll.textContent = allCollapsed ? '›' : '⌄';
    collapseAll.setAttribute('aria-label', allCollapsed ? 'Expand all layers' : 'Collapse all layers');
    collapseAll.setAttribute('title', allCollapsed ? 'Expand all layers' : 'Collapse all layers');
    collapseAll.setAttribute('aria-pressed', String(allCollapsed));
  }
}

function renderOverlay(): void {
  const overlay = document.getElementById('canvas-overlay');
  if (!overlay) return;
  const parts: string[] = [];
  for (const node of store.selectedIds.map((id) => store.getNode(id)).filter((candidate): candidate is DesignNode => !!candidate && !candidate.hidden)) {
    const bounds = store.worldBounds(node);
    parts.push(`<div class="selection-box" style="left:${panX + bounds.x * zoom}px;top:${panY + bounds.y * zoom}px;width:${bounds.width * zoom}px;height:${bounds.height * zoom}px"></div>`);
  }
  if (store.selectedIds.length === 1) {
    const node = store.getNode(store.selectedId);
    if (node) {
      const bounds = store.worldBounds(node);
      const left = panX + bounds.x * zoom;
      const top = panY + bounds.y * zoom;
      const width = bounds.width * zoom;
      const height = bounds.height * zoom;
      const handles: Array<{ handle: ResizeHandle; x: number; y: number }> = [
        { handle: 'nw', x: left, y: top },
        { handle: 'n', x: left + width / 2, y: top },
        { handle: 'ne', x: left + width, y: top },
        { handle: 'e', x: left + width, y: top + height / 2 },
        { handle: 'se', x: left + width, y: top + height },
        { handle: 's', x: left + width / 2, y: top + height },
        { handle: 'sw', x: left, y: top + height },
        { handle: 'w', x: left, y: top + height / 2 },
      ];
      handles.forEach((item) => {
        parts.push(`<div class="resize-handle handle-${item.handle}" data-handle="${item.handle}" style="left:${item.x}px;top:${item.y}px"></div>`);
      });
    }
  }
  const preview = interactionOverlay();
  if (preview.marquee) {
    parts.push(`<div class="marquee-box" style="left:${panX + preview.marquee.x * zoom}px;top:${panY + preview.marquee.y * zoom}px;width:${preview.marquee.width * zoom}px;height:${preview.marquee.height * zoom}px"></div>`);
  }
  if (preview.create) {
    parts.push(`<div class="create-box" style="left:${panX + preview.create.x * zoom}px;top:${panY + preview.create.y * zoom}px;width:${Math.max(1, preview.create.width * zoom)}px;height:${Math.max(1, preview.create.height * zoom)}px"></div>`);
  }
  overlay.innerHTML = parts.join('');
  syncCanvasAgentOrbs();
}

function renderTools(): void {
  const tool = getCanvasTool();
  document.querySelectorAll<HTMLButtonElement>('[data-canvas-tool]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.canvasTool === tool);
  });
  const scene = document.getElementById('canvas-scene');
  if (scene) {
    scene.classList.toggle('is-hand', tool === 'hand' || isSpaceHeld());
    scene.classList.toggle('is-draw', tool === 'frame' || tool === 'rect' || tool === 'text' || tool === 'button');
  }
  const del = document.getElementById('delete-selection') as HTMLButtonElement | null;
  if (del) del.disabled = store.selectedIds.length === 0;
}

function applyTheme(next: Theme): void {
  theme = next;
  document.documentElement.dataset.theme = theme;
  try { window.localStorage.setItem('infinite-canvas-theme', theme); } catch { /* storage may be unavailable */ }
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    const light = theme === 'light';
    toggle.textContent = light ? '☾' : '☼';
    toggle.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
    toggle.setAttribute('title', light ? 'Switch to dark theme' : 'Switch to light theme');
    toggle.setAttribute('aria-pressed', String(light));
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', lightThemeColor(theme));
}

function lightThemeColor(current: Theme): string {
  return current === 'light' ? '#eef1f7' : '#19191b';
}

function field(label: string, key: string, value: string, type = 'text'): string {
  return `<label class="field"><span>${label}</span><input data-inspector-field="${key}" type="${type}" value="${escapeHtml(value)}"></label>`;
}

function compactField(label: string, key: string, value: string): string {
  return `<div class="compact-field"><span>${label}</span><input data-inspector-field="${key}" type="number" value="${escapeHtml(value)}"></div>`;
}

const FONT_LIST = [
  { label: 'System Default', value: '' },
  { label: 'Inter', value: 'Inter' },
  { label: 'DM Sans', value: 'DM Sans' },
  { label: 'Poppins', value: 'Poppins' },
  { label: 'Plus Jakarta Sans', value: 'Plus Jakarta Sans' },
  { label: 'Outfit', value: 'Outfit' },
  { label: 'Sora', value: 'Sora' },
  { label: 'Manrope', value: 'Manrope' },
  { label: 'Space Grotesk', value: 'Space Grotesk' },
  { label: 'Playfair Display', value: 'Playfair Display' },
  { label: 'Lora', value: 'Lora' },
  { label: 'JetBrains Mono', value: 'JetBrains Mono' },
  { label: 'Space Mono', value: 'Space Mono' },
];

function colorField(label: string, key: ColorField, value: string): string {
  const raw = value.trim();
  const css = raw ? colorToCss(raw, key === 'background' ? 'transparent' : '#FFFFFF') : '';
  const display = !raw ? '' : (css === 'transparent' ? 'transparent' : (normalizeHex(css) ?? css));
  const transparentClass = css === 'transparent' ? ' is-transparent' : '';
  const swatchBg = !raw ? '#2a3344' : (css === 'transparent' ? 'transparent' : css);
  const emptyClass = !raw ? ' is-empty' : '';
  return `<label class="field color-field"><span>${label}</span><div class="color-input-wrap"><button type="button" class="color-swatch-btn" data-color-open="${key}" aria-label="Pick ${label.toLowerCase()}"><span class="color-swatch-preview${transparentClass}${emptyClass}" style="background:${escapeHtml(swatchBg)}"></span></button><input class="color-hex-input" data-inspector-field="${key}" data-color-input type="text" value="${escapeHtml(display)}" spellcheck="false" aria-label="${label}" placeholder="#FFFFFF"></div></label>`;
}

function applyInspectorColor(key: ColorField, raw: string): void {
  const node = store.getNode(store.selectedId);
  if (!node) return;
  const trimmed = raw.trim();
  if (key === 'background' && trimmed.toLowerCase() === 'transparent') {
    applyDesignStyles({ nodeId: node.id, styles: { background: 'transparent' } });
    updateInspectorColorField(key, 'transparent');
    return;
  }
  const hex = normalizeHex(trimmed);
  if (!hex) return;
  applyDesignStyles({ nodeId: node.id, styles: { [key]: hex } });
  updateInspectorColorField(key, hex);
}

function fontSelect(current: string): string {
  const options = FONT_LIST.map(f =>
    `<option value="${escapeHtml(f.value)}"${(current || '') === f.value ? ' selected' : ''} style="font-family:${f.value ? `'${f.value}',` : ''}system-ui,sans-serif">${escapeHtml(f.label)}</option>`
  ).join('');
  return `<label class="field"><span>Font</span><div class="select-wrap"><select data-inspector-field="fontFamily">${options}</select></div></label>`;
}

function highlightExportCode(code: string): string {
  return escapeHtml(code)
    .replace(/(\/\/[^\n]*)/g, '<span data-tok="cmt">$1</span>')
    .replace(/\b(export|function|return|const|let|type|import|from)\b/g, '<span data-tok="kw">$1</span>')
    .replace(/(&lt;\/?[A-Za-z][\w.]*)/g, '<span data-tok="tag">$1</span>')
    .replace(/\b(className|class|type|src|alt)\b(?==)/g, '<span data-tok="attr">$1</span>')
    .replace(/(&quot;[\s\S]*?&quot;)/g, '<span data-tok="str">$1</span>');
}

function setInspectorTab(tab: 'styles' | 'code'): void {
  inspectorTab = tab;
  const stylesPanel = document.getElementById('inspector-content');
  const codePanel = document.getElementById('inspector-code');
  document.querySelectorAll<HTMLButtonElement>('[data-inspector-tab]').forEach((button) => {
    const active = button.dataset.inspectorTab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (stylesPanel) stylesPanel.hidden = tab !== 'styles';
  if (codePanel) {
    codePanel.hidden = tab !== 'code';
    if (tab !== 'code') codePanel.innerHTML = '';
  }
  if (tab === 'code') renderCodePanel();
}

function renderCodePanel(): void {
  const panel = document.getElementById('inspector-code');
  if (!panel) return;
  const previousScroll = panel.querySelector('.code-block')?.scrollTop ?? 0;
  if (store.selectedIds.length > 1) {
    panel.innerHTML = '<div class="code-empty">Select a single layer to view generated code.</div>';
    return;
  }
  const node = store.getNode(store.selectedId);
  if (!node) {
    panel.innerHTML = '<div class="code-empty">Select an artboard or layer to view Tailwind or React code.</div>';
    return;
  }
  const code = compileSelection(codeFormat, node.id);
  const formatLabel = codeFormat === 'react' ? 'TSX' : 'HTML';
  const copyLabel = codeCopyMessage || 'Copy';
  const copied = !!codeCopyMessage;
  panel.innerHTML = `<div class="inspector-heading">
      <span class="eyebrow">SELECTED LAYER</span>
      <strong>${escapeHtml(node.name)}</strong>
      <small>${escapeHtml(node.kind)} · revision ${store.revision}</small>
    </div>
    <div class="code-toolbar">
      <div class="code-format-toggle" role="tablist" aria-label="Code format">
        <button type="button" class="code-format-btn${codeFormat === 'react' ? ' is-active' : ''}" data-code-format="react" role="tab" aria-selected="${codeFormat === 'react'}">React</button>
        <button type="button" class="code-format-btn${codeFormat === 'tailwind' ? ' is-active' : ''}" data-code-format="tailwind" role="tab" aria-selected="${codeFormat === 'tailwind'}">Tailwind</button>
      </div>
      <button type="button" class="code-copy-btn${copied ? ' is-copied' : ''}" data-code-action="copy">${escapeHtml(copyLabel)}</button>
    </div>
    <div class="code-block-wrap">
      <div class="code-block-meta"><span>${escapeHtml(formatLabel)}</span><span>${code.split('\n').length} lines</span></div>
      <pre class="code-block" id="inspector-code-block">${highlightExportCode(code)}</pre>
    </div>`;
  const scroller = panel.querySelector('.code-block');
  if (scroller) scroller.scrollTop = previousScroll;
}

function isInspectorFieldFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && !!active.closest('#inspector-content [data-inspector-field]');
}

function renderInspector(): void {
  const panel = document.getElementById('inspector-content');
  if (!panel) return;
  if (store.selectedIds.length > 1) {
    panel.innerHTML = `<div class="inspector-heading"><span class="eyebrow">SELECTION</span><strong>${store.selectedIds.length} layers</strong><small>Shift-click, ⌘/Ctrl-click, or marquee to add · Delete to remove</small></div>
      <div class="inspector-section"><button class="danger-action" data-action="delete-selection">Delete ${store.selectedIds.length} layers</button></div>`;
    return;
  }
  const node = store.getNode(store.selectedId);
  if (!node) {
    panel.innerHTML = '<div class="empty-inspector">Select an artboard or layer to inspect it.</div>';
    return;
  }
  const canEditText = node.kind === 'text' || node.kind === 'button' || node.kind === 'rect';
  const contentSection = canEditText
    ? `<div class="inspector-section"><span class="section-label">Content</span>
        <label class="field field-stack"><span>Text</span><textarea data-inspector-field="text" rows="${node.kind === 'text' ? 4 : 2}" spellcheck="false">${escapeHtml(node.text ?? '')}</textarea></label>
      </div>`
    : '';
  const referencePanel = node.kind === 'image' && node.imageSrc
    ? `<div class="reference-panel"><img class="reference-preview" src="${escapeHtml(node.imageSrc)}" alt="${escapeHtml(node.name)}"><small>Reference image · ${node.width}×${node.height}</small><button class="reference-action" data-action="recreate-reference" data-reference-id="${escapeHtml(node.referenceId ?? node.id)}">Recreate editable frame</button></div>`
    : '';
  const layoutSection = node.kind === 'frame'
    ? `<div class="inspector-section"><span class="section-label">Auto layout</span>
        <label class="field"><span>Direction</span><div class="select-wrap"><select data-inspector-field="layout"><option value="absolute"${(node.layout ?? 'absolute') === 'absolute' ? ' selected' : ''}>Freeform</option><option value="flex-row"${node.layout === 'flex-row' ? ' selected' : ''}>Row</option><option value="flex-column"${node.layout === 'flex-column' ? ' selected' : ''}>Column</option></select></div></label>
        ${node.layout === 'flex-row' || node.layout === 'flex-column' ? field('Gap', 'gap', String(node.gap ?? 0), 'number') : ''}
        ${field('Padding', 'padding', String(node.style.padding ?? 0), 'number')}
        <label class="field"><span>Overflow</span><div class="select-wrap"><select data-inspector-field="clipContent"><option value="false"${node.clipContent !== true ? ' selected' : ''}>Visible</option><option value="true"${node.clipContent === true ? ' selected' : ''}>Clip</option></select></div></label>
      </div>`
    : '';
  const sizingSection = node.parentId && isFlexChild(node)
    ? `<div class="inspector-section"><span class="section-label">Sizing</span>
        <label class="field"><span>Width</span><div class="select-wrap"><select data-inspector-field="widthSizing"><option value="fixed"${(node.widthSizing ?? 'fixed') === 'fixed' ? ' selected' : ''}>Fixed</option><option value="fill"${node.widthSizing === 'fill' ? ' selected' : ''}>Fill</option><option value="hug"${node.widthSizing === 'hug' ? ' selected' : ''}>Hug</option></select></div></label>
        <label class="field"><span>Height</span><div class="select-wrap"><select data-inspector-field="heightSizing"><option value="fixed"${(node.heightSizing ?? 'fixed') === 'fixed' ? ' selected' : ''}>Fixed</option><option value="fill"${node.heightSizing === 'fill' ? ' selected' : ''}>Fill</option><option value="hug"${node.heightSizing === 'hug' ? ' selected' : ''}>Hug</option></select></div></label>
      </div>`
    : '';
  const bounds = store.resolvedBounds(node);
  panel.innerHTML = `<div class="inspector-heading"><span class="eyebrow">SELECTED LAYER</span><strong>${escapeHtml(node.name)}</strong><small>${escapeHtml(node.kind)} · revision ${store.revision}</small></div>
    ${referencePanel}${contentSection}<div class="inspector-section"><span class="section-label">Position</span><div class="field-grid">${compactField('X', 'x', String(Math.round(bounds.x)))}${compactField('Y', 'y', String(Math.round(bounds.y)))}${compactField('W', 'width', String(Math.round(bounds.width)))}${compactField('H', 'height', String(Math.round(bounds.height)))}</div></div>
    ${layoutSection}${sizingSection}
    ${node.kind !== 'image' ? `<div class="inspector-section"><span class="section-label">Typography</span>${fontSelect(node.style.fontFamily ?? '')}${field('Size', 'fontSize', String(node.style.fontSize ?? 14), 'number')}${field('Weight', 'fontWeight', String(node.style.fontWeight ?? 400), 'number')}</div>` : ''}
    <div class="inspector-section"><span class="section-label">Appearance</span>${colorField('Fill', 'background', node.style.background ?? '')}${node.kind !== 'image' ? colorField('Text', 'color', node.style.color ?? '') : ''}${field('Corners', 'borderRadius', String(node.style.borderRadius ?? 0), 'number')}${field('Opacity', 'opacity', String(Math.round((node.style.opacity ?? 1) * 100)), 'number')}</div>
    <div class="inspector-section"><button class="danger-action" data-action="delete-selection">Delete layer</button></div>`;
}

function statusLine(): void {
  setWebMcpStatus((window.__canvasToolCount ?? 0) > 0, window.__canvasToolCount ?? 0);
  const revision = document.getElementById('revision-status');
  if (revision) revision.textContent = `revision ${store.revision}`;
  const undo = document.getElementById('undo-document') as HTMLButtonElement | null;
  const redo = document.getElementById('redo-document') as HTMLButtonElement | null;
  if (undo) undo.disabled = !store.canUndo();
  if (redo) redo.disabled = !store.canRedo();
}

export function renderApp(): void {
  if (shouldCloseColorPicker()) closeColorPicker();
  if (lastRenderedSelection !== store.selectedId || (exportArtifact && exportArtifact.revision !== store.revision)) {
    exportArtifact = null;
    lastRenderedSelection = store.selectedId;
  }
  renderScene();
  renderTree();
  if (!isInspectorRenderPaused() && !isInspectorFieldFocused()) renderInspector();
  if (inspectorTab === 'code') renderCodePanel();
  statusLine();
  renderTools();
  renderExportPanel();
}

function artifactBlob(artifact: ExportArtifact): Blob {
  if (artifact.format !== 'png' || !artifact.data.startsWith('data:')) return new Blob([artifact.data], { type: artifact.mimeType });
  const comma = artifact.data.indexOf(',');
  const encoded = comma >= 0 ? artifact.data.slice(comma + 1) : '';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: artifact.mimeType });
}

function downloadArtifact(artifact: ExportArtifact): void {
  const url = URL.createObjectURL(artifactBlob(artifact));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderExportPanel(): void {
  const panel = document.getElementById('export-panel');
  if (!panel) return;
  panel.hidden = !exportPanelOpen;
  if (!exportPanelOpen) {
    panel.innerHTML = '';
    return;
  }
  const selected = store.getNode(store.selectedId);
  const selectedName = selected ? selected.name : 'selected artboard';
  const artifact = exportArtifact;
  panel.innerHTML = `<div class="export-head"><div><div class="panel-kicker">DESIGN HANDOFF</div><strong>Export ${escapeHtml(selectedName)}</strong></div><button class="icon-button" type="button" data-export-action="close" aria-label="Close export panel" title="Close export panel">×</button></div>
    <div class="export-fields"><label class="export-field"><span>Format</span><select data-export-field="format"><option value="svg"${exportFormat === 'svg' ? ' selected' : ''}>SVG · editable vector</option><option value="png"${exportFormat === 'png' ? ' selected' : ''}>PNG · visual handoff</option><option value="html"${exportFormat === 'html' ? ' selected' : ''}>HTML · self-contained</option><option value="json"${exportFormat === 'json' ? ' selected' : ''}>JSON · reopenable project</option></select></label><label class="export-field"><span>PNG scale</span><select data-export-field="scale"${exportFormat === 'png' ? '' : ' disabled'}><option value="1"${exportScale === 1 ? ' selected' : ''}>1×</option><option value="2"${exportScale === 2 ? ' selected' : ''}>2×</option><option value="3"${exportScale === 3 ? ' selected' : ''}>3×</option></select></label></div>
    <div class="export-scope"><span>Selected artboard</span><span>revision ${store.revision}</span></div>
    <button class="export-run" type="button" data-export-action="run"${exportBusy ? ' disabled' : ''}>${exportBusy ? 'Preparing artifact…' : `Create ${exportFormat.toUpperCase()} export`}</button>
    <div class="export-btn-group" style="margin-top:10px;">
      <button class="export-btn" type="button" data-export-action="copy-react">Copy React JSX</button>
      <button class="export-btn" type="button" data-export-action="copy-tailwind">Copy Tailwind CSS</button>
    </div>
    ${artifact ? `<div class="export-receipt"><div class="receipt-head"><span class="status-pill status-completed">ready</span><strong>${escapeHtml(artifact.filename)}</strong></div><div class="receipt-grid"><span>Format</span><b>${escapeHtml(artifact.format.toUpperCase())}</b><span>Size</span><b>${Math.round(artifact.bytes / 1024)} KB</b><span>Canvas</span><b>${artifact.width}×${artifact.height}</b><span>Revision</span><b>${artifact.revision}</b></div><div class="receipt-checksum">checksum <code>${escapeHtml(artifact.checksum)}</code></div><button class="export-download" type="button" data-export-action="download">Download ${escapeHtml(artifact.filename)}</button>${artifact.warnings.length ? `<div class="receipt-warning">${artifact.warnings.map((warning) => escapeHtml(warning)).join(' ')}</div>` : ''}</div>` : ''}
    ${exportError ? `<div class="panel-error" role="alert">${escapeHtml(exportError)}</div>` : ''}`;
}

async function runExport(): Promise<void> {
  if (exportBusy) return;
  exportBusy = true;
  exportError = '';
  renderExportPanel();
  try {
    await exportDesign({ format: exportFormat, scale: exportScale, nodeId: store.selectedId ?? undefined });
  } catch (error) {
    exportError = error instanceof Error ? error.message : String(error);
  } finally {
    exportBusy = false;
    renderExportPanel();
  }
}

async function openProjectFile(file: File | null): Promise<void> {
  if (!file) return;
  try {
    const projectJson = await file.text();
    importProject({ projectJson });
    exportArtifact = null;
    exportError = '';
    exportPanelOpen = true;
    renderApp();
  } catch (error) {
    exportError = error instanceof Error ? error.message : String(error);
    exportPanelOpen = true;
    renderExportPanel();
  }
}

function readNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unionWorldRect(nodes: DesignNode[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const bounds = store.worldBounds(node);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  return { minX, minY, maxX, maxY };
}

function applyCamera(): void {
  renderScene();
}

function setZoom(nextZoom: number, anchor?: { clientX: number; clientY: number }): void {
  setCameraZoom(nextZoom, anchor);
  applyCamera();
}

function resetView(): void {
  resetCameraZoom();
  applyCamera();
}

function panBy(deltaX: number, deltaY: number): void {
  panCamera(deltaX, deltaY);
  applyCamera();
}

function zoomToFit(): void {
  fitWorldRect(unionWorldRect(store.roots()), { padding: 80, minScale: 0.05, maxScale: 2 });
  applyCamera();
}

function zoomToSelection(): void {
  const selected = store.selectedIds
    .map((id) => store.getNode(id))
    .filter((node): node is DesignNode => !!node);
  if (!selected.length) {
    zoomToFit();
    return;
  }
  fitWorldRect(unionWorldRect(selected), { padding: 100, minScale: 0.1, maxScale: 3 });
  applyCamera();
}

function reportUiError(error: unknown): void {
  exportError = error instanceof Error ? error.message : String(error);
  exportPanelOpen = true;
  renderExportPanel();
}

function addImageFile(file: File | null): void {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > 1_500_000) {
    reportUiError('Reference image is too large. Keep pasted images under 1.5 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => reportUiError('Could not read that reference image.');
  reader.onload = () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : '';
    const image = new Image();
    image.onerror = () => reportUiError('That file is not a readable image.');
    image.onload = () => {
      try {
        addReferenceImage({
          name: file.name || 'Pasted reference image',
          dataUrl,
          width: image.naturalWidth || 420,
          height: image.naturalHeight || 280,
        });
      } catch (error) {
        reportUiError(error);
      }
    };
    image.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function installCanvasNavigation(): void {
  const scene = document.getElementById('canvas-scene');
  if (!scene) return;

  window.addEventListener('wheel', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(UI_WHEEL_CHROME)) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      setZoom(zoom * Math.pow(1.01, -event.deltaY), event);
    } else {
      panBy(-event.deltaX, -event.deltaY);
    }
  }, { passive: false });

  scene.addEventListener('contextmenu', (event) => event.preventDefault());
  scene.addEventListener('dragover', (event) => {
    if ([...(event.dataTransfer?.items ?? [])].some((item) => item.type.startsWith('image/'))) {
      event.preventDefault();
      scene.classList.add('is-drop-target');
    }
  });
  scene.addEventListener('dragleave', () => scene.classList.remove('is-drop-target'));
  scene.addEventListener('drop', (event) => {
    event.preventDefault();
    scene.classList.remove('is-drop-target');
    [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/')).forEach(addImageFile);
  });
}

export function initRenderer(): void {
  initPanelResize();
  initCanvasAgentOrbs();
  initColorPicker();
  initInspectorColorFields();
  window.addEventListener('canvas:color-picker-closed', () => renderInspector());
  setInspectorTab(inspectorTab);
  document.querySelectorAll<HTMLButtonElement>('[data-inspector-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.inspectorTab;
      if (tab === 'styles' || tab === 'code') setInspectorTab(tab);
    });
  });
  document.getElementById('inspector-code')?.addEventListener('click', async (event) => {
    const formatButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-code-format]');
    if (formatButton) {
      const next = formatButton.dataset.codeFormat;
      if (next === 'react' || next === 'tailwind') {
        codeFormat = next;
        codeCopyMessage = '';
        renderCodePanel();
      }
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-code-action]');
    if (!button) return;
    try {
      if (codeFormat === 'react') await copyCompiledCode('react', store.selectedId);
      else await copyCompiledCode('tailwind', store.selectedId);
      codeCopyMessage = 'Copied';
      renderCodePanel();
      window.setTimeout(() => { codeCopyMessage = ''; if (inspectorTab === 'code') renderCodePanel(); }, 1400);
    } catch {
      codeCopyMessage = 'Copy failed';
      renderCodePanel();
    }
  });
  store.subscribe(renderApp);
  subscribeInteraction(renderApp);
  installInteraction();
  document.getElementById('layers-tree')?.addEventListener('click', (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-toggle-id]');
    if (toggle) {
      event.stopPropagation();
      const id = toggle.dataset.toggleId;
      if (id) collapsedNodes.has(id) ? collapsedNodes.delete(id) : collapsedNodes.add(id);
      renderTree();
      return;
    }
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-select-id]');
    if (!target?.dataset.selectId) return;
    if (event.shiftKey || event.metaKey || event.ctrlKey) store.toggleSelect(target.dataset.selectId);
    else store.select(target.dataset.selectId);
  });
  document.getElementById('layers-collapse-all')?.addEventListener('click', () => {
    const expandable = [...store.nodes.values()].filter((node) => node.children.length > 0);
    const allCollapsed = expandable.length > 0 && expandable.every((node) => collapsedNodes.has(node.id));
    expandable.forEach((node) => allCollapsed ? collapsedNodes.delete(node.id) : collapsedNodes.add(node.id));
    renderTree();
  });
  document.getElementById('theme-toggle')?.addEventListener('click', () => applyTheme(theme === 'dark' ? 'light' : 'dark'));
  window.addEventListener('canvas:reset', () => {
    collapsedNodes.clear();
    exportArtifact = null;
    exportError = '';
    renderApp();
    zoomToFit();
  });
  window.addEventListener('canvas:export-ready', (event) => {
    const artifact = (event as CustomEvent<ExportArtifact>).detail;
    if (!artifact || typeof artifact !== 'object' || !artifact.data) return;
    exportArtifact = artifact;
    exportPanelOpen = true;
    exportError = '';
    renderExportPanel();
  });
  document.getElementById('inspector-content')?.addEventListener('focusout', (event) => {
    const field = (event.target as HTMLElement).closest('[data-inspector-field="text"]');
    if (field && store.isGesturing()) store.endGesture();
  });
  document.getElementById('inspector-content')?.addEventListener('input', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLTextAreaElement>('[data-inspector-field="text"]');
    const node = store.getNode(store.selectedId);
    if (!input || !node) return;
    if (!store.isGesturing()) store.beginGesture();
    store.updateText(node.id, input.value);
  });
  document.getElementById('inspector-content')?.addEventListener('keydown', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches?.('[data-inspector-field]')) return;
    if (event.key === 'Enter') {
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (input.dataset.colorInput !== undefined && (input.dataset.inspectorField === 'background' || input.dataset.inspectorField === 'color')) {
        applyInspectorColor(input.dataset.inspectorField as ColorField, input.value);
      }
      input.blur();
      return;
    }
    if (input.type === 'number' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      event.stopPropagation();
      const step = event.shiftKey ? 10 : 1;
      const delta = event.key === 'ArrowUp' ? step : -step;
      const fieldKey = input.dataset.inspectorField;
      input.value = String(readNumber(input.value, 0) + delta);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (fieldKey) {
        requestAnimationFrame(() => {
          const next = document.querySelector<HTMLInputElement>(`[data-inspector-field="${fieldKey}"]`);
          if (next) { next.focus(); next.select(); }
        });
      }
    }
  });
  document.getElementById('inspector-content')?.addEventListener('change', (event) => {
    const input = (event.target as HTMLInputElement | HTMLSelectElement).closest<HTMLInputElement | HTMLSelectElement>('[data-inspector-field]');
    const node = store.getNode(store.selectedId);
    if (!input || !node) return;
    const key = input.dataset.inspectorField;
    if (key === 'text') {
      if (store.isGesturing()) store.endGesture();
      return;
    }
    else if (key === 'width' || key === 'height' || key === 'x' || key === 'y') {
      const fallback = key === 'width' ? node.width : key === 'height' ? node.height : key === 'x' ? node.x : node.y;
      const value = key === 'width' || key === 'height' ? Math.max(1, readNumber(input.value, fallback)) : readNumber(input.value, fallback);
      store.updateGeometry(node.id, { [key]: value });
    } else if (key === 'layout') {
      store.updateNodeProp(node.id, 'layout', input.value as 'absolute' | 'flex-row' | 'flex-column');
    } else if (key === 'gap') {
      store.updateNodeProp(node.id, 'gap', Math.max(0, readNumber(input.value, node.gap ?? 0)));
    } else if (key === 'clipContent') {
      store.updateNodeProp(node.id, 'clipContent', input.value === 'true');
    } else if (key === 'widthSizing') {
      store.updateNodeProp(node.id, 'widthSizing', input.value as 'fixed' | 'fill' | 'hug');
    } else if (key === 'heightSizing') {
      store.updateNodeProp(node.id, 'heightSizing', input.value as 'fixed' | 'fill' | 'hug');
    } else if (key === 'padding') {
      const styles: NodeStyle = { padding: Math.max(0, readNumber(input.value, node.style.padding ?? 0)) };
      applyDesignStyles({ nodeId: node.id, styles });
    } else if (key === 'background' || key === 'color') {
      applyInspectorColor(key, input.value);
    } else if (key === 'fontFamily') {
      applyDesignStyles({ nodeId: node.id, styles: { fontFamily: input.value || undefined } });
    } else if (key === 'fontSize') {
      applyDesignStyles({ nodeId: node.id, styles: { fontSize: Math.max(6, readNumber(input.value, node.style.fontSize ?? 14)) } });
    } else if (key === 'fontWeight') {
      applyDesignStyles({ nodeId: node.id, styles: { fontWeight: Math.max(100, Math.min(900, readNumber(input.value, node.style.fontWeight ?? 400))) } });
    } else if (key === 'opacity') {
      applyDesignStyles({ nodeId: node.id, styles: { opacity: Math.max(0, Math.min(1, readNumber(input.value, (node.style.opacity ?? 1) * 100) / 100)) } });
    } else {
      const styles: NodeStyle = {};
      if (key === 'borderRadius') styles.borderRadius = Math.max(0, readNumber(input.value, node.style.borderRadius ?? 0));
      applyDesignStyles({ nodeId: node.id, styles });
    }
  });
  document.getElementById('inspector-content')?.addEventListener('click', (event) => {
    const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action="delete-selection"]');
    if (deleteButton) {
      deleteSelection();
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action="recreate-reference"]');
    if (!button) return;
    try {
      recreateFromReference({ referenceId: button.dataset.referenceId });
    } catch (error) {
      reportUiError(error);
    }
  });
  document.getElementById('canvas-tools')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-canvas-tool]');
    if (button?.dataset.canvasTool) setCanvasTool(button.dataset.canvasTool as 'select' | 'hand' | 'frame' | 'rect' | 'text' | 'button');
  });
  document.getElementById('delete-selection')?.addEventListener('click', () => { deleteSelection(); });
  document.getElementById('reset-document')?.addEventListener('click', () => {
    if (!window.confirm('Reset the canvas to the default document? Unsaved edits will be lost.')) return;
    collapsedNodes.clear();
    resetDocument();
  });
  document.getElementById('zoom-in')?.addEventListener('click', () => { zoomCameraIn(); applyCamera(); });
  document.getElementById('zoom-out')?.addEventListener('click', () => { zoomCameraOut(); applyCamera(); });
  document.getElementById('zoom-reset')?.addEventListener('click', resetView);
  document.getElementById('zoom-label')?.addEventListener('click', () => zoomToFit());
  document.getElementById('undo-document')?.addEventListener('click', () => {
    try { undoDocument(); exportError = ''; renderApp(); }
    catch (error) { exportError = error instanceof Error ? error.message : String(error); exportPanelOpen = true; renderApp(); }
  });
  document.getElementById('redo-document')?.addEventListener('click', () => {
    try { redoDocument(); exportError = ''; renderApp(); }
    catch (error) { exportError = error instanceof Error ? error.message : String(error); exportPanelOpen = true; renderApp(); }
  });
  document.getElementById('export-toggle')?.addEventListener('click', () => {
    exportPanelOpen = !exportPanelOpen;
    renderExportPanel();
  });
  document.getElementById('open-project')?.addEventListener('click', () => document.getElementById('project-file-input')?.click());
  document.getElementById('project-file-input')?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    void openProjectFile(input.files?.[0] ?? null);
    input.value = '';
  });
  document.getElementById('export-panel')?.addEventListener('change', (event) => {
    const input = (event.target as HTMLSelectElement).closest<HTMLSelectElement>('[data-export-field]');
    if (!input) return;
    if (input.dataset.exportField === 'format' && ['png', 'svg', 'html', 'json'].includes(input.value)) exportFormat = input.value as ExportFormat;
    if (input.dataset.exportField === 'scale') exportScale = Math.min(3, Math.max(1, Number(input.value) || 1));
    renderExportPanel();
  });
  document.getElementById('export-panel')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-export-action]');
    if (!button) return;
    const action = button.dataset.exportAction;
    if (action === 'close') { exportPanelOpen = false; renderExportPanel(); return; }
    if (action === 'download' && exportArtifact) { downloadArtifact(exportArtifact); return; }
    if (action === 'run') { void runExport(); return; }
    if (action === 'copy-react') {
      void copyCompiledCode('react', store.selectedId);
      return;
    }
    if (action === 'copy-tailwind') {
      const node = store.getNode(store.selectedId);
      if (node) void navigator.clipboard.writeText(compileNodeToTailwind(node));
    }
  });
  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
    if (event.code === 'Space' && !typing && !event.repeat) {
      event.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (typing) return;
    const cmdKey = event.metaKey || event.ctrlKey;
    if (cmdKey && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      zoomCameraIn();
      applyCamera();
      return;
    }
    if (cmdKey && (event.key === '-' || event.key === '_')) {
      event.preventDefault();
      zoomCameraOut();
      applyCamera();
      return;
    }
    if (cmdKey && event.key === '0') {
      event.preventDefault();
      resetView();
      return;
    }
    if (!cmdKey && event.shiftKey && (event.code === 'Digit1' || event.key === '1')) {
      event.preventDefault();
      zoomToFit();
      return;
    }
    if (!cmdKey && event.shiftKey && (event.code === 'Digit2' || event.key === '2')) {
      event.preventDefault();
      zoomToSelection();
      return;
    }
    if (cmdKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const allIds: string[] = [];
      const collect = (ids: string[]) => {
        for (const id of ids) {
          const n = store.getNode(id);
          if (n && !n.hidden) { allIds.push(id); collect(n.children); }
        }
      };
      collect(store.rootIds);
      if (allIds.length) { store.selectedIds = allIds; }
      renderApp();
      return;
    }
    if (cmdKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      try {
        if (event.shiftKey) redoDocument(); else undoDocument();
        exportError = '';
        renderApp();
      } catch (error) {
        exportError = error instanceof Error ? error.message : String(error);
        exportPanelOpen = true;
        renderApp();
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (store.selectedIds.length) {
        event.preventDefault();
        deleteSelection();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      const selected = store.getNode(store.selectedId);
      if (selected?.parentId) store.select(selected.parentId);
      else if (getCanvasTool() !== 'select') setCanvasTool('select');
      else store.clearSelection();
      return;
    }
    if (!cmdKey && !event.altKey) {
      const tools: Record<string, 'select' | 'hand' | 'frame' | 'rect' | 'text' | 'button'> = {
        v: 'select', h: 'hand', f: 'frame', r: 'rect', t: 'text', b: 'button',
      };
      const next = tools[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        setCanvasTool(next);
        return;
      }
    }
    const arrow = event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (arrow && typing) return;
    if (arrow && store.selectedIds.length) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      nudgeSelection(dx, dy);
      return;
    }
    const step = event.shiftKey ? 120 : 40;
    if (event.code === 'KeyA') { event.preventDefault(); panBy(step, 0); }
    else if (event.code === 'KeyD') { event.preventDefault(); panBy(-step, 0); }
    else if (event.code === 'KeyW') { event.preventDefault(); panBy(0, step); }
    else if (event.code === 'KeyS') { event.preventDefault(); panBy(0, -step); }
    else if (event.code === 'Equal' || event.code === 'NumpadAdd') { event.preventDefault(); zoomCameraIn(); applyCamera(); }
    else if (event.code === 'Minus' || event.code === 'NumpadSubtract') { event.preventDefault(); zoomCameraOut(); applyCamera(); }
    else if (event.code === 'Digit0' || event.code === 'Numpad0' || event.code === 'Home') { event.preventDefault(); resetView(); }
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') setSpaceHeld(false);
  });
  window.addEventListener('blur', () => setSpaceHeld(false));
  document.getElementById('add-reference')?.addEventListener('click', () => document.getElementById('reference-file-input')?.click());
  document.getElementById('reference-file-input')?.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    [...(input.files ?? [])].forEach(addImageFile);
    input.value = '';
  });
  document.addEventListener('paste', (event) => {
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return;
    const item = [...(event.clipboardData?.items ?? [])].find((candidate) => candidate.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!file) return;
    event.preventDefault();
    addImageFile(file);
  });
  installCanvasNavigation();
  applyTheme(theme);
  renderApp();
  requestAnimationFrame(() => {
    zoomToFit();
  });
}
