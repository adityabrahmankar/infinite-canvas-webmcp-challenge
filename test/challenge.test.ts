import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  addReferenceImage,
  applyDesignStyles,
  capturePreview,
  createNode,
  createTree,
  deleteNodes,
  findNodes,
  getDesignTree,
  handleChallengeTool,
  inspectReferenceImage,
  inspectCanvas,
  moveNodes,
  recreateFromReference,
  listReferenceImages,
  resetDocument,
  resizeNode,
  redoDocument,
  selectNodes,
  setDesignText,
  setLayout,
  undoDocument,
} from '../src/tools';
import { exportDesign, parseProject } from '../src/exporter';
import {
  compileNodeToReactComponent,
  compileNodeToTailwind,
  compileNodeToTailwindHtml,
  compileSelection,
} from '../src/compiler';
import { store } from '../src/store';
import { TOOL_NAMES, TOOL_SCHEMAS } from '../src/webmcp';
import { mergeDocumentImages, parsePersistedDocument, serializePersistedDocument, splitDocumentImages } from '../src/persist';

beforeEach(() => resetDocument());

describe('Infinite Canvas WebMCP surface', () => {
  test('starts from a deterministic seeded canvas', () => {
    const inspected = inspectCanvas();
    assert.equal((inspected.selected as { id: string }).id, 'artboard-main');
    assert.equal((inspected.artboards as Array<{ id: string }>).length, 1);
    const tree = getDesignTree({});
    assert.equal((tree.root as { id: string }).id, 'artboard-main');
  });

  test('supports basic text and style mutation', () => {
    const text = setDesignText({ nodeId: 'hero-title', text: 'A safer way to explore ideas.' });
    assert.equal(text.text, 'A safer way to explore ideas.');
    const styled = applyDesignStyles({ nodeId: 'hero-title', styles: { color: '#f59e0b', fontSize: 32 } });
    assert.equal((styled.style as { color: string }).color, '#f59e0b');
    assert.equal((styled.style as { fontSize: number }).fontSize, 32);
  });

  test('keeps a reference image inspectable and creates an editable recreation', async () => {
    const added = addReferenceImage({ name: 'reference.png', dataUrl: 'data:image/png;base64,AAAA', width: 640, height: 480, operationId: 'reference-once' });
    const duplicate = addReferenceImage({ name: 'different.png', dataUrl: 'data:image/png;base64,AAAA', operationId: 'reference-once' });
    assert.equal(duplicate.referenceId, added.referenceId);
    const listed = listReferenceImages();
    assert.equal((listed.references as Array<{ referenceId: string }>).length, 1);
    const inspected = inspectReferenceImage({ referenceId: added.referenceId });
    assert.equal(inspected.dataUrl, 'data:image/png;base64,AAAA');
    const tool = await handleChallengeTool('inspect_reference_image', { referenceId: added.referenceId });
    assert.equal(tool.content.some((entry) => entry.type === 'image'), true);
    const recreation = recreateFromReference({ referenceId: added.referenceId, name: 'Reference direction' });
    const tree = getDesignTree({ rootNodeId: recreation.recreationNodeId });
    assert.equal((tree.root as { kind: string }).kind, 'frame');
    assert.equal((tree.root as { children: unknown[] }).children.length, 5);
    assert.equal((inspectCanvas().references as unknown[]).length, 1);
  });

  test('exports deterministic SVG, HTML, and reopenable project JSON', async () => {
    const svg = await exportDesign({ format: 'svg' });
    const svgAgain = await exportDesign({ format: 'svg' });
    assert.equal(svg.checksum, svgAgain.checksum);
    assert.match(svg.data, /^<svg /);
    assert.match(svg.data, /Design with an agent/);

    const html = await exportDesign({ format: 'html' });
    assert.match(html.data, /^<!doctype html>/i);
    assert.match(html.data, /canvas-node/);

    const project = await exportDesign({ format: 'json' });
    const parsed = parseProject(project.data);
    assert.equal(parsed.rootIds.length, 1);
    assert.equal(parsed.nodes.length, store.nodes.size);
    assert.equal(project.revision, store.revision);
  });

  test('undoes and redoes normal document edits', () => {
    setDesignText({ nodeId: 'hero-title', text: 'Undo me.' });
    assert.equal(store.getNode('hero-title')?.text, 'Undo me.');
    const undone = undoDocument();
    assert.equal(undone.undone, true);
    assert.equal(store.getNode('hero-title')?.text, 'Design with an agent. Keep the final say.');
    const redone = redoDocument();
    assert.equal(redone.redone, true);
    assert.equal(store.getNode('hero-title')?.text, 'Undo me.');
  });

  test('imports a project JSON export after a reset', async () => {
    setDesignText({ nodeId: 'hero-title', text: 'Persist this.' });
    const project = await exportDesign({ format: 'json' });
    resetDocument();
    const imported = await handleChallengeTool('import_project', { projectJson: project.data });
    assert.equal(imported.isError, undefined);
    assert.equal(store.getNode('hero-title')?.text, 'Persist this.');
    assert.equal((imported.structuredContent as { imported: boolean }).imported, true);
  });

  test('exposes a focused WebMCP registry for the canvas workflow', async () => {
    assert.equal(TOOL_NAMES.length, 22);
    assert.deepEqual(TOOL_NAMES.slice(-3), ['import_project', 'export_design', 'reset_document']);
    assert.equal((TOOL_SCHEMAS.export_design.properties as Record<string, unknown>).format !== undefined, true);
    assert.equal((TOOL_SCHEMAS.import_project.properties as Record<string, unknown>).projectJson !== undefined, true);

    const result = await handleChallengeTool('export_design', { format: 'svg', operationId: 'tool-export-once' });
    assert.equal(result.isError, undefined);
    const metadata = result.structuredContent as Record<string, unknown>;
    assert.equal(metadata.format, 'svg');
    assert.equal('data' in metadata, false);
    const duplicate = await handleChallengeTool('export_design', { format: 'svg', operationId: 'tool-export-once' });
    assert.deepEqual(duplicate.structuredContent, metadata);
  });

  test('rejects stale and cancelled exports without changing the document', async () => {
    const revision = store.revision;
    const stale = await handleChallengeTool('export_design', { format: 'json', baseRevision: revision + 1 });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0].text, /STALE_REVISION/);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await handleChallengeTool('export_design', { format: 'svg' }, controller.signal);
    assert.equal(cancelled.isError, true);
    assert.match(cancelled.content[0].text, /Export cancelled/);
    assert.equal(store.revision, revision);
  });

  test('keeps local reference images in project exports', async () => {
    const reference = addReferenceImage({ name: 'reference.png', dataUrl: 'data:image/png;base64,AAAA', width: 320, height: 240 });
    store.select('artboard-main');
    const project = await exportDesign({ format: 'json' });
    const parsed = parseProject(project.data);
    assert.equal(parsed.nodes.some((node) => node.id === reference.referenceId), true);
  });

  test('resets the document through the reset_document tool', async () => {
    setDesignText({ nodeId: 'hero-title', text: 'Temporary edit.' });
    const reset = await handleChallengeTool('reset_document');
    assert.equal(reset.isError, undefined);
    assert.equal(store.getNode('hero-title')?.text, 'Design with an agent. Keep the final say.');
  });

  test('creates frames, text, and buttons from scratch', () => {
    const frame = createNode({ kind: 'frame', x: 40, y: 40, width: 280, height: 180, name: 'New artboard' });
    assert.equal(frame.kind, 'frame');
    assert.equal(store.getNode(frame.id)?.parentId, null);
    const button = createNode({ kind: 'button', parentId: frame.id, x: 24, y: 24, width: 120, height: 36, text: 'Go' });
    assert.equal(button.parentId, frame.id);
    assert.equal(store.getNode(button.id)?.text, 'Go');
    const text = createNode({ kind: 'text', parentId: 'artboard-main', x: 20, y: 20 });
    assert.equal(text.kind, 'text');
    assert.equal(store.artboardOf(store.getNode(text.id)!).id, 'artboard-main');
  });

  test('moves and resizes parent frames without detaching children', () => {
    const originalX = store.getNode('artboard-main')!.x;
    const childX = store.getNode('hero-title')!.x;
    const moved = moveNodes({ nodeIds: ['artboard-main'], dx: 40, dy: -12 });
    assert.equal((moved.moved as Array<{ x: number }>)[0].x, originalX + 40);
    assert.equal(store.getNode('hero-title')?.x, childX);
    const resized = resizeNode({ nodeId: 'artboard-main', width: 720, height: 500 });
    assert.equal(resized.width, 720);
    assert.equal(resized.height, 500);
    assert.equal(store.getNode('hero-title')?.parentId, 'main-hero');
  });

  test('selects multiple frames and deletes parent layers', () => {
    const extra = createNode({ kind: 'frame', x: 1900, y: 40, width: 280, height: 180, name: 'Extra Frame' });
    selectNodes({ nodeIds: ['artboard-main', extra.id] });
    assert.deepEqual(store.selectedIds, ['artboard-main', extra.id]);
    const deleted = deleteNodes({ nodeIds: ['artboard-main', extra.id] });
    assert.equal((deleted.deleted as string[]).includes('artboard-main'), true);
    assert.equal((deleted.deleted as string[]).includes('hero-title'), true);
    assert.equal(store.getNode('artboard-main'), undefined);
    assert.equal(store.getNode(extra.id), undefined);
    const leftover = createNode({ kind: 'frame', x: 10, y: 10, width: 200, height: 120 });
    deleteNodes({ nodeId: leftover.id });
    assert.equal(store.getNode(leftover.id), undefined);
  });

  test('compiles live Tailwind and React code for the selected layer', () => {
    const node = store.getNode('artboard-main');
    assert.ok(node);
    const classes = compileNodeToTailwind(node!);
    assert.match(classes, /w-\[1760px\]/);
    assert.match(classes, /bg-\[#f8f9fa\]/i);

    const react = compileNodeToReactComponent(node!);
    assert.match(react, /export function/);
    assert.match(react, /className="/);
    assert.match(react, /Design with an agent/);

    const html = compileNodeToTailwindHtml(node!);
    assert.match(html, /<div class="/);

    applyDesignStyles({ nodeId: 'hero-title', styles: { color: '#f59e0b' } });
    const updated = compileSelection('react', 'artboard-main');
    assert.match(updated, /text-\[#f59e0b\]/);
  });

  test('creates a nested component tree atomically via create_tree and create_component alias', async () => {
    const result = await handleChallengeTool('create_tree', {
      root: {
        kind: 'frame',
        name: 'Pricing Card',
        width: 320,
        height: 400,
        layout: 'flex-column',
        gap: 16,
        padding: 24,
        styles: { fill: '#ffffff', borderRadius: 12 },
        children: [
          { kind: 'text', name: 'Plan Title', text: 'Enterprise', styles: { fontSize: '24px', fontWeight: 'bold' } },
          { kind: 'button', name: 'CTA', text: 'Contact Sales', styles: { fill: '#2563eb', textColor: '#ffffff' } },
        ],
      },
    });
    assert.equal(result.isError, undefined);
    const content = result.structuredContent as { rootNodeId: string; createdNodeIds: string[]; nodeCount: number };
    assert.equal(content.nodeCount, 3);
    const root = store.getNode(content.rootNodeId);
    assert.ok(root);
    assert.equal(root?.name, 'Pricing Card');
    assert.equal(root?.layout, 'flex-column');
    assert.equal(root?.gap, 16);
    assert.equal(root?.style?.padding, 24);
    assert.equal(root?.style?.background, '#ffffff');
    assert.equal(root?.children.length, 2);

    const title = store.getNode(root!.children[0]!);
    assert.equal(title?.text, 'Enterprise');
    assert.equal(title?.style?.fontSize, 24);
    assert.equal(title?.style?.fontWeight, 700);

    const btn = store.getNode(root!.children[1]!);
    assert.equal(btn?.text, 'Contact Sales');
    assert.equal(btn?.style?.background, '#2563eb');
    assert.equal(btn?.style?.color, '#ffffff');

    // Test alias create_component
    const aliased = await handleChallengeTool('create_component', {
      root: { kind: 'frame', name: 'Badge', width: 80, height: 28, children: [{ kind: 'text', text: 'New' }] },
    });
    assert.equal(aliased.isError, undefined);
  });

  test('adjusts flexbox auto-layout via set_layout tool', async () => {
    const frame = createNode({ kind: 'frame', name: 'Layout Container', width: 400, height: 200 });
    const result = await handleChallengeTool('set_layout', {
      nodeId: frame.id,
      layout: 'flex-row',
      gap: 16,
      padding: 24,
      widthSizing: 'fill',
      heightSizing: 'hug',
    });
    assert.equal(result.isError, undefined);
    const updated = store.getNode(frame.id);
    assert.equal(updated?.layout, 'flex-row');
    assert.equal(updated?.gap, 16);
    assert.equal(updated?.style?.padding, 24);
    assert.equal(updated?.widthSizing, 'fill');
    assert.equal(updated?.heightSizing, 'hug');
  });

  test('normalizes CSS aliases and string units via forgiving style parser', () => {
    applyDesignStyles({
      nodeId: 'hero-title',
      styles: {
        fill: '#0f172a',
        textColor: '#38bdf8',
        fontSize: '28px',
        fontWeight: 'bold',
        borderColor: '#94a3b8',
        borderWidth: '2px',
        letterSpacing: '0.05em',
      },
    });
    const node = store.getNode('hero-title');
    assert.equal(node?.style?.background, '#0f172a');
    assert.equal(node?.style?.color, '#38bdf8');
    assert.equal(node?.style?.fontSize, 28);
    assert.equal(node?.style?.fontWeight, 700);
    assert.equal(node?.style?.border, '2px solid #94a3b8');
    assert.equal(node?.style?.letterSpacing, '0.05em');
  });

  test('discovers nodes by query and limits tree depth for compact discovery', async () => {
    const found = await handleChallengeTool('find_nodes', { query: 'hero', kind: 'text' });
    assert.equal(found.isError, undefined);
    const content = found.structuredContent as { nodes: Array<{ id: string; name: string }>; count: number };
    assert.ok(content.count >= 1);
    assert.ok(content.nodes.some((n) => n.id === 'hero-title'));

    const bounded = await handleChallengeTool('get_design_tree', { maxDepth: 1, summary: true });
    assert.equal(bounded.isError, undefined);
    const treeData = bounded.structuredContent as { root: { id: string; childCount: number; children?: unknown[] } };
    assert.equal(treeData.root.id, 'artboard-main');
    assert.ok(treeData.root.childCount > 0);
  });

  test('captures preview image data URL via capture_preview tool', async () => {
    const previewPng = await handleChallengeTool('capture_preview', { nodeId: 'artboard-main', format: 'png' });
    assert.equal(previewPng.isError, undefined);
    const pngContent = previewPng.structuredContent as { format: string; dataUrl: string };
    assert.equal(pngContent.format, 'png');
    assert.match(pngContent.dataUrl, /^data:image\//);

    const previewSvg = await handleChallengeTool('capture_preview', { format: 'svg' });
    assert.equal(previewSvg.isError, undefined);
    const svgContent = previewSvg.structuredContent as { format: string; dataUrl: string };
    assert.equal(svgContent.format, 'svg');
    assert.match(svgContent.dataUrl, /^data:image\/svg\+xml/);
  });

  test('falls back to canvas root when get_design_tree has no selection or target', () => {
    store.select(null);
    assert.equal(store.selectedId, null);
    const tree = getDesignTree({});
    assert.equal((tree.root as { id: string }).id, 'artboard-main');
  });

  test('restricts flex layout and gap strictly to frame containers', () => {
    const textNode = createNode({ kind: 'text', text: 'Clean text', layout: 'flex-row', gap: 12 });
    const stored = store.getNode(textNode.id);
    assert.equal(stored?.layout, undefined);
    assert.equal(stored?.gap, undefined);

    setLayout({ nodeId: textNode.id, layout: 'flex-column', gap: 20 });
    const afterLayout = store.getNode(textNode.id);
    assert.equal(afterLayout?.layout, undefined);
    assert.equal(afterLayout?.gap, undefined);
  });

  test('safely bounds recursion on cyclic or pathological tree inputs', () => {
    const cycle: Record<string, unknown> = { kind: 'frame', name: 'cyclic-root', children: [] };
    const child = { kind: 'frame', name: 'cyclic-child', children: [cycle] };
    (cycle.children as unknown[]).push(child);

    // normalizeTreeNodeInput bounds recursion at 24 and prevents stack overflow
    const result = createTree({ tree: cycle });
    assert.ok(result.id);
    assert.ok((result.nodeCount as number) <= 30);
  });

  test('recreates from reference with dynamic layout, gap, padding, and children', () => {
    const added = addReferenceImage({ name: 'custom-ref.png', dataUrl: 'data:image/png;base64,AAAA' });
    const recreated = recreateFromReference({
      referenceId: added.referenceId,
      name: 'Dynamic Recreation',
      layout: 'flex-row',
      gap: 16,
      padding: 24,
      children: [
        { kind: 'text', text: 'Dynamic Label', widthSizing: 'fill' },
        { kind: 'button', text: 'Action', widthSizing: 'hug' },
      ],
    });
    const frame = store.getNode(recreated.recreationNodeId);
    assert.equal(frame?.name, 'Dynamic Recreation');
    assert.equal(frame?.layout, 'flex-row');
    assert.equal(frame?.gap, 16);
    assert.equal(frame?.style?.padding, 24);
    assert.equal(frame?.children.length, 2);
    const child1 = store.getNode(frame!.children[0]);
    assert.equal(child1?.text, 'Dynamic Label');
    assert.equal(child1?.widthSizing, 'fill');
  });

  test('handles percentage opacity, snake_case aliases, and numeric letter spacing', () => {
    applyDesignStyles({
      nodeId: 'hero-title',
      styles: {
        background_color: '#1e293b',
        border_color: '#64748b',
        border_width: '3px',
        border_radius: 12,
        opacity: '75%',
        letter_spacing: 2,
      },
    });
    const node = store.getNode('hero-title');
    assert.equal(node?.style?.background, '#1e293b');
    assert.equal(node?.style?.border, '3px solid #64748b');
    assert.equal(node?.style?.borderRadius, 12);
    assert.equal(node?.style?.opacity, 0.75);
    assert.equal(node?.style?.letterSpacing, '2px');
  });

  test('handles CSS pixel units across set_layout, resize_node, move_nodes, create_node, and create_tree', () => {
    setLayout({ nodeId: 'artboard-main', gap: '16px', padding: '24px', widthSizing: 'FILL' as any, heightSizing: 'HUG' as any });
    const main = store.getNode('artboard-main');
    assert.equal(main?.gap, 16);
    assert.equal(main?.style?.padding, 24);
    assert.equal(main?.widthSizing, 'fill');
    assert.equal(main?.heightSizing, 'hug');

    resizeNode({ nodeId: 'artboard-main', width: '1800px', height: '950px' });
    const resized = store.getNode('artboard-main');
    assert.equal(resized?.width, 1800);
    assert.equal(resized?.height, 950);

    const initialX = resized!.x;
    const initialY = resized!.y;
    moveNodes({ nodeId: 'artboard-main', dx: '15px', dy: '-10px' });
    const moved = store.getNode('artboard-main');
    assert.equal(moved?.x, initialX + 15);
    assert.equal(moved?.y, initialY - 10);

    const created = createNode({
      kind: 'frame',
      x: '50px',
      y: '60px',
      width: '300px',
      height: '200px',
      gap: '12px',
      padding: '16px',
      widthSizing: 'FILL' as any,
      heightSizing: 'HUG' as any,
    });
    const frame = store.getNode(created.id as string);
    assert.equal(frame?.x, 50);
    assert.equal(frame?.y, 60);
    assert.equal(frame?.width, 300);
    assert.equal(frame?.height, 200);
    assert.equal(frame?.gap, 12);
    assert.equal(frame?.style?.padding, 16);
    assert.equal(frame?.widthSizing, 'fill');
    assert.equal(frame?.heightSizing, 'hug');
  });

  test('handles unitless string letter spacing and numeric opacity percentages', () => {
    applyDesignStyles({
      nodeId: 'hero-title',
      styles: {
        letterSpacing: '-0.03',
        opacity: 80,
      },
    });
    const node = store.getNode('hero-title');
    assert.equal(node?.style?.letterSpacing, '-0.03em');
    assert.equal(node?.style?.opacity, 0.8);
  });

  test('accepts nodeId and id aliases and string maxDepth in get_design_tree', () => {
    const treeByNodeId = getDesignTree({ nodeId: 'hero-title' });
    assert.equal((treeByNodeId.root as { id: string }).id, 'hero-title');

    const treeById = getDesignTree({ id: 'main-hero', maxDepth: '1' });
    assert.equal((treeById.root as { id: string }).id, 'main-hero');
  });

  test('finds nodes case-insensitively on kind', () => {
    const frames = findNodes({ kind: 'FRAME' });
    assert.ok((frames.nodes as Array<{ kind: string }>).length > 0);
    assert.ok((frames.nodes as Array<{ kind: string }>).every((n) => n.kind === 'frame'));

    const texts = findNodes({ kind: 'Text' });
    assert.ok((texts.nodes as Array<{ kind: string }>).length > 0);
    assert.ok((texts.nodes as Array<{ kind: string }>).every((n) => n.kind === 'text'));
  });

  test('omits heavy base64 dataUrl from capture_preview text content while keeping previewAvailable and structuredContent', async () => {
    const result = await handleChallengeTool('capture_preview', { nodeId: 'artboard-main', format: 'png' });
    assert.equal(result.isError, undefined);
    const textContent = result.content.find((c) => c.type === 'text')?.text ?? '';
    assert.ok(textContent.includes('"previewAvailable":true'));
    assert.ok(!textContent.includes('data:image/png;base64'));

    const structured = result.structuredContent as { dataUrl?: string; previewAvailable: boolean };
    assert.equal(structured.previewAvailable, true);
    assert.ok(typeof structured.dataUrl === 'string' && structured.dataUrl.startsWith('data:image/png;base64'));
  });

  test('uses measured bounds for child layer preview dimensions', async () => {
    const col = store.getNode('col-elements');
    assert.ok(col);
    const bounds = store.resolvedBounds(col);
    const preview = await handleChallengeTool('capture_preview', { nodeId: 'col-elements', format: 'svg' });
    assert.equal(preview.isError, undefined);
    const structured = preview.structuredContent as { width: number; height: number; dataUrl: string };
    assert.equal(structured.width, Math.round(bounds.width));
    assert.equal(structured.height, Math.round(bounds.height));
    assert.match(decodeURIComponent(structured.dataUrl), new RegExp(`width="${Math.round(bounds.width)}"`));
    assert.match(decodeURIComponent(structured.dataUrl), new RegExp(`height="${Math.round(bounds.height)}"`));
  });

  test('keeps image payloads out of the persisted document JSON so canvas edits survive reload', () => {
    addReferenceImage({ name: 'mood.png', dataUrl: 'data:image/png;base64,AAAA', width: 320, height: 240 });
    const { nodes, images } = splitDocumentImages([...store.nodes.values()]);
    assert.equal(Object.keys(images).length, 1);
    assert.ok(Object.values(images)[0]?.startsWith('data:image/png'));
    assert.equal(nodes.some((node) => !!node.imageSrc), false);
    const raw = serializePersistedDocument({
      nodes: [...store.nodes.values()],
      rootIds: [...store.rootIds],
      revision: store.revision,
    });
    assert.equal(raw.includes('data:image/png;base64,AAAA'), false);
    const parsed = parsePersistedDocument(raw);
    assert.ok(parsed);
    const restored = mergeDocumentImages(parsed.nodes, images);
    assert.equal(restored.some((node) => node.imageSrc === 'data:image/png;base64,AAAA'), true);
    assert.equal(store.getNode('hero-title')?.text, 'Design with an agent. Keep the final say.');
    setDesignText({ nodeId: 'hero-title', text: 'Saved after reload.' });
    const afterEdit = parsePersistedDocument(serializePersistedDocument({
      nodes: [...store.nodes.values()],
      rootIds: [...store.rootIds],
      revision: store.revision,
    }));
    assert.equal(afterEdit?.nodes.find((node) => node.id === 'hero-title')?.text, 'Saved after reload.');
  });
});
