import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { createNode, moveNodes, resetDocument } from '../src/tools';
import { serializeHtml, serializeSvg } from '../src/exporter';
import { resolveSizingStyles, sizingStylesForNode } from '../src/layout';
import { store } from '../src/store';
import type { DesignNode } from '../src/types';

beforeEach(() => resetDocument());

function flexChild(overrides: Partial<DesignNode> = {}): { parent: DesignNode; child: DesignNode } {
  const parent: DesignNode = {
    id: 'parent',
    name: 'Parent',
    kind: 'frame',
    parentId: null,
    children: ['child'],
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    layout: 'flex-row',
    style: {},
  };
  const child: DesignNode = {
    id: 'child',
    name: 'Child',
    kind: 'frame',
    parentId: 'parent',
    children: [],
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    widthSizing: 'fixed',
    heightSizing: 'fixed',
    style: {},
    ...overrides,
  };
  return { parent, child };
}

describe('R1 sizing styles', () => {
  test('fixed main axis pins flex basis and does not shrink', () => {
    const { parent, child } = flexChild();
    assert.deepEqual(sizingStylesForNode(child, parent, 'width'), {
      width: '120px',
      flex: '0 0 120px',
      flexShrink: '0',
    });
    assert.deepEqual(sizingStylesForNode(child, parent, 'height'), { height: '80px' });
  });

  test('hug is fit-content on boxes, auto plus inline-block on text width', () => {
    assert.deepEqual(resolveSizingStyles({
      axis: 'width', intent: 'hug', value: 100, kind: 'frame', isFlexChild: false, isMainAxis: false,
    }), { width: 'fit-content' });
    assert.deepEqual(resolveSizingStyles({
      axis: 'height', intent: 'hug', value: 20, kind: 'text', isFlexChild: false, isMainAxis: false,
    }), { height: 'auto' });
    assert.deepEqual(resolveSizingStyles({
      axis: 'width', intent: 'hug', value: 90, kind: 'text', isFlexChild: false, isMainAxis: false,
    }), { width: 'auto', display: 'inline-block' });
  });

  test('hug on a flex main axis does not grow', () => {
    const { parent, child } = flexChild({ kind: 'text', widthSizing: 'hug', heightSizing: 'hug' });
    assert.deepEqual(sizingStylesForNode(child, parent, 'width'), {
      width: 'auto',
      display: 'inline-block',
      flex: '0 0 auto',
    });
  });

  test('fill is 100% in freeform and flex 1 1 0% on the main axis', () => {
    const { parent, child } = flexChild({ widthSizing: 'fill', heightSizing: 'fill' });
    assert.deepEqual(sizingStylesForNode(child, parent, 'width'), { flex: '1 1 0%', width: 'auto' });
    assert.deepEqual(sizingStylesForNode(child, parent, 'height'), { height: '100%', alignSelf: 'stretch' });
    assert.deepEqual(resolveSizingStyles({
      axis: 'width', intent: 'fill', value: 10, kind: 'frame', isFlexChild: false, isMainAxis: false,
    }), { width: '100%' });
  });

  test('a column parent swaps which axis is the main axis', () => {
    const { parent, child } = flexChild({ widthSizing: 'fill', heightSizing: 'fill' });
    parent.layout = 'flex-column';
    assert.deepEqual(sizingStylesForNode(child, parent, 'width'), { width: '100%', alignSelf: 'stretch' });
    assert.deepEqual(sizingStylesForNode(child, parent, 'height'), { flex: '1 1 0%', height: 'auto' });
  });
});

describe('seeded document layout', () => {
  test('flow children keep authored x/y at 0', () => {
    const column = store.getNode('col-elements');
    assert.equal(column?.x, 0);
    assert.equal(column?.y, 0);
    assert.equal(store.getNode('main-hero')?.x, 0);
  });

  test('layout solver places columns at distinct local x', () => {
    const first = store.resolvedBounds(store.getNode('main-hero')!);
    const second = store.resolvedBounds(store.getNode('col-elements')!);
    assert.ok(first.x >= 0);
    assert.ok(second.x > first.x + 100);
  });

  test('world origin includes the parent border', () => {
    const artboard = store.getNode('artboard-main')!;
    const column = store.getNode('main-hero')!;
    const origin = store.worldOrigin(column);
    const local = store.resolvedBounds(column);
    assert.equal(origin.x, artboard.x + 1 + local.x);
    assert.equal(origin.y, artboard.y + 1 + local.y);
  });
});

