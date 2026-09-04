import { handleChallengeTool } from './tools';
import {
  DESTRUCTIVE_TOOLS,
  READ_ONLY_TOOLS,
  TOOL_DESCRIPTIONS,
  TOOL_NAMES,
  TOOL_SCHEMAS,
} from './tool-catalog';

export { TOOL_NAMES, TOOL_SCHEMAS };

export interface WebMcpToolDefinition {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
}

export interface RegisteredWebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface ModelContextLike {
  registerTool(tool: WebMcpToolDefinition, options?: { signal?: AbortSignal }): Promise<void>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredWebMcpTool[]>;
  executeTool(tool: RegisteredWebMcpTool | string, input?: string | Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<string>;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean): void;
}

type ModelContextHost = { modelContext?: ModelContextLike };

function parseToolInput(input: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (typeof input === 'string') {
    const raw = input.trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  return {};
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result == null) return '';
  try { return JSON.stringify(result); }
  catch { return String(result); }
}

export function createModelContextPolyfill(): ModelContextLike {
  const tools = new Map<string, WebMcpToolDefinition>();
  const target = new EventTarget();

  const notify = () => { target.dispatchEvent(new Event('toolchange')); };

  const context: ModelContextLike = {
    async registerTool(tool, options) {
      const name = tool?.name?.trim() ?? '';
      const description = tool?.description?.trim() ?? '';
      if (!name || !description) throw new Error('Tool name and description are required.');
      if (tools.has(name)) throw new Error(`A tool named ${name} is already registered.`);
      tools.set(name, tool);
      if (options?.signal) {
        if (options.signal.aborted) {
          tools.delete(name);
          notify();
          return;
        }
        options.signal.addEventListener('abort', () => {
          tools.delete(name);
          notify();
        }, { once: true });
      }
      notify();
    },
    async getTools() {
      return [...tools.values()]
        .map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }))
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async executeTool(tool, input, options) {
      const name = typeof tool === 'string' ? tool : tool?.name;
      const definition = name ? tools.get(name) : undefined;
      if (!definition) throw new Error(`WebMCP tool is not registered: ${name ?? ''}`);
      const result = await definition.execute(parseToolInput(input), { signal: options?.signal });
      return stringifyToolResult(result);
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  return context;
}

export function readBrowserModelContext(host: { document?: ModelContextHost; navigator?: ModelContextHost } = globalThis as { document?: ModelContextHost; navigator?: ModelContextHost }): ModelContextLike | undefined {
  const context = host.document?.modelContext ?? host.navigator?.modelContext;
  return typeof context?.registerTool === 'function' ? context : undefined;
}

export function installModelContextPolyfill(host: { document?: Document & ModelContextHost; navigator?: ModelContextHost } = globalThis as { document?: Document & ModelContextHost; navigator?: ModelContextHost }): ModelContextLike {
  const existing = readBrowserModelContext(host);
  if (existing) return existing;
  const polyfill = createModelContextPolyfill();
  const target = host.document;
  if (!target) return polyfill;
  try {
    Object.defineProperty(target, 'modelContext', { configurable: true, enumerable: true, value: polyfill });
  } catch {
    target.modelContext = polyfill;
  }
  return polyfill;
}

function toolDefinitions(): WebMcpToolDefinition[] {
  return TOOL_NAMES.map((name) => ({
    name,
    title: name.replaceAll('_', ' '),
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: TOOL_SCHEMAS[name],
    annotations: {
      readOnlyHint: READ_ONLY_TOOLS.has(name),
      destructiveHint: DESTRUCTIVE_TOOLS.has(name),
      ...(name === 'inspect_reference_image' ? { untrustedContentHint: true } : {}),
    },
    execute: async (input: Record<string, unknown>, { signal }: { signal?: AbortSignal } = {}) => {
      const result = await handleChallengeTool(name, input ?? {}, signal);
      return JSON.stringify(result);
    },
  }));
}

export async function registerWebMcp(): Promise<{ count: number; native: boolean }> {
  const native = !!readBrowserModelContext();
  const context = installModelContextPolyfill();
  const definitions = toolDefinitions();
  for (const definition of definitions) {
    try {
      await context.registerTool(definition);
    } catch (error) {
      console.warn(`WebMCP registration failed for ${definition.name}`, error);
    }
  }
  const registry = (window as unknown as { __canvasWebMcp?: Record<string, unknown>; __canvasToolCount?: number; __canvasWebMcpNative?: boolean });
  registry.__canvasWebMcp = Object.fromEntries(definitions.map((definition) => [definition.name, definition]));
  registry.__canvasToolCount = definitions.length;
  registry.__canvasWebMcpNative = native;
  setWebMcpStatus(definitions.length > 0, definitions.length);
  document.dispatchEvent(new CustomEvent('canvas:webmcp-ready', { detail: { count: definitions.length, native } }));
  return { count: definitions.length, native };
}

export function setWebMcpStatus(ready: boolean, count = (window as unknown as { __canvasToolCount?: number }).__canvasToolCount ?? 0): void {
  const status = document.getElementById('webmcp-status');
  if (!status) return;
  const available = ready && count > 0;
  const nextState = available ? `ready:${count}` : 'unavailable';
  if (status.dataset.webmcpState === nextState) return;
  status.dataset.webmcpState = nextState;
  status.classList.toggle('is-unavailable', !available);
  status.classList.toggle('is-ready', available);
  status.classList.toggle('has-popover', !available);

  if (available) {
    status.replaceChildren();
    status.title = '';
    status.setAttribute('aria-label', `WebMCP ready · ${count}`);
    status.removeAttribute('aria-describedby');
    status.removeAttribute('tabindex');
    const dot = document.createElement('span');
    dot.className = 'webmcp-live-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = `WebMCP ready · ${count}`;
    status.append(dot, label);
    return;
  }

  status.title = 'Open in an AI browser to connect.';
  status.tabIndex = 0;
  status.setAttribute('aria-label', 'Tools unavailable');
  status.setAttribute('aria-describedby', 'webmcp-status-tip');
  status.replaceChildren();

  const icon = document.createElement('span');
  icon.className = 'webmcp-status-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.4 14.6 13.2H1.4L8 1.4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.2v3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.2" r="0.9" fill="currentColor"/></svg>';

  const tip = document.createElement('span');
  tip.id = 'webmcp-status-tip';
  tip.className = 'webmcp-status-popover';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = 'Open in an AI browser to connect.';

  status.append(icon, tip);
}
