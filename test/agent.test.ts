import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  AGENT_SYSTEM_PROMPT,
  AGENT_MODELS,
  chipCacheKey,
  compactToolResult,
  DEFAULT_AGENT_MODEL,
  formatCanvasContext,
  isAllowedModel,
  MAX_AGENT_IMAGE_CHARS,
  MAX_AGENT_MESSAGE,
  modelHasVision,
  normalizeToolCalls,
  PROMPT_CHIPS,
  reasoningForModel,
  sanitizeAgentImages,
  sanitizeCanvasContext,
  sanitizeConversationHistory,
  sanitizeUserMessage,
  userMessageText,
} from '../src/agent-protocol';
import { createModelContextPolyfill, readBrowserModelContext } from '../src/webmcp';
import { DESTRUCTIVE_TOOLS, gatewayToolDefinitions, READ_ONLY_TOOLS, responsesToolDefinitions, TOOL_DESCRIPTIONS, TOOL_NAMES, TOOL_SCHEMAS } from '../src/tool-catalog';
import { parseGatewayOutput, toGatewayMessages } from '../worker/gateway';
import { AGENT_REQUEST_LIMIT, isLocalRequest, remainingRequests, RATE_LIMIT_MESSAGE, shouldEnforceRateLimit } from '../worker/limits';
import { parseAgentThread, rewindMessages, serializeAgentThread, threadTurnsFromMessages } from '../src/persist';

