export const TOOL_NAMES = [
  'inspect_canvas',
  'get_design_tree',
  'find_nodes',
  'set_design_text',
  'apply_design_styles',
  'set_layout',
  'add_reference_image',
  'list_reference_images',
  'inspect_reference_image',
  'recreate_from_reference',
  'create_node',
  'create_tree',
  'delete_nodes',
  'move_nodes',
  'resize_node',
  'select_nodes',
  'capture_preview',
  'undo_document',
  'redo_document',
  'import_project',
  'export_design',
  'reset_document',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number] | 'create_component';

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: 'object', properties, required, additionalProperties: false,
});

export const TOOL_SCHEMAS: Record<string, Record<string, unknown>> = {
  inspect_canvas: objectSchema({}),
  get_design_tree: objectSchema({
    rootNodeId: { type: 'string' },
    nodeId: { type: 'string' },
    id: { type: 'string' },
    maxDepth: { type: ['number', 'string'] },
    summary: { type: 'boolean' },
  }),
  find_nodes: objectSchema({
    query: { type: 'string' },
    kind: { type: 'string', enum: ['frame', 'text', 'rect', 'button', 'image'] },
    parentId: { type: 'string' },
    limit: { type: ['number', 'string'] },
  }),
  set_design_text: objectSchema({ nodeId: { type: 'string' }, text: { type: 'string' } }, ['text']),
  apply_design_styles: objectSchema({
    nodeId: { type: 'string' },
    styles: {
      type: 'object',
      properties: {
        background: { type: 'string' },
        backgroundColor: { type: 'string' },
        fill: { type: 'string' },
        color: { type: 'string' },
        textColor: { type: 'string' },
        border: { type: 'string' },
        borderColor: { type: 'string' },
        borderWidth: { type: ['number', 'string'] },
        borderRadius: { type: ['number', 'string'] },
        fontSize: { type: ['number', 'string'] },
        fontWeight: { type: ['number', 'string'] },
        fontFamily: { type: 'string' },
        padding: { type: ['number', 'string'] },
        opacity: { type: ['number', 'string'] },
        letterSpacing: { type: ['number', 'string'] },
      },
    },
    style: {
      type: 'object',
      properties: {
        background: { type: 'string' },
        backgroundColor: { type: 'string' },
        fill: { type: 'string' },
        color: { type: 'string' },
        textColor: { type: 'string' },
        border: { type: 'string' },
        borderColor: { type: 'string' },
        borderWidth: { type: ['number', 'string'] },
        borderRadius: { type: ['number', 'string'] },
        fontSize: { type: ['number', 'string'] },
        fontWeight: { type: ['number', 'string'] },
        fontFamily: { type: 'string' },
        padding: { type: ['number', 'string'] },
        opacity: { type: ['number', 'string'] },
        letterSpacing: { type: ['number', 'string'] },
      },
    },
  }),
  set_layout: objectSchema({
    nodeId: { type: 'string' },
    layout: { type: 'string', enum: ['absolute', 'flex-row', 'flex-column'] },
    gap: { type: ['number', 'string'] },
    padding: { type: ['number', 'string'] },
    widthSizing: { type: 'string', enum: ['fixed', 'fill', 'hug'] },
    heightSizing: { type: 'string', enum: ['fixed', 'fill', 'hug'] },
  }),
  add_reference_image: objectSchema({ name: { type: 'string' }, dataUrl: { type: 'string', maxLength: 2_000_000 }, width: { type: 'number' }, height: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' }, operationId: { type: 'string' } }, ['dataUrl']),
  list_reference_images: objectSchema({}),
  inspect_reference_image: objectSchema({ referenceId: { type: 'string' } }, ['referenceId']),
  recreate_from_reference: objectSchema({
    referenceId: { type: 'string' },
    name: { type: 'string' },
    operationId: { type: 'string' },
    layout: { type: 'string', enum: ['absolute', 'flex-row', 'flex-column'] },
    gap: { type: ['number', 'string'] },
    padding: { type: ['number', 'string'] },
    width: { type: ['number', 'string'] },
    height: { type: ['number', 'string'] },
    style: { type: 'object' },
    eyebrow: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string' },
    accentText: { type: 'string' },
    ctaText: { type: 'string' },
    children: { type: 'array' },
    tree: { type: 'object' },
  }, ['referenceId']),
  create_node: objectSchema({
    kind: { type: 'string', enum: ['frame', 'text', 'rect', 'button'] },
    parentId: { type: 'string' },
    x: { type: ['number', 'string'] },
    y: { type: ['number', 'string'] },
    width: { type: ['number', 'string'] },
    height: { type: ['number', 'string'] },
    name: { type: 'string' },
    text: { type: 'string' },
    layout: { type: 'string', enum: ['absolute', 'flex-row', 'flex-column'] },
    gap: { type: ['number', 'string'] },
    padding: { type: ['number', 'string'] },
    widthSizing: { type: 'string', enum: ['fixed', 'fill', 'hug'] },
    heightSizing: { type: 'string', enum: ['fixed', 'fill', 'hug'] },
    style: { type: 'object' },
  }, ['kind']),
  create_tree: objectSchema({
    parentId: { type: 'string' },
    tree: { type: 'object' },
    root: { type: 'object' },
    kind: { type: 'string', enum: ['frame', 'text', 'rect', 'button'] },
    name: { type: 'string' },
    text: { type: 'string' },
    x: { type: ['number', 'string'] },
    y: { type: ['number', 'string'] },
    width: { type: ['number', 'string'] },
    height: { type: ['number', 'string'] },
    layout: { type: 'string', enum: ['absolute', 'flex-row', 'flex-column'] },
    gap: { type: ['number', 'string'] },
    padding: { type: ['number', 'string'] },
    widthSizing: { type: 'string', enum: ['fixed', 'fill', 'hug'] },
    heightSizing: { type: 'string', enum: ['fixed', 'fill', 'hug'] },
    style: { type: 'object' },
    styles: { type: 'object' },
    children: { type: 'array' },
  }),
  delete_nodes: objectSchema({ nodeId: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' } } }),
  move_nodes: objectSchema({ nodeId: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' } }, dx: { type: ['number', 'string'] }, dy: { type: ['number', 'string'] } }),
  resize_node: objectSchema({ nodeId: { type: 'string' }, x: { type: ['number', 'string'] }, y: { type: ['number', 'string'] }, width: { type: ['number', 'string'] }, height: { type: ['number', 'string'] } }),
  select_nodes: objectSchema({ nodeId: { type: 'string' }, nodeIds: { type: 'array', items: { type: 'string' } } }),
  capture_preview: objectSchema({
    nodeId: { type: 'string' },
    format: { type: 'string', enum: ['png', 'svg'] },
    scale: { type: ['number', 'string'], minimum: 1, maximum: 3 },
  }),
  undo_document: objectSchema({}),
  redo_document: objectSchema({}),
  import_project: objectSchema({ projectJson: { type: 'string', maxLength: 8_000_000 }, operationId: { type: 'string' } }, ['projectJson']),
  export_design: objectSchema({
    format: { type: 'string', enum: ['png', 'svg', 'html', 'json'] },
    nodeId: { type: 'string' },
    scale: { type: 'number', minimum: 1, maximum: 3 },
    filename: { type: 'string', maxLength: 120 },
    includeReferences: { type: 'boolean' },
    baseRevision: { type: 'number' },
    operationId: { type: 'string' },
  }, ['format']),
  reset_document: objectSchema({}),
};

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  inspect_canvas: 'Read the selected artboard, revision, and safe next actions.',
  get_design_tree: 'Read the structured editable node tree with optional maxDepth and summary mode.',
  find_nodes: 'Find design layers matching query, kind, or parent without loading the full tree.',
  set_design_text: 'Change text in one editable node.',
  apply_design_styles: 'Apply a safe style patch to one node with support for standard CSS aliases.',
  set_layout: 'Configure CSS flexbox auto-layout (flex-row, flex-column, absolute), gap, padding, and sizing on a frame.',
  add_reference_image: 'Add a local or pasted image as a visual reference on the canvas.',
  list_reference_images: 'List reference images available for the agent to inspect.',
  inspect_reference_image: 'Inspect one reference image and return it to the agent as image content.',
  recreate_from_reference: 'Create an editable design frame informed by a reference image.',
  create_node: 'Create a new frame, text, rectangle, or button with optional flex auto-layout and styles.',
  create_tree: 'Create an entire nested styled component tree (frame with children, text, buttons, styles, auto-layout) in a single atomic tool call.',
  delete_nodes: 'Delete one or more selected layers, including parent frames.',
  move_nodes: 'Move layers by a dx/dy offset. Parent frames move with their children.',
  resize_node: 'Change a layer\'s x, y, width, or height.',
  select_nodes: 'Select one or more layers in the shared document.',
  capture_preview: 'Capture a PNG preview of the canvas or selected node so vision models can self-correct.',
  undo_document: 'Undo the latest human or agent document edit.',
  redo_document: 'Redo the latest undone document edit.',
  import_project: 'Open a validated Infinite Canvas project JSON file in the shared document.',
  export_design: 'Export the visible design as a downloadable PNG, SVG, HTML, or project JSON artifact.',
  reset_document: 'Return to the default seeded document.',
};

TOOL_SCHEMAS.create_component = TOOL_SCHEMAS.create_tree;
TOOL_DESCRIPTIONS.create_component = TOOL_DESCRIPTIONS.create_tree;

export const READ_ONLY_TOOLS = new Set<string>([
  'inspect_canvas',
  'get_design_tree',
  'find_nodes',
  'list_reference_images',
  'inspect_reference_image',
  'select_nodes',
  'capture_preview',
]);

export const DESTRUCTIVE_TOOLS = new Set<string>([
  'delete_nodes',
  'reset_document',
  'import_project',
]);

export function isKnownTool(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name) || name === 'create_component';
}

export function gatewayToolDefinitions(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
  return TOOL_NAMES.map((name) => ({
    type: 'function' as const,
    function: {
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters: TOOL_SCHEMAS[name],
    },
  }));
}

export function responsesToolDefinitions(): Array<{ type: 'function'; name: string; description: string; parameters: Record<string, unknown> }> {
  return TOOL_NAMES.map((name) => ({
    type: 'function' as const,
    name,
    description: TOOL_DESCRIPTIONS[name],
    parameters: TOOL_SCHEMAS[name],
  }));
}