describe('create, move, and layout switch', () => {
  test('new frames stay freeform', () => {
    const frame = createNode({ kind: 'frame', x: 40, y: 40, width: 280, height: 180 });
    const node = store.getNode(frame.id)!;
    assert.equal(node.layout ?? 'absolute', 'absolute');
  });

  test('create in a flex parent keeps the drawn size as fixed', () => {
    const created = createNode({ kind: 'text', parentId: 'artboard-main', x: 20, y: 20, width: 160, height: 32 });
    const node = store.getNode(created.id)!;
    assert.equal(node.x, 0);
    assert.equal(node.y, 0);
    assert.equal(node.widthSizing, 'fixed');
    assert.equal(node.heightSizing, 'fixed');
    assert.equal(node.width, 160);
    assert.equal(node.height, 32);
  });

  test('resize freezes the measured size to fixed', () => {
    store.updateNodeProp('main-hero', 'heightSizing', 'fill');
    assert.equal(store.getNode('main-hero')?.heightSizing, 'fill');
    store.updateGeometry('main-hero', { width: 300, height: 400 });
    const next = store.getNode('main-hero')!;
    assert.equal(next.widthSizing, 'fixed');
    assert.equal(next.heightSizing, 'fixed');
    assert.equal(next.width, 300);
    assert.equal(next.height, 400);
    assert.equal(next.x, 0);
  });

  test('moving a flex child reorders siblings instead of writing x/y', () => {
    const parent = store.getNode('artboard-main')!;
    const before = [...parent.children];
    const index = before.indexOf('col-elements');
    assert.ok(index > 0);
    moveNodes({ nodeIds: ['col-elements'], dx: -40, dy: 0 });
    const after = store.getNode('artboard-main')!.children;
    assert.equal(store.getNode('col-elements')?.x, 0);
    assert.equal(after.indexOf('col-elements'), index - 1);
    assert.notDeepEqual(after, before);
  });

  test('switching a row to freeform snapshots measured boxes onto children', () => {
    const child = store.getNode('col-elements')!;
    const measured = store.resolvedBounds(child);
    store.updateNodeProp('artboard-main', 'layout', 'absolute');
    const snapped = store.getNode('col-elements')!;
    assert.equal(snapped.widthSizing, 'fixed');
    assert.equal(snapped.heightSizing, 'fixed');
    assert.equal(snapped.x, measured.x);
    assert.equal(snapped.y, measured.y);
    assert.equal(snapped.width, measured.width);
    assert.equal(snapped.height, measured.height);
  });
});

describe('export uses measured flex layout', () => {
  test('SVG of the main artboard is not stacked at translate(0 0)', () => {
    const svg = serializeSvg(store.getNode('artboard-main')!);
    const translates = [...svg.matchAll(/translate\(([-0-9.]+) ([-0-9.]+)\)/g)].map((match) => `${match[1]},${match[2]}`);
    const unique = new Set(translates);
    assert.ok(unique.size > 7, `expected distinct flex positions, got ${unique.size}: ${[...unique].join(' | ')}`);
    assert.equal(translates.filter((value) => value === '0,0').length < translates.length, true);
  });

  test('HTML export emits flex, gap, and pinned sizing instead of dead left/top', () => {
    const html = serializeHtml(store.getNode('artboard-main')!);
    assert.match(html, /display:flex/);
    assert.match(html, /flex-direction:row/);
    assert.match(html, /flex:0 0 264px/);
    assert.match(html, /flex-shrink:0/);
    const col = html.split('data-node-id="col-elements"')[1] ?? '';
    assert.equal(/left:312px/.test(col.slice(0, 200)), false);
  });
});
