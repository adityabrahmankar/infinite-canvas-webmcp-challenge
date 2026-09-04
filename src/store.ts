import { borderWidthOf, computeLayoutBounds, isFlexLayout, isRowLayout } from './layout';
import type { DesignNode, DocumentSnapshot, LayoutBounds, LayoutMode, NodeKind, NodeStyle, SetLayoutInput, SizingMode, TreeNodeInput } from './types';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function makeNode(
  id: string,
  name: string,
  kind: DesignNode['kind'],
  parentId: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
  style: NodeStyle,
  text?: string,
): DesignNode {
  return { id, name, kind, parentId, children: [], x, y, width, height, style, ...(text === undefined ? {} : { text }) };
}

const STORAGE_KEY = 'infinite-canvas-doc-v3';

interface PersistedDocument {
  nodes: DesignNode[];
  rootIds: string[];
  revision?: number;
}

function loadPersistedDocument(): PersistedDocument | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedDocument;
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.rootIds)) {
      return parsed;
    }
  } catch {
    // storage unavailable or invalid JSON
  }
  return null;
}

function savePersistedDocument(doc: PersistedDocument): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // ignore quota or private mode errors
  }
}

function seedDocument(): { nodes: DesignNode[]; rootIds: string[] } {
  const nodes: DesignNode[] = [];
  const add = (node: DesignNode): DesignNode => {
    nodes.push(node);
    if (node.parentId) {
      const parent = nodes.find((p) => p.id === node.parentId);
      if (parent && !parent.children.includes(node.id)) {
        parent.children.push(node.id);
      }
      if (parent && isFlexLayout(parent.layout)) {
        node.x = 0;
        node.y = 0;
      }
    }
    return node;
  };

  const addText = (
    id: string,
    name: string,
    parentId: string,
    width: number,
    height: number,
    text: string,
    style: NodeStyle,
    sizing: 'fill' | 'hug' = 'fill',
  ): DesignNode => {
    const node = add(makeNode(id, name, 'text', parentId, 0, 0, width, height, style, text));
    node.widthSizing = sizing;
    node.heightSizing = 'hug';
    return node;
  };

  const addButton = (
    id: string,
    name: string,
    parentId: string,
    width: number,
    height: number,
    text: string,
    style: NodeStyle,
    sizing: 'fill' | 'hug' = 'hug',
  ): DesignNode => {
    const node = add(makeNode(id, name, 'button', parentId, 0, 0, width, height, style, text));
    node.widthSizing = sizing;
    node.heightSizing = 'fixed';
    return node;
  };

  const addRect = (
    id: string,
    name: string,
    parentId: string,
    width: number,
    height: number,
    text: string,
    style: NodeStyle,
    sizing: 'fill' | 'hug' = 'fill',
  ): DesignNode => {
    const node = add(makeNode(id, name, 'rect', parentId, 0, 0, width, height, style, text));
    node.widthSizing = sizing;
    node.heightSizing = 'fixed';
    return node;
  };

  const addCard = (
    id: string,
    parentId: string,
    tag: string,
    title: string,
    body: string,
    height = 194,
    accent = false,
  ): DesignNode => {
    const card = add(makeNode(id, title, 'frame', parentId, 0, 0, 228, height, {
      background: accent ? '#f8fafc' : '#ffffff',
      border: '1px solid #e2e8df',
      borderRadius: 10,
      padding: 13,
    }));
    card.layout = 'flex-column';
    card.gap = 5;
    card.widthSizing = 'fill';
    card.heightSizing = 'fixed';

    addText(`${id}-tag`, 'Card Tag', card.id, 204, 12, tag, {
      color: '#64748b', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em',
    });
    addText(`${id}-title`, 'Card Title', card.id, 204, 20, title, {
      color: '#0f172a', fontSize: 13, fontWeight: 700, letterSpacing: '-0.02em',
    });
    addText(`${id}-body`, 'Card Body', card.id, 204, 38, body, {
      color: '#475569', fontSize: 10, fontWeight: 450,
    });

    return card;
  };

  // Main canvas onboarding board: wide, breathable layout inspired by Lunagraph
  const main = add(makeNode('artboard-main', 'Getting Started', 'frame', null, 40, 40, 1760, 920, {
    background: '#f8f9fa', border: '1px solid #e2e8f0', borderRadius: 16, padding: 28,
  }));
  main.layout = 'flex-row';
  main.gap = 20;
  main.clipContent = false;

  // ---------------------------------------------------------------------------
  // Column 1: Welcome & Overview (keeps main-hero and hero-title for compatibility)
  // ---------------------------------------------------------------------------
  const col1 = add(makeNode('main-hero', '01 · Welcome', 'frame', main.id, 28, 28, 264, 864, {
    background: '#ffffff', border: '1px solid #e2e8df', borderRadius: 12, padding: 18,
  }));
  col1.layout = 'flex-column';
  col1.gap = 12;
  col1.widthSizing = 'fixed';
  col1.heightSizing = 'fill';

  addText('hero-eyebrow', 'Eyebrow', col1.id, 228, 12, 'INFINITE CANVAS · WEBMCP', {
    color: '#64748b', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em',
  });

  const heroTitle = addText('hero-title', 'Hero Title', col1.id, 228, 54, 'Design with an agent. Keep the final say.', {
    color: '#0f172a', fontSize: 18.5, fontWeight: 750, letterSpacing: '-0.035em',
  });
  heroTitle.widthSizing = 'fill';

  addText('hero-body', 'Hero Supporting Text', col1.id, 228, 64, 'Chat from the Agents tab. 22 WebMCP tools edit this live tree. Named colors apply as asked — nothing is swapped for navy or slate.', {
    color: '#475569', fontSize: 10, fontWeight: 450,
  });

  const heroCta = addButton('hero-cta', 'Explore Button', col1.id, 228, 32, 'Explore canvas (V)', {
    background: '#0f172a', color: '#ffffff', borderRadius: 8, fontSize: 10.5, fontWeight: 650,
  });
  heroCta.widthSizing = 'fill';

  const toc = add(makeNode('welcome-index-card', 'Tutorial Steps Index', 'frame', col1.id, 0, 0, 228, 250, {
    background: '#f8fafc', border: '1px solid #e2e8df', borderRadius: 8, padding: 12,
  }));
  toc.layout = 'flex-column';
  toc.gap = 6;
  toc.widthSizing = 'fill';
  toc.heightSizing = 'fixed';

  addText('toc-head', 'Index Header', toc.id, 204, 12, 'FIVE TOPICS ON THIS CANVAS', {
    color: '#64748b', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em',
  });
  addText('toc-step-1', 'Step 1', toc.id, 204, 28, '1  Visual Canvas · Auto-layout & styling', { color: '#1e293b', fontSize: 10.5, fontWeight: 600 });
  addText('toc-step-2', 'Step 2', toc.id, 204, 28, '2  Code Engine · Live Tailwind & React', { color: '#1e293b', fontSize: 10.5, fontWeight: 600 });
  addText('toc-step-3', 'Step 3', toc.id, 204, 28, '3  WebMCP AI · 22 tools · Agents tab', { color: '#1e293b', fontSize: 10.5, fontWeight: 600 });
  addText('toc-step-4', 'Step 4', toc.id, 204, 28, '4  Inspiration · Image-to-scaffold', { color: '#1e293b', fontSize: 10.5, fontWeight: 600 });
  addText('toc-step-5', 'Step 5', toc.id, 204, 28, '5  Handoff · Export React, SVG & JSON', { color: '#1e293b', fontSize: 10.5, fontWeight: 600 });

  const webmcpCard = add(makeNode('welcome-webmcp-card', 'WebMCP Ready Card', 'frame', col1.id, 0, 0, 228, 160, {
    background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12,
  }));
  webmcpCard.layout = 'flex-column';
  webmcpCard.gap = 6;
  webmcpCard.widthSizing = 'fill';
  webmcpCard.heightSizing = 'fixed';

  addText('webmcp-card-badge', 'Challenge Badge', webmcpCard.id, 204, 12, 'WEBMCP PROTOCOL', { color: '#15803d', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em' });
  addText('webmcp-card-title', 'Challenge Title', webmcpCard.id, 204, 20, '22 Tools on This Page', { color: '#166534', fontSize: 13, fontWeight: 750, letterSpacing: '-0.02em' });
  addText('webmcp-card-body', 'Challenge Body', webmcpCard.id, 204, 48, 'Registered on document.modelContext — native Chrome or the in-page polyfill. Agents edit real nodes, not screenshots.', { color: '#15803d', fontSize: 9.5, fontWeight: 450 });
  addRect('webmcp-card-pill', 'Status Pill', webmcpCard.id, 204, 24, '● Protocol connected & ready', { background: '#dcfce7', color: '#166534', borderRadius: 12, fontSize: 9, fontWeight: 600 });

  // ---------------------------------------------------------------------------
  // Column 2: Chapter 1 · Visual Canvas & Layout
  // ---------------------------------------------------------------------------
  const col2 = add(makeNode('col-elements', '02 · Canvas & Layout', 'frame', main.id, 312, 28, 264, 864, {
    background: '#ffffff', border: '1px solid #e2e8df', borderRadius: 12, padding: 18,
  }));
  col2.layout = 'flex-column';
  col2.gap = 12;
  col2.widthSizing = 'fixed';
  col2.heightSizing = 'fill';

  addText('elem-chapter-label', 'Chapter Label', col2.id, 228, 12, 'CHAPTER 1', { color: '#64748b', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em' });
  addText('elem-chapter-title', 'Chapter Title', col2.id, 228, 26, '1 Visual Canvas', { color: '#0f172a', fontSize: 20, fontWeight: 750, letterSpacing: '-0.03em' });
  addText('elem-chapter-intro', 'Chapter Intro', col2.id, 228, 42, 'Direct-manipulation canvas with CSS auto-layout, nested frames, and visual inspector controls.', { color: '#475569', fontSize: 10.5, fontWeight: 400 });

  // Card 1: Add elements from toolbar
  const elemCard1 = addCard('elem-card-toolbar', col2.id, 'TOOLBAR TOOLS', 'Add elements directly', 'Use the bottom toolbar to add Frames (F), Rectangles (R), Text (T), or Buttons (B) anywhere on the canvas.', 194);
  const miniBar = add(makeNode('elem-toolbar-preview', 'Toolbar Preview', 'frame', elemCard1.id, 0, 0, 204, 42, { background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8, padding: 6 }));
  miniBar.layout = 'flex-row';
  miniBar.gap = 6;
  miniBar.widthSizing = 'fill';
  addButton('elem-tb-select', 'Tool Select', miniBar.id, 28, 28, '↖', { background: '#2563eb', color: '#ffffff', borderRadius: 6, fontSize: 12, fontWeight: 700 });
  addButton('elem-tb-hand', 'Tool Hand', miniBar.id, 28, 28, '✋', { background: '#ffffff', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, fontSize: 11 });
  addButton('elem-tb-frame', 'Tool Frame', miniBar.id, 28, 28, '▭', { background: '#ffffff', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, fontSize: 11 });
  addButton('elem-tb-rect', 'Tool Rect', miniBar.id, 28, 28, '□', { background: '#ffffff', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, fontSize: 11 });
  addButton('elem-tb-text', 'Tool Text', miniBar.id, 28, 28, 'Aa', { background: '#ffffff', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, fontSize: 10.5, fontWeight: 700 });
  addButton('elem-tb-btn', 'Tool Button', miniBar.id, 28, 28, '⬤', { background: '#ffffff', border: '1px solid #cbd5e1', color: '#475569', borderRadius: 6, fontSize: 10 });

  // Card 2: Real CSS Auto Layout
  const elemCard2 = addCard('elem-card-layout', col2.id, 'AUTO LAYOUT', 'Real CSS flexbox layout', 'Frames support flex Row or Column direction, padding, gap, and sizing modes (Fill, Hug, Fixed).', 200, true);
  const flexDemo = add(makeNode('elem-flex-demo', 'Flex Demo Container', 'frame', elemCard2.id, 0, 0, 204, 56, { background: '#ffffff', border: '1px dashed #94a3b8', borderRadius: 8, padding: 10 }));
  flexDemo.layout = 'flex-row';
  flexDemo.gap = 8;
  flexDemo.widthSizing = 'fill';
  addRect('elem-flex-box1', 'Flex Box 1', flexDemo.id, 86, 32, 'Item 1 · Fill', { background: '#2563eb', color: '#ffffff', borderRadius: 6, fontSize: 9.5, fontWeight: 650 });
  addRect('elem-flex-box2', 'Flex Box 2', flexDemo.id, 86, 32, 'Item 2 · Fill', { background: '#f59e0b', color: '#0f172a', borderRadius: 6, fontSize: 9.5, fontWeight: 650 });

  // Card 3: Visual styling & inspector
  const elemCard3 = addCard('elem-card-style', col2.id, 'INSPECTOR', 'Style visually in panel', 'Select any element to customize fill colors, border radius, padding, opacity, and typography.', 200);
  const figmaBox = add(makeNode('elem-figma-container', 'Style Target Container', 'frame', elemCard3.id, 0, 0, 204, 56, { background: '#f8fafc', border: '1px solid #e2e8df', borderRadius: 8, padding: 10 }));
  figmaBox.layout = 'flex-row';
  figmaBox.gap = 8;
  figmaBox.widthSizing = 'fill';
  const selectMeBtn = addButton('elem-select-me-btn', 'Selectable Button', figmaBox.id, 140, 32, 'Select & style me', { background: '#0f172a', color: '#ffffff', borderRadius: 6, fontSize: 10.5, fontWeight: 600 });
  selectMeBtn.widthSizing = 'hug';

  // ---------------------------------------------------------------------------
  // Column 3: Chapter 2 · Live Code Engine
  // ---------------------------------------------------------------------------
  const col3 = add(makeNode('col-components', '03 · Code Engine', 'frame', main.id, 596, 28, 264, 864, {
    background: '#ffffff', border: '1px solid #e2e8df', borderRadius: 12, padding: 18,
  }));
  col3.layout = 'flex-column';
  col3.gap = 12;
  col3.widthSizing = 'fixed';
  col3.heightSizing = 'fill';

  addText('comp-chapter-label', 'Chapter Label', col3.id, 228, 12, 'CHAPTER 2', { color: '#64748b', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em' });
  addText('comp-chapter-title', 'Chapter Title', col3.id, 228, 26, '2 Code Engine', { color: '#0f172a', fontSize: 20, fontWeight: 750, letterSpacing: '-0.03em' });
  addText('comp-chapter-intro', 'Chapter Intro', col3.id, 228, 42, 'Every visual node compiles in real time into clean Tailwind classes, React components, and HTML.', { color: '#475569', fontSize: 10.5, fontWeight: 400 });

  // Card 1: Atomic Tailwind CSS
  const compCard1 = addCard('comp-card-tailwind', col3.id, 'TAILWIND CSS', 'Real-time class compilation', 'Colors, flex layout, padding, and corner radius compile directly into atomic Tailwind classes.', 240, true);
  const codeBox = add(makeNode('elem-code-snippet-box', 'Code Snippet Box', 'frame', compCard1.id, 0, 0, 204, 76, { background: '#0f172a', borderRadius: 6, padding: 9 }));
  codeBox.layout = 'flex-column';
  codeBox.gap = 4;
  codeBox.widthSizing = 'fill';
  addText('elem-code-line1', 'Code Line 1', codeBox.id, 184, 14, 'flex flex-row items-center gap-2', { color: '#7dd3fc', fontSize: 9, fontFamily: 'JetBrains Mono' });
  addText('elem-code-line2', 'Code Line 2', codeBox.id, 184, 14, 'bg-[#0f172a] rounded-lg p-3', { color: '#f59e0b', fontSize: 9, fontFamily: 'JetBrains Mono' });
  addText('elem-code-line3', 'Code Line 3', codeBox.id, 184, 14, 'text-white font-semibold', { color: '#a7f3d0', fontSize: 9, fontFamily: 'JetBrains Mono' });

  // Card 2: React JSX Output
  const compCard2 = addCard('comp-card-react', col3.id, 'REACT JSX', 'Production component code', 'Click the Code tab in the right inspector to view and copy clean React JSX for the selected layer.', 240);
  const reactBox = add(makeNode('comp-react-snippet-box', 'React Snippet Box', 'frame', compCard2.id, 0, 0, 204, 76, { background: '#0f172a', borderRadius: 6, padding: 9 }));
  reactBox.layout = 'flex-column';
  reactBox.gap = 4;
  reactBox.widthSizing = 'fill';
  addText('comp-react-line1', 'React Line 1', reactBox.id, 184, 14, 'export function GettingStarted() {', { color: '#93c5fd', fontSize: 9, fontFamily: 'JetBrains Mono' });
  addText('comp-react-line2', 'React Line 2', reactBox.id, 184, 14, '  return <div className="...">', { color: '#cbd5e1', fontSize: 9, fontFamily: 'JetBrains Mono' });
  addText('comp-react-line3', 'React Line 3', reactBox.id, 184, 14, '}', { color: '#93c5fd', fontSize: 9, fontFamily: 'JetBrains Mono' });

  // Card 3: Live Code Inspector Tab
  const compCard3 = addCard('comp-card-inspector', col3.id, 'INSPECTOR CODE TAB', 'Inspect any layer', 'Switch between the Styles and Code tabs in the inspector at any time to see code update live.', 155);
  addText('comp-code-hint', 'Code Tab Hint', compCard3.id, 204, 24, 'Click "Code" at the top of the right inspector →', { color: '#2563eb', fontSize: 9.5, fontWeight: 650 });

  // ---------------------------------------------------------------------------
  // Column 4: Chapter 3 · WebMCP AI Protocol
  // ---------------------------------------------------------------------------
  const col4 = add(makeNode('col-ai', '04 · WebMCP Protocol', 'frame', main.id, 880, 28, 264, 864, {
    background: '#ffffff', border: '1px solid #e2e8df', borderRadius: 12, padding: 18,
  }));
  col4.layout = 'flex-column';
  col4.gap = 12;
  col4.widthSizing = 'fixed';
  col4.heightSizing = 'fill';

  addText('ai-chapter-label', 'Chapter Label', col4.id, 228, 12, 'CHAPTER 3', { color: '#64748b', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em' });
  addText('ai-chapter-title', 'Chapter Title', col4.id, 228, 26, '3 WebMCP Protocol', { color: '#0f172a', fontSize: 20, fontWeight: 750, letterSpacing: '-0.03em' });
  addText('ai-chapter-intro', 'Chapter Intro', col4.id, 228, 42, 'Open the Agents tab. Tools register on document.modelContext (native or polyfill) and follow the colors you name.', { color: '#475569', fontSize: 10.5, fontWeight: 400 });

  // Card 1: Live AST — No screenshot guessing
  const aiCard1 = addCard('ai-card-chat', col4.id, 'NO SCREENSHOT GUESSING', 'Shared document AST', 'The agent calls get_design_tree to inspect the exact hierarchy, text, and styles instead of guessing pixels.', 220);
  const astPill = add(makeNode('ai-ast-pill', 'AST Pill', 'frame', aiCard1.id, 0, 0, 204, 68, { background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 8, padding: 8 }));
  astPill.layout = 'flex-column';
  astPill.gap = 3;
  astPill.widthSizing = 'fill';
  addText('ai-ast-label', 'AST Label', astPill.id, 184, 11, 'document.modelContext:', { color: '#64748b', fontSize: 8, fontWeight: 750 });
  addText('ai-ast-text', 'AST Text', astPill.id, 184, 38, 'inspect_canvas · get_design_tree · set_design_text · apply_design_styles', { color: '#0f172a', fontSize: 8.5, fontFamily: 'JetBrains Mono' });

  // Card 2: Natural language prompts
  const aiCard2 = addCard('ai-card-customize', col4.id, 'PROMPTS TO TRY', 'Natural language edits', 'Ask your agent to make surgical changes directly to the live document tree:', 215, true);
  const promptBox = add(makeNode('ai-prompt-box', 'Prompt Box', 'frame', aiCard2.id, 0, 0, 204, 68, { background: '#ffffff', border: '1px solid #e2e8df', borderRadius: 8, padding: 8 }));
  promptBox.layout = 'flex-column';
  promptBox.gap = 3;
  promptBox.widthSizing = 'fill';
  addText('ai-p1', 'Prompt 1', promptBox.id, 184, 15, '• "Change hero title to: Ship faster"', { color: '#1e293b', fontSize: 8.5, fontWeight: 500 });
  addText('ai-p2', 'Prompt 2', promptBox.id, 184, 15, '• "Recolor Hero Title crimson #dc2626"', { color: '#1e293b', fontSize: 8.5, fontWeight: 500 });
  addText('ai-p3', 'Prompt 3', promptBox.id, 184, 15, '• "Add a secondary outline button"', { color: '#1e293b', fontSize: 8.5, fontWeight: 500 });

  // Card 3: Safe and reversible
  const aiCard3 = addCard('ai-card-branches', col4.id, 'HUMAN IN CONTROL', 'Safe & reversible edits', 'Every agent edit applies directly to the shared document and can be undone or redone with ⌘Z and ⇧⌘Z.', 180);
  const undoPill = add(makeNode('ai-undo-pill', 'Undo Pill Box', 'frame', aiCard3.id, 0, 0, 204, 38, { background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, padding: 8 }));
  undoPill.layout = 'flex-row';
  undoPill.gap = 4;
  undoPill.widthSizing = 'fill';
  addText('ai-undo-label', 'Undo label', undoPill.id, 184, 18, '↶ Undo (⌘Z) · ↷ Redo (⇧⌘Z)', { color: '#0f172a', fontSize: 9, fontWeight: 650 });

  // ---------------------------------------------------------------------------
  // Column 5: Chapter 4 · Visual References & Inspiration
  // ---------------------------------------------------------------------------
  const col5 = add(makeNode('col-tokens', '05 · Visual References', 'frame', main.id, 1164, 28, 264, 864, {
    background: '#ffffff', border: '1px solid #e2e8df', borderRadius: 12, padding: 18,
  }));
  col5.layout = 'flex-column';
  col5.gap = 12;
  col5.widthSizing = 'fixed';
  col5.heightSizing = 'fill';

  addText('tokens-chapter-label', 'Chapter Label', col5.id, 228, 12, 'CHAPTER 4', { color: '#64748b', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em' });
  addText('tokens-chapter-title', 'Chapter Title', col5.id, 228, 26, '4 Visual References', { color: '#0f172a', fontSize: 20, fontWeight: 750, letterSpacing: '-0.03em' });
  addText('tokens-chapter-intro', 'Chapter Intro', col5.id, 228, 42, 'Drop screenshots and visual mockups onto the canvas to guide your design or scaffold layers.', { color: '#475569', fontSize: 10.5, fontWeight: 400 });

  // Card 1: Paste inspiration (⌘V)
  const tokensCard1 = addCard('tokens-card-prompts', col5.id, 'DRAG & DROP', 'Paste inspiration (⌘V)', 'Paste any screenshot from your clipboard or click Add Image (▧) in the toolbar to place mockups on the canvas.', 200, true);
  const dropHint = add(makeNode('tokens-drop-hint', 'Dropzone Hint', 'frame', tokensCard1.id, 0, 0, 204, 52, { background: '#eff6ff', border: '1px dashed #3b82f6', borderRadius: 8, padding: 8 }));
  dropHint.layout = 'flex-column';
  dropHint.gap = 3;
  dropHint.widthSizing = 'fill';
  addText('tokens-drop-icon', 'Drop Icon', dropHint.id, 184, 14, '▧ Paste image or drop file (⌘V)', { color: '#2563eb', fontSize: 9.5, fontWeight: 700 });
  addText('tokens-drop-sub', 'Drop Sub', dropHint.id, 184, 16, 'Places visual reference card on canvas', { color: '#3b82f6', fontSize: 8.5 });

  // Card 2: Scaffold editable layers with AI
  const tokensCard2 = addCard('tokens-card-swatches', col5.id, 'AI RECREATION', 'Scaffold editable layers', 'WebMCP includes recreate_from_reference: the agent inspects mockups and scaffolds editable frames, text, and buttons.', 205);
  const toolPill = add(makeNode('tokens-tool-pill', 'Recreate Tool Pill', 'frame', tokensCard2.id, 0, 0, 204, 54, { background: '#f8fafc', border: '1px solid #e2e8df', borderRadius: 8, padding: 8 }));
  toolPill.layout = 'flex-column';
  toolPill.gap = 3;
  toolPill.widthSizing = 'fill';
  addText('tokens-recreate-name', 'Recreate tool', toolPill.id, 184, 14, 'recreate_from_reference', { color: '#2563eb', fontSize: 9, fontFamily: 'JetBrains Mono', fontWeight: 650 });
  addText('tokens-recreate-desc', 'Recreate desc', toolPill.id, 184, 16, 'Turns static images into editable nodes', { color: '#64748b', fontSize: 8.5 });

  // Card 3: Color palette example
  const tokensCard3 = addCard('tokens-card-ref', col5.id, 'PALETTE EXAMPLE', 'Sample color swatches', 'Select any swatch below to inspect its hex value or open the live color picker in the inspector.', 200);
  const swatchRow = add(makeNode('tokens-swatches-row', 'Swatches Row', 'frame', tokensCard3.id, 0, 0, 204, 46, { background: '#f8fafc', border: '1px solid #e2e8df', borderRadius: 8, padding: 6 }));
  swatchRow.layout = 'flex-row';
  swatchRow.gap = 6;
  swatchRow.widthSizing = 'fill';
  addRect('swatch-blue', 'Blue Token', swatchRow.id, 42, 28, '#2563eb', { background: '#2563eb', color: '#ffffff', borderRadius: 6, fontSize: 7, fontWeight: 700 });
  addRect('swatch-amber', 'Amber Token', swatchRow.id, 42, 28, '#f59e0b', { background: '#f59e0b', color: '#0f172a', borderRadius: 6, fontSize: 7, fontWeight: 700 });
  addRect('swatch-emerald', 'Emerald Token', swatchRow.id, 42, 28, '#10b981', { background: '#10b981', color: '#ffffff', borderRadius: 6, fontSize: 7, fontWeight: 700 });
  addRect('swatch-slate', 'Slate Token', swatchRow.id, 42, 28, '#0f172a', { background: '#0f172a', color: '#ffffff', borderRadius: 6, fontSize: 7, fontWeight: 700 });

  // ---------------------------------------------------------------------------
  // Column 6: Chapter 5 · Where to next
  // ---------------------------------------------------------------------------
  const col6 = add(makeNode('col-export', '06 · Export & Ship', 'frame', main.id, 1448, 28, 264, 864, {
    background: '#ffffff', border: '1px solid #e2e8df', borderRadius: 12, padding: 18,
  }));
  col6.layout = 'flex-column';
  col6.gap = 12;
  col6.widthSizing = 'fixed';
  col6.heightSizing = 'fill';

  addText('export-chapter-label', 'Chapter Label', col6.id, 228, 12, 'WRAP UP', { color: '#64748b', fontSize: 8, fontWeight: 750, letterSpacing: '0.12em' });
  addText('export-chapter-title', 'Chapter Title', col6.id, 228, 26, '5 Export & Ship', { color: '#0f172a', fontSize: 20, fontWeight: 750, letterSpacing: '-0.03em' });
  addText('export-chapter-intro', 'Chapter Intro', col6.id, 228, 42, 'Export production code, vector graphics, standalone bundles, or reopenable project files.', { color: '#475569', fontSize: 10.5, fontWeight: 400 });

  // Card 1: 4 Deterministic Export Formats
  const exportCard1 = addCard('export-card-formats', col6.id, 'EXPORT DRAWER', '4 Deterministic formats', 'Click Export in the bottom toolbar or call export_design via WebMCP to generate handoffs:', 230, true);
  const fmtBox = add(makeNode('export-formats-box', 'Formats Box', 'frame', exportCard1.id, 0, 0, 204, 86, { background: '#ffffff', border: '1px solid #e2e8df', borderRadius: 8, padding: 8 }));
  fmtBox.layout = 'flex-column';
  fmtBox.gap = 4;
  fmtBox.widthSizing = 'fill';
  addText('fmt-react', 'React format', fmtBox.id, 184, 14, '⚛ React Component + Tailwind', { color: '#0f172a', fontSize: 9.5, fontWeight: 650 });
  addText('fmt-svg', 'SVG format', fmtBox.id, 184, 14, '📐 Vector SVG & crisp PNG', { color: '#0f172a', fontSize: 9.5, fontWeight: 650 });
  addText('fmt-html', 'HTML format', fmtBox.id, 184, 14, '🌐 Standalone HTML Bundle', { color: '#0f172a', fontSize: 9.5, fontWeight: 650 });
  addText('fmt-json', 'JSON format', fmtBox.id, 184, 14, '▣ Reopenable Project JSON', { color: '#0f172a', fontSize: 9.5, fontWeight: 650 });

  // Card 2: Offline Browser Storage
  const exportCard2 = addCard('export-card-safety', col6.id, 'BROWSER STORAGE', 'Your edits stay saved', 'Your canvas state is stored locally in your browser. Delete any tutorial card or clear the board — your work is preserved across reload.', 180);
  const receiptPill = add(makeNode('export-receipt-pill', 'Receipt Pill', 'frame', exportCard2.id, 0, 0, 204, 38, { background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: 8 }));
  receiptPill.layout = 'flex-row';
  receiptPill.gap = 4;
  receiptPill.widthSizing = 'fill';
  addText('receipt-text', 'Receipt text', receiptPill.id, 184, 18, '● Local storage active · Clean session', { color: '#166534', fontSize: 9, fontWeight: 700 });

  // Card 3: WebMCP Challenge action
  const exportCard3 = addCard('export-card-hackathon', col6.id, 'MAKE IT YOURS', 'Start designing', 'Select any element to begin. You can return to this starting tutorial anytime by clicking Reset (↺).', 180);
  const exportCta = addButton('export-cta-btn', 'Export Button', exportCard3.id, 204, 32, 'Export Design ⇩', { background: '#0f172a', color: '#ffffff', borderRadius: 8, fontSize: 10.5, fontWeight: 700 });
  exportCta.widthSizing = 'fill';

  return { nodes, rootIds: [main.id] };
}

function defaultNodeStyle(kind: DesignNode['kind']): { name: string; text?: string; style: NodeStyle } {
  if (kind === 'frame') {
    return { name: 'Frame', style: { background: '#111827', border: '1px solid #263b69', borderRadius: 16 } };
  }
  if (kind === 'rect') {
    return { name: 'Rectangle', style: { background: '#1e3a8a', borderRadius: 8 } };
  }
  if (kind === 'text') {
    return { name: 'Text', text: 'New text', style: { fontFamily: 'Inter', color: '#f8fafc', fontSize: 16, fontWeight: 500 } };
  }
  if (kind === 'button') {
    return { name: 'Button', text: 'Button', style: { fontFamily: 'Inter', background: '#2563eb', color: '#eff6ff', borderRadius: 9, fontSize: 12, fontWeight: 700 } };
  }
  return { name: 'Image', style: { background: '#111827', border: '1px solid #5c8dff', borderRadius: 12 } };
}

export class ChallengeStore {
  nodes = new Map<string, DesignNode>();
  rootIds: string[] = [];
  selectedIds: string[] = [];
  revision = 1;
  private listeners = new Set<() => void>();
  private undoStack: DocumentSnapshot[] = [];
  private redoStack: DocumentSnapshot[] = [];
  private readonly historyLimit = 80;
  private referenceCounter = 0;
  private nodeCounter = 0;
  private liveGesture = false;
  private suppressHistory = false;
  /** Browser-resolved layout output. Never serialized into project files. */
  private runtimeBounds = new Map<string, LayoutBounds>();
  private layoutCache: Map<string, LayoutBounds> | null = null;

  get selectedId(): string | null {
    return this.selectedIds.at(-1) ?? null;
  }

  constructor() {
    const persisted = loadPersistedDocument();
    if (persisted) {
      this.nodes = new Map(persisted.nodes.map((node) => [node.id, node]));
      this.rootIds = [...persisted.rootIds];
      this.selectedIds = this.rootIds[0] ? [this.rootIds[0]] : [];
      this.revision = persisted.revision ?? 1;
      this.undoStack = [];
      this.redoStack = [];
      this.referenceCounter = 0;
      this.nodeCounter = 0;
      this.liveGesture = false;
      this.suppressHistory = false;
      this.runtimeBounds.clear();
      this.layoutCache = null;
    } else {
      this.reset();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    if (!this.liveGesture) {
      savePersistedDocument({
        nodes: [...this.nodes.values()],
        rootIds: [...this.rootIds],
        revision: this.revision,
      });
    }
    for (const listener of this.listeners) listener();
  }

  reset(): void {
    const seed = seedDocument();
    this.nodes = new Map(seed.nodes.map((node) => [node.id, node]));
    this.rootIds = [...seed.rootIds];
    this.selectedIds = seed.rootIds[0] ? [seed.rootIds[0]] : [];
    this.revision = 1;
    this.undoStack = [];
    this.redoStack = [];
    this.referenceCounter = 0;
    this.nodeCounter = 0;
    this.liveGesture = false;
    this.suppressHistory = false;
    this.runtimeBounds.clear();
    this.layoutCache = null;
    this.emit();
  }

  getNode(id: string | null | undefined): DesignNode | undefined {
    return id ? this.nodes.get(id) : undefined;
  }

  childrenOf(id: string): DesignNode[] {
    return (this.nodes.get(id)?.children ?? [])
      .map((childId) => this.nodes.get(childId))
      .filter((node): node is DesignNode => !!node && !node.hidden);
  }

  roots(): DesignNode[] {
    return this.rootIds.map((id) => this.nodes.get(id)).filter((node): node is DesignNode => !!node && !node.hidden);
  }

  select(id: string | null): void {
    this.selectedIds = id && this.nodes.has(id) ? [id] : [];
    this.emit();
  }

  selectMany(ids: string[]): void {
    this.selectedIds = [...new Set(ids.filter((id) => this.nodes.has(id)))];
    this.emit();
  }

  toggleSelect(id: string): void {
    if (!this.nodes.has(id)) return;
    const index = this.selectedIds.indexOf(id);
    if (index >= 0) this.selectedIds.splice(index, 1);
    else this.selectedIds.push(id);
    this.emit();
  }

  clearSelection(): void {
    this.selectedIds = [];
    this.emit();
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  /**
   * Replace the measured boxes produced by the browser's layout pass.
   *
   * Auto-layout children have authored x/y values of zero (their position is
   * determined by flex layout), so interaction must consume this resolved
   * geometry rather than guessing from the AST. This map is runtime-only and
   * deliberately does not emit a document mutation or revision.
   */
  replaceRuntimeBounds(bounds: Map<string, LayoutBounds>): void {
    const next = new Map<string, LayoutBounds>();
    for (const [id, value] of bounds) {
      if (!this.nodes.has(id)) continue;
      if (![value.x, value.y, value.width, value.height].every(Number.isFinite)) continue;
      next.set(id, {
        x: value.x,
        y: value.y,
        width: Math.max(0, value.width),
        height: Math.max(0, value.height),
      });
    }
    this.runtimeBounds = next;
  }

  clearRuntimeBounds(id?: string): void {
    if (id) this.runtimeBounds.delete(id);
    else this.runtimeBounds.clear();
    this.layoutCache = null;
  }

  private computedLayout(): Map<string, LayoutBounds> {
    if (!this.layoutCache) this.layoutCache = computeLayoutBounds(this.nodes, this.rootIds);
    return this.layoutCache;
  }

  /** Prefer a browser measurement, then the flex solver, then authored geometry. */
  resolvedBounds(node: DesignNode): LayoutBounds {
    const measured = this.runtimeBounds.get(node.id);
    if (measured) return measured;
    const computed = this.computedLayout().get(node.id);
    if (computed) return computed;
    return { x: node.x, y: node.y, width: node.width, height: node.height };
  }

  selectedRoots(): DesignNode[] {
    const ids = new Set(this.selectedIds);
    return this.selectedIds
      .map((id) => this.nodes.get(id))
      .filter((node): node is DesignNode => {
        if (!node) return false;
        let parentId = node.parentId;
        while (parentId) {
          if (ids.has(parentId)) return false;
          parentId = this.nodes.get(parentId)?.parentId ?? null;
        }
        return true;
      });
  }

  worldOrigin(node: DesignNode): { x: number; y: number } {
    const local = this.resolvedBounds(node);
    let x = local.x;
    let y = local.y;
    let parentId = node.parentId;
    while (parentId) {
      const parent = this.nodes.get(parentId);
      if (!parent) break;
      const parentBounds = this.resolvedBounds(parent);
      const border = borderWidthOf(parent);
      x += parentBounds.x + border;
      y += parentBounds.y + border;
      parentId = parent.parentId;
    }
    return { x, y };
  }

  worldBounds(node: DesignNode): { x: number; y: number; width: number; height: number } {
    const origin = this.worldOrigin(node);
    const local = this.resolvedBounds(node);
    return { x: origin.x, y: origin.y, width: local.width, height: local.height };
  }

  artboardOf(node: DesignNode): DesignNode {
    let current = node;
    while (current.parentId) {
      const parent = this.nodes.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  }

  isDescendant(childId: string, ancestorId: string): boolean {
    let parentId = this.nodes.get(childId)?.parentId ?? null;
    while (parentId) {
      if (parentId === ancestorId) return true;
      parentId = this.nodes.get(parentId)?.parentId ?? null;
    }
    return false;
  }

  beginGesture(): void {
    if (this.liveGesture) return;
    this.recordBeforeMutation();
    this.liveGesture = true;
    this.suppressHistory = true;
  }

  endGesture(): void {
    if (!this.liveGesture) return;
    this.liveGesture = false;
    this.suppressHistory = false;
    this.revision += 1;
    this.emit();
  }

  cancelGesture(): void {
    this.liveGesture = false;
    this.suppressHistory = false;
  }

  notify(): void {
    this.emit();
  }

  isGesturing(): boolean {
    return this.liveGesture;
  }

  updateText(id: string, text: string): DesignNode {
    const node = this.nodes.get(id);
    if (!node || (node.kind !== 'text' && node.kind !== 'button' && node.kind !== 'rect')) throw new Error(`Editable text node not found: ${id}`);
    this.recordBeforeMutation();
    this.clearRuntimeBounds(id);
    node.text = text;
    this.bump();
    return node;
  }

  updateStyle(id: string, patch: NodeStyle): DesignNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Design node not found: ${id}`);
    this.recordBeforeMutation();
    this.clearRuntimeBounds(id);
    node.style = { ...node.style, ...patch };
    this.bump();
    return node;
  }

  updateNodeProp<K extends keyof DesignNode>(id: string, key: K, value: DesignNode[K]): DesignNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Design node not found: ${id}`);
    this.recordBeforeMutation();
    this.clearRuntimeBounds(id);
    if (key === 'layout') this.applyLayoutMode(node, value as LayoutMode);
    else if (key === 'widthSizing' || key === 'heightSizing') this.applySizingMode(node, key, value as SizingMode);
    else node[key] = value;
    this.bump();
    return node;
  }

  updateGeometry(id: string, patch: Partial<Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>>): DesignNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Design node not found: ${id}`);
    this.recordBeforeMutation();
    this.applyGeometry(node, patch);
    this.bump();
    return node;
  }

  applyGeometry(node: DesignNode, patch: Partial<Pick<DesignNode, 'x' | 'y' | 'width' | 'height'>>): void {
    this.clearRuntimeBounds(node.id);
    const parent = node.parentId ? this.nodes.get(node.parentId) : undefined;
    const inFlow = isFlexLayout(parent?.layout);
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const value = patch[key];
      if (value === undefined || !Number.isFinite(value)) continue;
      if (inFlow && (key === 'x' || key === 'y')) continue;
      node[key] = key === 'width' || key === 'height' ? Math.max(1, value) : value;
      if (key === 'width') node.widthSizing = 'fixed';
      if (key === 'height') node.heightSizing = 'fixed';
    }
  }

  createNode(input: {
    kind: DesignNode['kind'];
    parentId?: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    name?: string;
    text?: string;
    style?: NodeStyle;
    layout?: LayoutMode;
    gap?: number;
    padding?: number;
    widthSizing?: SizingMode;
    heightSizing?: SizingMode;
  }): DesignNode {
    const parentId = input.parentId ?? null;
    const parent = parentId ? this.nodes.get(parentId) : undefined;
    if (parentId && (!parent || parent.kind !== 'frame')) throw new Error('New layers can only be created on the canvas or inside a frame.');
    this.recordBeforeMutation();
    const id = `${input.kind}-${++this.nodeCounter}-${Date.now().toString(36)}`;
    const defaults = defaultNodeStyle(input.kind);
    const inFlow = isFlexLayout(parent?.layout);
    const style: NodeStyle = { ...defaults.style, ...input.style };
    if (input.padding !== undefined && Number.isFinite(input.padding)) {
      style.padding = Math.max(0, input.padding);
    }
    const node: DesignNode = {
      id,
      name: input.name || defaults.name,
      kind: input.kind,
      parentId,
      children: [],
      x: inFlow ? 0 : input.x,
      y: inFlow ? 0 : input.y,
      width: Math.max(1, input.width),
      height: Math.max(1, input.height),
      style,
      ...(input.text !== undefined || defaults.text !== undefined ? { text: input.text ?? defaults.text } : {}),
    };
    if (input.kind === 'frame') {
      node.layout = input.layout ?? 'absolute';
      node.clipContent = false;
      if (input.gap !== undefined && Number.isFinite(input.gap)) {
        node.gap = Math.max(0, input.gap);
      }
    }
    if (input.widthSizing) {
      node.widthSizing = input.widthSizing;
    } else if (inFlow) {
      node.widthSizing = 'fixed';
    }
    if (input.heightSizing) {
      node.heightSizing = input.heightSizing;
    } else if (inFlow) {
      node.heightSizing = 'fixed';
    }
    this.nodes.set(id, node);
    if (parent) parent.children.push(id);
    else this.rootIds.push(id);
    this.selectedIds = [id];
    this.bump();
    return node;
  }

  createTree(input: TreeNodeInput, parentId?: string | null): DesignNode {
    const targetParentId = input.parentId !== undefined ? input.parentId : (parentId ?? null);
    const parent = targetParentId ? this.nodes.get(targetParentId) : undefined;
    if (targetParentId && (!parent || parent.kind !== 'frame')) {
      throw new Error('New layers can only be created on the canvas or inside a frame.');
    }
    this.recordBeforeMutation();

    const buildSubtree = (nodeInput: TreeNodeInput, currentParentId: string | null, depth = 0): DesignNode => {
      const rawKind = nodeInput.kind ?? 'frame';
      const kind: NodeKind = ['frame', 'text', 'rect', 'button'].includes(rawKind) ? rawKind : 'frame';
      const id = `${kind}-${++this.nodeCounter}-${Date.now().toString(36)}`;
      const defaults = defaultNodeStyle(kind);
      const currentParent = currentParentId ? this.nodes.get(currentParentId) : undefined;
      const inFlow = isFlexLayout(currentParent?.layout);

      const parsedStyle: NodeStyle = { ...defaults.style, ...(nodeInput.style as NodeStyle) };
      if (nodeInput.padding !== undefined && Number.isFinite(Number(nodeInput.padding))) {
        parsedStyle.padding = Math.max(0, Number(nodeInput.padding));
      }

      const node: DesignNode = {
        id,
        name: nodeInput.name || defaults.name,
        kind,
        parentId: currentParentId,
        children: [],
        x: inFlow ? 0 : (Number.isFinite(Number(nodeInput.x)) ? Number(nodeInput.x) : 0),
        y: inFlow ? 0 : (Number.isFinite(Number(nodeInput.y)) ? Number(nodeInput.y) : 0),
        width: Math.max(1, Number.isFinite(Number(nodeInput.width)) ? Number(nodeInput.width) : (kind === 'frame' ? 320 : kind === 'rect' ? 200 : kind === 'button' ? 140 : 180)),
        height: Math.max(1, Number.isFinite(Number(nodeInput.height)) ? Number(nodeInput.height) : (kind === 'frame' ? 240 : kind === 'rect' ? 140 : 36)),
        style: parsedStyle,
        ...(nodeInput.text !== undefined || defaults.text !== undefined ? { text: nodeInput.text ?? defaults.text } : {}),
        ...(nodeInput.imageSrc ? { imageSrc: nodeInput.imageSrc } : {}),
        ...(nodeInput.referenceId ? { referenceId: nodeInput.referenceId } : {}),
      };

      if (kind === 'frame') {
        node.layout = nodeInput.layout ?? 'flex-column';
        node.clipContent = false;
        if (nodeInput.gap !== undefined && Number.isFinite(Number(nodeInput.gap))) {
          node.gap = Math.max(0, Number(nodeInput.gap));
        }
      }

      if (nodeInput.widthSizing) {
        node.widthSizing = nodeInput.widthSizing;
      } else if (inFlow) {
        node.widthSizing = kind === 'text' ? 'fill' : 'fixed';
      }

      if (nodeInput.heightSizing) {
        node.heightSizing = nodeInput.heightSizing;
      } else if (inFlow) {
        node.heightSizing = kind === 'text' ? 'hug' : 'fixed';
      }

      this.nodes.set(id, node);
      if (currentParent) currentParent.children.push(id);

      if (depth < 20 && Array.isArray(nodeInput.children)) {
        for (const childInput of nodeInput.children) {
          buildSubtree(childInput, id, depth + 1);
        }
      }

      return node;
    };

    const root = buildSubtree(input, targetParentId);
    if (!targetParentId) {
      this.rootIds.push(root.id);
    }
    this.selectedIds = [root.id];
    this.bump();
    return root;
  }

  setLayout(id: string, options: SetLayoutInput): DesignNode {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Design node not found: ${id}`);
    this.recordBeforeMutation();
    this.clearRuntimeBounds(id);

    if (node.kind === 'frame') {
      if (options.layout && options.layout !== node.layout) {
        this.applyLayoutMode(node, options.layout);
      }
      if (options.gap !== undefined && Number.isFinite(Number(options.gap))) {
        node.gap = Math.max(0, Number(options.gap));
      }
    }
    if (options.padding !== undefined && Number.isFinite(Number(options.padding))) {
      node.style = { ...node.style, padding: Math.max(0, Number(options.padding)) };
    }
    if (options.widthSizing) {
      this.applySizingMode(node, 'widthSizing', options.widthSizing);
    }
    if (options.heightSizing) {
      this.applySizingMode(node, 'heightSizing', options.heightSizing);
    }
    this.bump();
    return node;
  }

  moveNodes(ids: string[], dx: number, dy: number): DesignNode[] {
    const targets = this.rootsOf(ids);
    if (!targets.length || (dx === 0 && dy === 0)) return targets;
    this.recordBeforeMutation();
    for (const node of targets) {
      const parent = node.parentId ? this.nodes.get(node.parentId) : undefined;
      if (isFlexLayout(parent?.layout) && parent) {
        const delta = isRowLayout(parent.layout) ? dx : dy;
        const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
        if (step) this.placeChild(parent, node.id, parent.children.indexOf(node.id) + step);
      } else {
        this.clearRuntimeBounds(node.id);
        node.x += dx;
        node.y += dy;
      }
    }
    this.bump();
    return targets;
  }

  reorderChild(parentId: string, childId: string, index: number): void {
    const parent = this.nodes.get(parentId);
    if (!parent || !parent.children.includes(childId)) return;
    this.placeChild(parent, childId, index);
    this.layoutCache = null;
  }

  detachFromFlow(id: string, worldX: number, worldY: number): DesignNode | undefined {
    const node = this.nodes.get(id);
    if (!node?.parentId) return node;
    const parent = this.nodes.get(node.parentId);
    if (!isFlexLayout(parent?.layout)) return node;
    this.recordBeforeMutation();
    parent!.children = parent!.children.filter((childId) => childId !== id);
    node.parentId = null;
    node.x = worldX;
    node.y = worldY;
    node.widthSizing = 'fixed';
    node.heightSizing = 'fixed';
    this.rootIds.push(id);
    this.clearRuntimeBounds(id);
    this.bump();
    return node;
  }

  private placeChild(parent: DesignNode, childId: string, index: number): void {
    const without = parent.children.filter((id) => id !== childId);
    const next = Math.max(0, Math.min(without.length, index));
    if (parent.children[next] === childId) return;
    without.splice(next, 0, childId);
    parent.children = without;
    this.layoutCache = null;
  }

  private applyLayoutMode(node: DesignNode, next: LayoutMode): void {
    const prev = node.layout ?? 'absolute';
    if (prev === next) return;
    const wasFlex = isFlexLayout(prev);
    const nowFlex = isFlexLayout(next);
    if (wasFlex && !nowFlex) {
      for (const childId of node.children) {
        const child = this.nodes.get(childId);
        if (!child) continue;
        const box = this.resolvedBounds(child);
        child.x = box.x;
        child.y = box.y;
        child.width = box.width;
        child.height = box.height;
        child.widthSizing = 'fixed';
        child.heightSizing = 'fixed';
      }
    }
    if (!wasFlex && nowFlex) {
      for (const childId of node.children) {
        const child = this.nodes.get(childId);
        if (!child) continue;
        child.x = 0;
        child.y = 0;
        child.widthSizing = child.widthSizing ?? 'fixed';
        child.heightSizing = child.heightSizing ?? 'fixed';
      }
    }
    node.layout = next;
  }

  private applySizingMode(node: DesignNode, key: 'widthSizing' | 'heightSizing', intent: SizingMode): void {
    if (intent === 'fixed') {
      const box = this.resolvedBounds(node);
      if (key === 'widthSizing') node.width = Math.max(1, box.width);
      else node.height = Math.max(1, box.height);
    }
    node[key] = intent;
  }

  private bump(): void {
    this.layoutCache = null;
    if (!this.liveGesture) this.revision += 1;
    this.emit();
  }

  deleteNodes(ids: string[]): string[] {
    const unique = [...new Set(ids.filter((id) => this.nodes.has(id)))];
    if (!unique.length) return [];
    const roots = unique.filter((id) => {
      let parentId = this.nodes.get(id)?.parentId ?? null;
      while (parentId) {
        if (unique.includes(parentId)) return false;
        parentId = this.nodes.get(parentId)?.parentId ?? null;
      }
      return true;
    });
    this.recordBeforeMutation();
    const removed: string[] = [];
    for (const id of roots) this.removeSubtree(id, removed);
    this.selectedIds = this.selectedIds.filter((id) => this.nodes.has(id));
    if (!this.selectedIds.length && this.rootIds[0]) this.selectedIds = [this.rootIds[0]];
    this.bump();
    return removed;
  }

  private rootsOf(ids: string[]): DesignNode[] {
    const unique = [...new Set(ids)];
    return unique
      .map((id) => this.nodes.get(id))
      .filter((node): node is DesignNode => {
        if (!node) return false;
        let parentId = node.parentId;
        while (parentId) {
          if (unique.includes(parentId)) return false;
          parentId = this.nodes.get(parentId)?.parentId ?? null;
        }
        return true;
      });
  }

  private removeSubtree(id: string, removed: string[]): void {
    const node = this.nodes.get(id);
    if (!node) return;
    for (const childId of [...node.children]) this.removeSubtree(childId, removed);
    this.nodes.delete(id);
    this.runtimeBounds.delete(id);
    this.rootIds = this.rootIds.filter((rootId) => rootId !== id);
    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent) parent.children = parent.children.filter((childId) => childId !== id);
    }
    removed.push(id);
  }

  addReferenceImage(input: { name: string; dataUrl: string; width: number; height: number; x: number; y: number }): DesignNode {
    this.recordBeforeMutation();
    const id = `reference-${++this.referenceCounter}`;
    const node: DesignNode = {
      id,
      name: input.name,
      kind: 'image',
      parentId: null,
      children: [],
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      style: { background: '#111827', border: '1px solid #5c8dff', borderRadius: 12 },
      imageSrc: input.dataUrl,
      referenceId: id,
    };
    this.nodes.set(id, node);
    this.rootIds.push(id);
    this.selectedIds = [id];
    this.bump();
    return node;
  }

  referenceNodes(): DesignNode[] {
    return this.rootIds.map((id) => this.nodes.get(id))
      .filter((node): node is DesignNode => !!node && node.kind === 'image' && !!node.referenceId);
  }

  createEditableRecreation(referenceId: string, name?: string, options?: Record<string, unknown>): DesignNode {
    const reference = this.nodes.get(referenceId);
    if (!reference || reference.kind !== 'image') throw new Error(`Reference image not found: ${referenceId}`);
    this.recordBeforeMutation();
    const id = `recreation-${++this.referenceCounter}`;
    const width = Math.max(420, Math.min(620, Math.round(reference.width * 0.72)));
    const height = Math.max(290, Math.min(420, Math.round(reference.height * 0.72)));
    const x = reference.x + reference.width + 44 + width <= 1500 ? reference.x + reference.width + 44 : 70;
    const y = x === 70 ? reference.y + reference.height + 44 : reference.y;

    const refName = (reference.name || '').toLowerCase();
    const isDark = !refName.includes('light');
    const isEmerald = refName.includes('green') || refName.includes('emerald');
    const isAmber = refName.includes('amber') || refName.includes('gold') || refName.includes('orange');
    const isViolet = refName.includes('purple') || refName.includes('violet') || refName.includes('ai');

    const primaryColor = isEmerald ? '#10b981' : isAmber ? '#f59e0b' : isViolet ? '#8b5cf6' : '#2563eb';
    const accentColor = isEmerald ? '#34d399' : isAmber ? '#fbbf24' : isViolet ? '#a78bfa' : '#8db2ff';
    const bg = isDark ? '#111827' : '#ffffff';
    const textColor = isDark ? '#f8fafc' : '#0f172a';
    const subtextColor = isDark ? '#a9b7cb' : '#475569';
    const borderColor = isDark ? '1px solid #5c8dff' : '1px solid #cbd5e1';

    const customWidth = Number(options?.width);
    const customHeight = Number(options?.height);
    const actualWidth = Number.isFinite(customWidth) && customWidth > 0 ? Math.round(customWidth) : width;
    const actualHeight = Number.isFinite(customHeight) && customHeight > 0 ? Math.round(customHeight) : height;

    const optStyle = (options?.style || options?.styles || options) as Record<string, unknown>;
    const bgOpt = optStyle.background ?? optStyle.backgroundColor ?? optStyle.fill;
    const borderOpt = optStyle.border;
    const borderRadiusOpt = Number(optStyle.borderRadius ?? optStyle.radius);
    const paddingOpt = Number(options?.padding ?? optStyle.padding);

    const hasDynamicChildren = (Array.isArray(options?.children) && options.children.length > 0) || (options?.tree && typeof options.tree === 'object');
    const rawLayout = typeof options?.layout === 'string' ? options.layout : undefined;
    const layout: LayoutMode = rawLayout && ['absolute', 'flex-row', 'flex-column'].includes(rawLayout)
      ? (rawLayout as LayoutMode)
      : (hasDynamicChildren ? 'flex-column' : 'absolute');

    const rawGap = options?.gap !== undefined ? Number(options.gap) : undefined;
    const gap = Number.isFinite(rawGap) ? Math.max(0, Number(rawGap)) : (hasDynamicChildren ? 16 : undefined);

    const rootStyle: NodeStyle = {
      background: typeof bgOpt === 'string' && bgOpt.trim() ? bgOpt.trim() : bg,
      border: typeof borderOpt === 'string' && borderOpt.trim() ? borderOpt.trim() : borderColor,
      borderRadius: Number.isFinite(borderRadiusOpt) ? Math.max(0, borderRadiusOpt) : 16,
      padding: Number.isFinite(paddingOpt) ? Math.max(0, paddingOpt) : (hasDynamicChildren ? 24 : 0),
    };

    const root: DesignNode = {
      id,
      name: name || `Editable recreation · ${reference.name}`,
      kind: 'frame',
      parentId: null,
      children: [],
      x,
      y,
      width: actualWidth,
      height: actualHeight,
      layout,
      ...(gap !== undefined ? { gap } : {}),
      style: rootStyle,
      referenceId,
    };
    const addChild = (child: DesignNode): void => {
      this.nodes.set(child.id, child);
      root.children.push(child.id);
    };
    this.nodes.set(root.id, root);
    this.rootIds.push(root.id);

    if (options?.tree && typeof options.tree === 'object') {
      const treeObj = options.tree as Record<string, unknown>;
      if (Array.isArray(treeObj.children)) {
        for (const childInput of treeObj.children as TreeNodeInput[]) {
          this.createTree(childInput, root.id);
        }
      } else {
        this.createTree(options.tree as TreeNodeInput, root.id);
      }
    } else if (Array.isArray(options?.children) && options.children.length > 0) {
      for (const childInput of options.children as TreeNodeInput[]) {
        this.createTree(childInput, root.id);
      }
    } else {
      addChild(makeNode(`${id}-eyebrow`, 'Reference source', 'text', root.id, 24, 24, actualWidth - 48, 18, {
        color: accentColor, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
      }, (options?.eyebrow as string) || 'REFERENCE-LED RECREATION'));
      addChild(makeNode(`${id}-title`, 'Recreated headline', 'text', root.id, 24, 62, actualWidth - 48, 54, {
        color: textColor, fontSize: 25, fontWeight: 700, letterSpacing: '-0.03em',
      }, (options?.title as string) || name || `Editable direction from ${reference.name}`));
      addChild(makeNode(`${id}-body`, 'Recreated supporting text', 'text', root.id, 26, 130, Math.min(actualWidth - 52, 430), 44, {
        color: subtextColor, fontSize: 12, fontWeight: 400,
      }, (options?.body as string) || 'This frame is editable. Change its copy, style, and structure in the shared document.'));
      addChild(makeNode(`${id}-accent`, 'Reference accent', 'rect', root.id, 26, actualHeight - 82, Math.min(actualWidth - 52, 220), 44, {
        background: primaryColor, borderRadius: 10,
      }, (options?.accentText as string) || undefined));
      addChild(makeNode(`${id}-cta`, 'Recreated action', 'button', root.id, actualWidth - 184, actualHeight - 82, 158, 44, {
        background: '#f59e0b', color: '#111827', borderRadius: 10, fontSize: 12, fontWeight: 700,
      }, (options?.ctaText as string) || 'Edit this direction'));
    }

    this.selectedIds = [root.id];
    this.bump();
    return root;
  }

  touch(recordHistory = true): void {
    if (recordHistory) this.recordBeforeMutation();
    this.bump();
  }

  fingerprint(id: string): string {
    const node = this.nodes.get(id);
    if (!node) return '';
    const children = node.children.map((childId) => this.fingerprint(childId)).join('|');
    return [node.kind, node.name, node.width, node.height, node.text ?? '', node.referenceId ?? '', JSON.stringify(node.style), children].join(':');
  }

  captureSnapshot(): DocumentSnapshot {
    return {
      nodes: clone([...this.nodes.values()]),
      rootIds: [...this.rootIds],
      selectedId: this.selectedId,
      selectedIds: [...this.selectedIds],
      revision: this.revision,
    };
  }

  private restoreSnapshotData(snapshot: DocumentSnapshot): void {
    this.nodes = new Map(clone(snapshot.nodes).map((node) => [node.id, node]));
    this.rootIds = [...snapshot.rootIds];
    this.runtimeBounds.clear();
    this.layoutCache = null;
    this.selectedIds = snapshot.selectedIds?.length
      ? snapshot.selectedIds.filter((id) => this.nodes.has(id))
      : (snapshot.selectedId && this.nodes.has(snapshot.selectedId) ? [snapshot.selectedId] : []);
  }

  restoreSnapshot(snapshot: DocumentSnapshot, options: { clearHistory?: boolean } = {}): void {
    this.restoreSnapshotData(snapshot);
    this.revision = snapshot.revision + 1;
    this.redoStack = [];
    if (options.clearHistory) this.undoStack = [];
    this.emit();
  }

  private recordBeforeMutation(): void {
    if (this.suppressHistory) return;
    this.undoStack.push(this.captureSnapshot());
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean { return this.undoStack.length > 0; }

  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): DocumentSnapshot {
    const previous = this.undoStack.pop();
    if (!previous) throw new Error('There is no document edit to undo.');
    this.redoStack.push(this.captureSnapshot());
    this.restoreSnapshotData(previous);
    this.revision = this.redoStack.at(-1)?.revision ? (this.redoStack.at(-1)?.revision ?? this.revision) + 1 : this.revision + 1;
    this.emit();
    return this.captureSnapshot();
  }

  redo(): DocumentSnapshot {
    const next = this.redoStack.pop();
    if (!next) throw new Error('There is no document edit to redo.');
    this.undoStack.push(this.captureSnapshot());
    this.restoreSnapshotData(next);
    this.revision = this.undoStack.at(-1)?.revision ? (this.undoStack.at(-1)?.revision ?? this.revision) + 1 : this.revision + 1;
    this.emit();
    return this.captureSnapshot();
  }
}

export const store = new ChallengeStore();
