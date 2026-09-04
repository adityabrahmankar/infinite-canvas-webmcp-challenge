import type { DesignNode, LayoutBounds, LayoutMode, SizingMode } from './types';

export type SizingAxis = 'width' | 'height';

export function isFlexLayout(layout: LayoutMode | undefined): boolean {
  return layout === 'flex-row' || layout === 'flex-column';
}

export function isRowLayout(layout: LayoutMode | undefined): boolean {
  return layout === 'flex-row';
}

export function isFlexParent(node: DesignNode | undefined): boolean {
  return !!node && isFlexLayout(node.layout);
}

export function isFlexChildOf(node: DesignNode, parent: DesignNode | undefined): boolean {
  return !!parent && isFlexLayout(parent.layout);
}

export function borderWidthOf(node: DesignNode): number {
  const value = node.style.border;
  if (!value || value.toLowerCase() === 'none') return 0;
  const parsed = Number(value.match(/(\d+(?:\.\d+)?)px/i)?.[1] ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function paddingOf(node: DesignNode): number {
  return Math.max(0, node.style.padding ?? 0);
}

/**
 * Infinite Canvas R1 sizing: Fixed pins the flex basis, Hug does not grow,
 * Fill is flex 1 1 0% on the main axis and 100% everywhere else.
 */
export function resolveSizingStyles(context: {
  axis: SizingAxis;
  intent: SizingMode;
  value: number;
  kind: DesignNode['kind'];
  isFlexChild: boolean;
  isMainAxis: boolean;
}): Record<string, string> {
  const { axis, intent, value, kind, isFlexChild, isMainAxis } = context;
  const styles: Record<string, string> = {};

  if (intent === 'fill') {
    if (isFlexChild && isMainAxis) {
      styles.flex = '1 1 0%';
      styles[axis] = 'auto';
    } else {
      styles[axis] = '100%';
      if (isFlexChild) styles.alignSelf = 'stretch';
    }
    return styles;
  }

  if (intent === 'hug') {
    styles[axis] = kind === 'text' ? 'auto' : 'fit-content';
    if (kind === 'text' && axis === 'width') styles.display = 'inline-block';
    if (isFlexChild && isMainAxis) styles.flex = '0 0 auto';
    return styles;
  }

  const length = `${Math.max(0, value)}px`;
  styles[axis] = length;
  if (isFlexChild && isMainAxis) {
    styles.flex = `0 0 ${length}`;
    styles.flexShrink = '0';
  }
  return styles;
}

export function sizingStylesForNode(
  node: DesignNode,
  parent: DesignNode | undefined,
  axis: SizingAxis,
): Record<string, string> {
  const inFlex = isFlexChildOf(node, parent);
  const row = isRowLayout(parent?.layout);
  const isMainAxis = inFlex && (axis === 'width' ? row : !row);
  const intent = (axis === 'width' ? node.widthSizing : node.heightSizing) ?? 'fixed';
  const value = axis === 'width' ? node.width : node.height;
  return resolveSizingStyles({
    axis,
    intent,
    value,
    kind: node.kind,
    isFlexChild: inFlex,
    isMainAxis,
  });
}

function writeStyles(element: HTMLElement, styles: Record<string, string>): void {
  for (const [key, value] of Object.entries(styles)) {
    element.style.setProperty(key === 'flexShrink' ? 'flex-shrink' : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value);
  }
}

export function applyLayoutToElement(element: HTMLElement, node: DesignNode, parent?: DesignNode): void {
  element.style.flex = '';
  element.style.flexShrink = '';
  element.style.alignSelf = '';
  const inFlex = isFlexChildOf(node, parent);

  if (inFlex) {
    element.style.position = 'relative';
    element.style.left = '';
    element.style.top = '';
    writeStyles(element, sizingStylesForNode(node, parent, 'width'));
    writeStyles(element, sizingStylesForNode(node, parent, 'height'));
  } else {
    element.style.position = 'absolute';
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    writeStyles(element, sizingStylesForNode(node, parent, 'width'));
    writeStyles(element, sizingStylesForNode(node, parent, 'height'));
  }

  if (isFlexLayout(node.layout)) {
    element.style.display = 'flex';
    element.style.flexDirection = isRowLayout(node.layout) ? 'row' : 'column';
    element.style.gap = node.gap !== undefined ? `${node.gap}px` : '';
  } else if (!inFlex) {
    element.style.flexDirection = '';
    element.style.gap = '';
  }

  element.style.overflow = node.clipContent === true ? 'hidden' : 'visible';
}

export function sizingTailwindClasses(node: DesignNode, parent?: DesignNode): string[] {
  const classes: string[] = [];
  const inFlex = isFlexChildOf(node, parent);
  const row = isRowLayout(parent?.layout);
  const axes: Array<{ axis: SizingAxis; intent: SizingMode; value: number; isMain: boolean; prefix: 'w' | 'h' }> = [
    { axis: 'width', intent: node.widthSizing ?? 'fixed', value: node.width, isMain: inFlex && row, prefix: 'w' },
    { axis: 'height', intent: node.heightSizing ?? 'fixed', value: node.height, isMain: inFlex && !row, prefix: 'h' },
  ];
  for (const item of axes) {
    if (item.intent === 'fill') {
      if (inFlex && item.isMain) classes.push('flex-[1_1_0%]');
      else {
        classes.push(`${item.prefix}-full`);
        if (inFlex) classes.push('self-stretch');
      }
    } else if (item.intent === 'hug') {
      if (inFlex && item.isMain) classes.push('flex-none');
      classes.push(node.kind === 'text' && item.axis === 'width' ? `${item.prefix}-auto` : `${item.prefix}-fit`);
    } else {
      if (inFlex && item.isMain) classes.push(`flex-[0_0_${Math.round(item.value)}px]`, 'shrink-0');
      classes.push(`${item.prefix}-[${Math.round(item.value)}px]`);
    }
  }
  return classes;
}

export function htmlLayoutDeclarations(node: DesignNode, parent: DesignNode | undefined, isRoot: boolean): string[] {
  const declarations: string[] = ['box-sizing:border-box'];
  const inFlex = isFlexChildOf(node, parent);
  if (isRoot) declarations.push('position:relative');
  else if (inFlex) declarations.push('position:relative');
  else {
    declarations.push('position:absolute', `left:${Math.round(node.x)}px`, `top:${Math.round(node.y)}px`);
  }

  const apply = (axis: SizingAxis) => {
    const styles = sizingStylesForNode(node, parent, axis);
    for (const [key, value] of Object.entries(styles)) {
      const cssKey = key === 'flexShrink' ? 'flex-shrink' : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      declarations.push(`${cssKey}:${value}`);
    }
  };
  apply('width');
  apply('height');

  if (isFlexLayout(node.layout)) {
    declarations.push('display:flex');
    declarations.push(`flex-direction:${isRowLayout(node.layout) ? 'row' : 'column'}`);
    if ((node.gap ?? 0) > 0) declarations.push(`gap:${node.gap}px`);
  }
  declarations.push(`overflow:${node.clipContent === true ? 'hidden' : 'visible'}`);
  return declarations;
}

function visibleChildren(parent: DesignNode, nodes: Map<string, DesignNode>): DesignNode[] {
  return parent.children
    .map((id) => nodes.get(id))
    .filter((child): child is DesignNode => !!child && !child.hidden);
}

/**
 * Approximate flex layout when the browser has not measured yet.
 * Hug uses the authored box; Fill splits leftover space on the main axis.
 */
export function computeLayoutBounds(nodes: Map<string, DesignNode>, rootIds: string[]): Map<string, LayoutBounds> {
  const bounds = new Map<string, LayoutBounds>();

  const visit = (node: DesignNode, parent?: DesignNode): void => {
    if (!parent || !isFlexLayout(parent.layout)) {
      bounds.set(node.id, { x: node.x, y: node.y, width: Math.max(1, node.width), height: Math.max(1, node.height) });
    }
    if (isFlexLayout(node.layout)) layoutFlex(node);
    else {
      for (const child of visibleChildren(node, nodes)) visit(child, node);
    }
  };

  const layoutFlex = (parent: DesignNode): void => {
    const box = bounds.get(parent.id) ?? { x: parent.x, y: parent.y, width: parent.width, height: parent.height };
    const pad = paddingOf(parent);
    const border = borderWidthOf(parent);
    const innerW = Math.max(0, box.width - border * 2 - pad * 2);
    const innerH = Math.max(0, box.height - border * 2 - pad * 2);
    const row = isRowLayout(parent.layout);
    const kids = visibleChildren(parent, nodes);
    const gap = parent.gap ?? 0;
    const mainInner = row ? innerW : innerH;
    const items = kids.map((child) => {
      const widthIntent = child.widthSizing ?? 'fixed';
      const heightIntent = child.heightSizing ?? 'fixed';
      return {
        child,
        fillMain: (row ? widthIntent : heightIntent) === 'fill',
        fillCross: (row ? heightIntent : widthIntent) === 'fill',
        main: row ? child.width : child.height,
        cross: row ? child.height : child.width,
      };
    });
    let used = 0;
    items.forEach((item, index) => {
      used += index > 0 ? gap : 0;
      if (!item.fillMain) used += Math.max(0, item.main);
    });
    const fillCount = items.filter((item) => item.fillMain).length;
    const fillMain = fillCount ? Math.max(0, (mainInner - used) / fillCount) : 0;
    const crossInner = row ? innerH : innerW;
    let cursor = pad;
    for (const item of items) {
      const main = item.fillMain ? fillMain : Math.max(1, item.main);
      const cross = item.fillCross ? crossInner : Math.max(1, item.cross);
      const width = row ? main : cross;
      const height = row ? cross : main;
      const x = row ? cursor : pad;
      const y = row ? pad : cursor;
      bounds.set(item.child.id, { x, y, width, height });
      cursor += main + gap;
      visit(item.child, parent);
    }
  };

  for (const id of rootIds) {
    const root = nodes.get(id);
    if (root && !root.hidden) visit(root);
  }
  return bounds;
}
