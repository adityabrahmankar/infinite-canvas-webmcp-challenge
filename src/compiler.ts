import { isFlexLayout, sizingTailwindClasses } from './layout';
import { store } from './store';
import type { DesignNode } from './types';

export type CodeExportFormat = 'tailwind' | 'react';

function childrenOf(node: DesignNode): DesignNode[] {
  return node.children
    .map((id) => store.getNode(id))
    .filter((child): child is DesignNode => !!child && !child.hidden);
}

function escapeJsxText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('{', '&#123;')
    .replaceAll('}', '&#125;');
}

function escapeHtmlAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function fontWeightClass(weight: number | undefined): string | null {
  if (!weight) return null;
  if (weight >= 700) return 'font-bold';
  if (weight >= 600) return 'font-semibold';
  if (weight >= 500) return 'font-medium';
  return null;
}

function borderClasses(border: string | undefined): string[] {
  if (!border || border.toLowerCase() === 'none') return [];
  const width = border.match(/(\d+(?:\.\d+)?)px/i)?.[1];
  const color = border.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))/i)?.[1];
  const classes: string[] = [];
  if (width) classes.push(`border-[${width}px]`);
  if (color) classes.push(`border-[${color}]`);
  return classes;
}

function compileClasses(node: DesignNode, isRoot = false): string {
  const style = node.style;
  const classes: string[] = [];
  const parent = node.parentId ? store.getNode(node.parentId) : undefined;
  const inFlex = isFlexLayout(parent?.layout);

  if (isRoot || inFlex) {
    classes.push('relative');
  } else {
    classes.push('absolute', `left-[${Math.round(node.x)}px]`, `top-[${Math.round(node.y)}px]`);
  }

  if (isFlexLayout(node.layout)) {
    classes.push('flex');
    if (node.layout === 'flex-column') classes.push('flex-col');
    if (node.gap !== undefined && node.gap > 0) classes.push(`gap-[${node.gap}px]`);
  }
  if (node.clipContent === true) classes.push('overflow-hidden');

  classes.push(...sizingTailwindClasses(node, parent));

  if (style.padding !== undefined && style.padding > 0) classes.push(`p-[${style.padding}px]`);

  if (style.background && style.background !== 'transparent') {
    classes.push(`bg-[${style.background}]`);
  }

  borderClasses(style.border).forEach((cls) => classes.push(cls));

  if (style.borderRadius !== undefined && style.borderRadius > 0) {
    classes.push(`rounded-[${style.borderRadius}px]`);
  }

  if (style.opacity !== undefined && style.opacity < 1) {
    classes.push(`opacity-[${style.opacity}]`);
  }

  if (node.kind === 'text' || node.kind === 'button' || node.kind === 'rect') {
    if (style.fontSize) classes.push(`text-[${style.fontSize}px]`);
    const fw = fontWeightClass(style.fontWeight);
    if (fw) classes.push(fw);
    if (style.color) classes.push(`text-[${style.color}]`);
    if (style.fontFamily) classes.push(`font-['${style.fontFamily.replace(/'/g, '')}']`);
    if (style.letterSpacing) classes.push(`tracking-[${style.letterSpacing}]`);
    if (node.kind === 'text') classes.push('whitespace-pre-wrap');
    if (node.kind === 'button' || node.kind === 'rect') {
      classes.push('flex', 'items-center', 'justify-center', 'text-center');
    }
  }

  if (node.kind === 'image') classes.push('overflow-hidden');

  return classes.join(' ');
}

function componentName(node: DesignNode): string {
  const base = node.name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
  ).join('');
  return base.match(/^[A-Z]/) ? base : `Layer${base}`;
}

function nodeText(node: DesignNode): string {
  return node.text ?? (node.kind === 'button' ? 'Button' : '');
}

export function compileNodeToTailwind(node: DesignNode): string {
  return compileClasses(node, !node.parentId);
}

export function compileNodeToReact(node: DesignNode, depth = 0, isRoot = !node.parentId): string {
  const indent = '  '.repeat(depth);
  const classes = compileClasses(node, isRoot);
  const children = childrenOf(node);

  if (node.kind === 'text') {
    return `${indent}<div className="${classes}">${escapeJsxText(nodeText(node))}</div>`;
  }

  if (node.kind === 'button') {
    return `${indent}<button type="button" className="${classes}">${escapeJsxText(nodeText(node))}</button>`;
  }

  if (node.kind === 'image') {
    const src = node.imageSrc ?? '';
    return `${indent}<img className="${classes}" src="${escapeJsxText(src)}" alt="${escapeJsxText(node.name)}" />`;
  }

  if (node.kind === 'rect' && nodeText(node)) {
    return `${indent}<div className="${classes}">${escapeJsxText(nodeText(node))}</div>`;
  }

  if (children.length === 0) {
    return `${indent}<div className="${classes}" />`;
  }

  const childJsx = children.map((child) => compileNodeToReact(child, depth + 1, false)).join('\n');
  return `${indent}<div className="${classes}">\n${childJsx}\n${indent}</div>`;
}

export function compileNodeToReactComponent(node: DesignNode): string {
  const name = componentName(node);
  const body = compileNodeToReact(node, 2, true);
  return `export function ${name}() {\n  return (\n${body}\n  );\n}`;
}

function compileHtmlNode(node: DesignNode, depth = 0, isRoot = !node.parentId): string {
  const indent = '  '.repeat(depth);
  const classes = compileClasses(node, isRoot);
  const children = childrenOf(node);
  const classAttr = `class="${escapeHtmlAttr(classes)}"`;

  if (node.kind === 'text') {
    return `${indent}<div ${classAttr}>${escapeJsxText(nodeText(node))}</div>`;
  }
  if (node.kind === 'button') {
    return `${indent}<button type="button" ${classAttr}>${escapeJsxText(nodeText(node))}</button>`;
  }
  if (node.kind === 'image') {
    const src = escapeHtmlAttr(node.imageSrc ?? '');
    return `${indent}<img ${classAttr} src="${src}" alt="${escapeHtmlAttr(node.name)}" />`;
  }
  if (node.kind === 'rect' && nodeText(node)) {
    return `${indent}<div ${classAttr}>${escapeJsxText(nodeText(node))}</div>`;
  }
  if (children.length === 0) {
    return `${indent}<div ${classAttr}></div>`;
  }
  const childHtml = children.map((child) => compileHtmlNode(child, depth + 1, false)).join('\n');
  return `${indent}<div ${classAttr}>\n${childHtml}\n${indent}</div>`;
}

export function compileNodeToTailwindHtml(node: DesignNode): string {
  return compileHtmlNode(node, 0, true);
}

export function compileSelection(format: CodeExportFormat, nodeId: string | null): string {
  const node = store.getNode(nodeId);
  if (!node) return '// Select a layer to view code.';
  if (format === 'react') return compileNodeToReactComponent(node);
  return compileNodeToTailwindHtml(node);
}

export async function copyCompiledCode(format: CodeExportFormat, nodeId: string | null): Promise<boolean> {
  const code = compileSelection(format, nodeId);
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(code);
  return true;
}