describe('in-page agent protocol', () => {
  test('exposes WebMCP showcase chips and Gateway models', () => {
    assert.equal(PROMPT_CHIPS.length, 3);
    assert.equal(PROMPT_CHIPS[0]?.label, 'Hello from WebMCP');
    assert.match(PROMPT_CHIPS[0]?.prompt ?? '', /Hello WebMCP/);
    assert.match(PROMPT_CHIPS[0]?.prompt ?? '', /create_tree/);
    assert.ok(PROMPT_CHIPS.every((chip) => chip.prompt.length <= MAX_AGENT_MESSAGE));
    assert.ok(PROMPT_CHIPS.some((chip) => chip.prompt.includes('inspect_canvas')));
    assert.ok(PROMPT_CHIPS.some((chip) => chip.prompt.includes('export_design')));
    assert.equal(DEFAULT_AGENT_MODEL, 'google/gemini-3.8-flash');
    assert.ok(isAllowedModel(DEFAULT_AGENT_MODEL));
    assert.ok(isAllowedModel('meta/muse-spark-1.3-contributor'));
    assert.equal(AGENT_MODELS.length, 2);
    assert.equal(reasoningForModel(DEFAULT_AGENT_MODEL), 'xhigh');
    assert.equal(reasoningForModel('meta/muse-spark-1.3-contributor'), 'xhigh');
    assert.equal(AGENT_MODELS[0]?.label, 'Fast');
    assert.equal(AGENT_MODELS[0]?.id, 'google/gemini-3.8-flash');
    assert.equal(AGENT_MODELS[0]?.vision, true);
    assert.equal(AGENT_MODELS[1]?.label, 'Best');
    assert.equal(AGENT_MODELS[1]?.id, 'meta/muse-spark-1.3-contributor');
    assert.equal(AGENT_MODELS[1]?.vision, true);
  });

  test('does not lock the agent to a built-in color system over user-requested colors', () => {
    assert.equal(AGENT_SYSTEM_PROMPT.includes('#0f172a'), false);
    assert.equal(AGENT_SYSTEM_PROMPT.includes('#111827'), false);
    assert.equal(AGENT_SYSTEM_PROMPT.includes('#1e293b'), false);
    assert.match(AGENT_SYSTEM_PROMPT, /no built-in theme/i);
    assert.match(AGENT_SYSTEM_PROMPT, /requested colors exactly/i);
    assert.match(AGENT_SYSTEM_PROMPT, /Never substitute/i);
  });

  test('accepts compact data-URL images and drops anything else', () => {
    const tiny = `data:image/png;base64,${'A'.repeat(24)}`;
    const images = sanitizeAgentImages([
      { name: 'hero.png', dataUrl: tiny, width: 120, height: 80 },
      { name: 'skip', dataUrl: 'https://example.com/x.png' },
      { name: 'huge', dataUrl: `data:image/jpeg;base64,${'B'.repeat(MAX_AGENT_IMAGE_CHARS + 8)}` },
    ]);
    assert.equal(images.length, 1);
    assert.equal(images[0]?.name, 'hero.png');
    assert.equal(modelHasVision(DEFAULT_AGENT_MODEL), true);
    assert.equal(modelHasVision('google/gemini-3.8-flash'), true);
    assert.equal(modelHasVision('zai/glm-5.3-promo-50'), false);
  });

  test('sends a compact live selection snapshot with the user turn', () => {
    const context = sanitizeCanvasContext({
      revision: 4,
      artboard: { id: 'welcome', name: 'Getting Started' },
      selected: [
        { id: 'hero-title', name: 'Hero title', kind: 'text', text: 'Infinite Canvas', width: 320, height: 48, parentName: 'Hero', fontSize: 28, color: '#0f172a' },
        { id: '', name: 'skip', kind: 'frame' },
      ],
    });
    assert.equal(context?.selected.length, 1);
    assert.match(formatCanvasContext(context!), /id=hero-title/);
    assert.match(formatCanvasContext(context!), /Infinite Canvas/);
    const packed = userMessageText({
      role: 'user',
      content: 'Make this bolder',
      canvasContext: formatCanvasContext(context!),
    });
    assert.match(packed, /Live canvas selection/);
    assert.match(packed, /Make this bolder/);
    assert.equal(sanitizeCanvasContext({ selected: [] }), undefined);
    const chip = PROMPT_CHIPS[0];
    assert.equal(chipCacheKey(chip.prompt, DEFAULT_AGENT_MODEL, 'hero-title'), `chip:${chip.id}:${DEFAULT_AGENT_MODEL}:hero-title`);
  });

  test('rate-limits prompt size and unknown tools', () => {
    assert.equal(sanitizeUserMessage('  hello   world  '), 'hello world');
    assert.equal(sanitizeUserMessage('x'.repeat(2000)).length, MAX_AGENT_MESSAGE);
    assert.deepEqual(normalizeToolCalls([
      { id: '1', function: { name: 'inspect_canvas', arguments: '{}' } },
      { id: '2', function: { name: 'rm_rf', arguments: '{}' } },
    ]).map((call) => call.name), ['inspect_canvas']);
  });

  test('chip prompts share a stable cache key', () => {
    const chip = PROMPT_CHIPS[0];
    assert.equal(chipCacheKey(chip.prompt, DEFAULT_AGENT_MODEL), `chip:${chip.id}:${DEFAULT_AGENT_MODEL}`);
    assert.equal(chipCacheKey('a custom prompt', DEFAULT_AGENT_MODEL), undefined);
  });

  test('strips heavy image and export payloads before they hit the model', () => {
    const compact = compactToolResult({ dataUrl: 'data:image/png;base64,AAAA', data: '<svg></svg>', filename: 'art.svg' });
    assert.match(compact, /art\.svg/);
    assert.equal(compact.includes('data:image'), false);
    assert.equal(compact.includes('<svg'), false);
  });

  test('keeps the full 22 WebMCP tools for the Gateway loop', () => {
    assert.equal(TOOL_NAMES.length, 22);
    assert.equal(gatewayToolDefinitions().length, 22);
    assert.equal(responsesToolDefinitions().length, 22);
    assert.equal(responsesToolDefinitions()[0]?.name, 'inspect_canvas');
    assert.equal(READ_ONLY_TOOLS.has('inspect_canvas'), true);
    assert.equal(READ_ONLY_TOOLS.has('find_nodes'), true);
    assert.equal(READ_ONLY_TOOLS.has('capture_preview'), true);
    assert.equal(DESTRUCTIVE_TOOLS.has('delete_nodes'), true);
  });

  test('parses OpenAI-style tool calls from AI Gateway output', () => {
    const parsed = parseGatewayOutput({
      choices: [{
        message: {
          content: '',
          tool_calls: [{ id: 'call_1', function: { name: 'inspect_canvas', arguments: '{}' } }],
        },
      }],
    });
    assert.equal(parsed.toolCalls[0]?.name, 'inspect_canvas');
  });

  test('reads array content and reasoning-only replies from chat completions', () => {
    const arrayed = parseGatewayOutput({
      choices: [{ message: { content: [{ type: 'text', text: 'Built the hero.' }] } }],
    });
    assert.equal(arrayed.text, 'Built the hero.');

    const reasoned = parseGatewayOutput({
      choices: [{ message: { content: null, reasoning_content: 'The hero should use navy.' } }],
    });
    assert.equal(reasoned.text, 'The hero should use navy.');
    assert.equal(reasoned.reasoning, 'The hero should use navy.');

    const tools = parseGatewayOutput({
      choices: [{
        message: {
          content: [{ type: 'text', text: '' }],
          reasoning_content: 'I will inspect first.',
          tool_calls: [{ id: 'c1', function: { name: 'inspect_canvas', arguments: '{}' } }],
        },
      }],
    });
    assert.equal(tools.text, '');
    assert.equal(tools.reasoning, 'I will inspect first.');
    assert.equal(tools.toolCalls[0]?.name, 'inspect_canvas');
  });

  test('parses GPT-5.6 Sol Responses API text and function calls', () => {
    const parsed = parseGatewayOutput({
      object: 'response',
      output_text: '',
      output: [
        { type: 'reasoning', summary: [] },
        {
          type: 'function_call',
          call_id: 'call_inspect',
          name: 'inspect_canvas',
          arguments: '{}',
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Inspecting the canvas.' }],
        },
      ],
    });
    assert.equal(parsed.text, 'Inspecting the canvas.');
    assert.equal(parsed.toolCalls[0]?.id, 'call_inspect');
    assert.equal(parsed.toolCalls[0]?.name, 'inspect_canvas');
  });

  test('skips chat rate limits on localhost and honors the deployed flag', () => {
    const local = new Request('http://127.0.0.1:8787/api/agent/chat', { headers: { host: '127.0.0.1:8787' } });
    const deployed = new Request('https://example.workers.dev/api/agent/chat', { headers: { host: 'example.workers.dev' } });
    assert.equal(isLocalRequest(local), true);
    assert.equal(shouldEnforceRateLimit(local, { ENFORCE_RATE_LIMIT: 'true' }), false);
    assert.equal(isLocalRequest(deployed), false);
    assert.equal(shouldEnforceRateLimit(deployed, { ENFORCE_RATE_LIMIT: 'true' }), true);
    assert.equal(shouldEnforceRateLimit(deployed, { ENFORCE_RATE_LIMIT: 'false' }), false);
    assert.equal(AGENT_REQUEST_LIMIT, 5);
    assert.match(RATE_LIMIT_MESSAGE, /Codex's in-app browser/i);
    assert.match(RATE_LIMIT_MESSAGE, /unlimited/i);
    assert.equal(remainingRequests(0, false), 5);
    assert.equal(remainingRequests(2, false), 3);
    assert.equal(remainingRequests(5, false), 0);
    assert.equal(remainingRequests(9, false), 0);
    assert.equal(remainingRequests(4, true), 999);
  });

  test('sanitizes conversation history against orphaned tool messages and unfulfilled calls', () => {
    // 1. Orphaned tool message before user turn is dropped
    const leadingTool = sanitizeConversationHistory([
      { role: 'tool', content: 'Orphaned', toolCallId: 'c1' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
    assert.equal(leadingTool.length, 2);
    assert.equal(leadingTool[0]?.role, 'user');

    // 2. Aborted turn with unfulfilled toolCalls has toolCalls stripped to avoid OpenAI 400
    const abortedTurn = sanitizeConversationHistory([
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'Let me help', toolCalls: [{ id: 'call_aborted', name: 'create_node', arguments: {} }] },
      { role: 'user', content: 'Turn 2' },
    ]);
    assert.equal(abortedTurn.length, 3);
    assert.equal(abortedTurn[1]?.toolCalls, undefined);
    assert.equal(abortedTurn[1]?.content, 'Let me help');

    // 3. Complete turn preserves paired tool calls and tool responses
    const completeTurn = sanitizeConversationHistory([
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'inspect_canvas', arguments: {} }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'c1' },
      { role: 'assistant', content: 'Done.' },
    ]);
    assert.equal(completeTurn.length, 4);
    // 4. Sliding window with maxMessages always anchors to a user turn
    const longHistory = [
      { role: 'user' as const, content: 'Turn 1' },
      { role: 'assistant' as const, content: 'A1' },
      { role: 'user' as const, content: 'Turn 2' },
      { role: 'assistant' as const, content: 'A2' },
      { role: 'tool' as const, content: 'T2', toolCallId: 'c2' },
      { role: 'assistant' as const, content: 'A2 done' },
    ];
    const sliced = sanitizeConversationHistory(longHistory, 4);
    assert.ok(sliced.length > 0);
    assert.equal(sliced[0]?.role, 'user');
    assert.equal(sliced[0]?.content, 'Turn 2');
  });

  test('formats multimodal tool results for vision feedback loop in Gateway messages', () => {
    const previewDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const messages = toGatewayMessages([
      { role: 'user', content: 'Show me the card' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_preview', name: 'capture_preview', arguments: {} }] },
      {
        role: 'tool',
        toolCallId: 'call_preview',
        content: '{"previewAvailable":true}',
        images: [{ name: 'capture_preview', dataUrl: previewDataUrl }],
      },
    ]);
    const toolMessage = messages.find((m) => m.role === 'tool');
    assert.ok(toolMessage);
    assert.equal(Array.isArray(toolMessage.content), true);
    const content = toolMessage.content as Array<{ type: string; image_url?: { url: string }; text?: string }>;
    assert.equal(content[0]?.type, 'text');
    assert.equal(content[1]?.type, 'image_url');
    assert.equal(content[1]?.image_url?.url, previewDataUrl);
  });

  test('provides valid schema and description for create_component alias and relaxed create_tree schema', () => {
    assert.ok(TOOL_SCHEMAS.create_component);
    assert.deepEqual(TOOL_SCHEMAS.create_component, TOOL_SCHEMAS.create_tree);
    assert.ok(TOOL_DESCRIPTIONS.create_component);
    assert.equal(TOOL_DESCRIPTIONS.create_component, TOOL_DESCRIPTIONS.create_tree);

    const treeProps = (TOOL_SCHEMAS.create_tree as { properties: Record<string, { type: unknown }> }).properties;
    assert.deepEqual(treeProps.gap?.type, ['number', 'string']);
    assert.deepEqual(treeProps.padding?.type, ['number', 'string']);
    assert.deepEqual(treeProps.width?.type, ['number', 'string']);
    assert.deepEqual(treeProps.height?.type, ['number', 'string']);
    assert.ok(treeProps.root);
  });
});

describe('agent UI helpers', () => {
  test('pulls canvas node ids out of tool results so orbs can sit on the frame', async () => {
    const { nodeIdsFromToolResult } = await import('../src/agent-activity.ts');
    assert.deepEqual(nodeIdsFromToolResult({ id: 'greeting-card', name: 'Greeting Card' }), ['greeting-card']);
    assert.deepEqual(
      nodeIdsFromToolResult({ selected: { id: 'hero-title' }, artboards: [{ id: 'welcome' }] }),
      ['welcome', 'hero-title'],
    );
    assert.deepEqual(nodeIdsFromToolResult('{"id":"frame-1"}'), ['frame-1']);
    assert.deepEqual(nodeIdsFromToolResult({ ok: true }, ['fallback']), ['fallback']);
  });

  test('WebMCP polyfill registers, lists, and executes tools like Chrome modelContext', async () => {
    const context = createModelContextPolyfill();
    await context.registerTool({
      name: 'inspect_canvas',
      title: 'inspect canvas',
      description: 'Inspect the live canvas.',
      inputSchema: { type: 'object', properties: {} },
      execute: async (input) => JSON.stringify({ selected: 'artboard-main', query: input }),
    });
    const tools = await context.getTools();
    assert.equal(tools[0]?.name, 'inspect_canvas');
    const fromObject = await context.executeTool(tools[0]!, '{}');
    assert.match(fromObject, /artboard-main/);
    const fromName = await context.executeTool('inspect_canvas', { ping: true });
    assert.match(fromName, /"ping":true/);
    await assert.rejects(() => context.registerTool({
      name: 'inspect_canvas',
      description: 'Duplicate',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => '',
    }));
    assert.equal(readBrowserModelContext({ document: {}, navigator: {} }), undefined);
  });

  test('renders markdown headings, strike, and fenced code', async () => {
    const { renderMarkdown } = await import('../src/markdown.ts');
    const html = renderMarkdown('# Title\n\nThis is ~~old~~ **bold**.\n\n```ts\nconst x = 1;\n```');
    assert.match(html, /agent-md-h1/);
    assert.match(html, /<del>old<\/del>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /agent-md-codeblock/);
    assert.match(html, /data-copy-code/);
  });

  test('serializes the agent thread without image payloads and hydrates it after reload', () => {
    const raw = serializeAgentThread([{
      id: 'turn-1',
      message: 'Make the hero crimson.',
      images: [{ name: 'ref.png', dataUrl: 'data:image/png;base64,AAAA', width: 40, height: 20 }],
      contextLabel: 'Hero Title',
      blocks: [
        { type: 'tools', steps: [{ name: 'set_design_text', arguments: { nodeId: 'hero-title', text: 'Ship faster' }, result: '{"id":"hero-title"}', ok: true }] },
        { type: 'reply', text: 'Updated the headline.', reasoning: 'User asked for crimson copy.', durationSec: 4 },
      ],
    }]);
    assert.equal(raw.includes('data:image/png;base64,AAAA'), false);
    const turns = parseAgentThread(raw);
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.message, 'Make the hero crimson.');
    assert.equal(turns[0]?.images[0]?.dataUrl, '');
    assert.equal(turns[0]?.blocks[0]?.type, 'tools');
    assert.equal(turns[0]?.blocks[1]?.type, 'reply');
  });

  test('rebuilds chat turns from worker history and can rewind to earlier user turns', () => {
    const messages = [
      { role: 'user' as const, content: 'Inspect the canvas.' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'c1', name: 'inspect_canvas', arguments: {} }] },
      { role: 'tool' as const, toolCallId: 'c1', content: '{"revision":3}' },
      { role: 'assistant' as const, content: 'The selected layer is Hero Title.', reasoning: 'Read the tree first.' },
      { role: 'user' as const, content: 'Now recolor it.' },
      { role: 'assistant' as const, content: 'Done.' },
    ];
    const turns = threadTurnsFromMessages(messages);
    assert.equal(turns.length, 2);
    assert.equal(turns[0]?.message, 'Inspect the canvas.');
    assert.equal(turns[0]?.blocks.some((block) => block.type === 'tools' && block.steps[0]?.name === 'inspect_canvas'), true);
    assert.equal(turns[0]?.blocks.some((block) => block.type === 'reply' && block.text.includes('Hero Title')), true);
    assert.equal(turns[1]?.message, 'Now recolor it.');
    const kept = rewindMessages(messages, 1);
    assert.equal(kept.filter((message) => message.role === 'user').length, 1);
    assert.equal(kept.at(-1)?.content, 'The selected layer is Hero Title.');
    assert.deepEqual(rewindMessages(messages, 0), []);
  });
});
