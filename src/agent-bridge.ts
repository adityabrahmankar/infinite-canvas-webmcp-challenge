import { isKnownTool } from './tool-catalog';

type ToolResult = { isError?: boolean; content?: Array<{ type: string; text?: string }>; structuredContent?: unknown };

type RegisteredTool = { name: string };

type ModelContext = {
  getTools?: () => Promise<RegisteredTool[]>;
  executeTool?: (tool: RegisteredTool, input: string) => Promise<unknown>;
};

function parseUnknown(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function resolveModelContext(): ModelContext | undefined {
  const fromDocument = (document as unknown as { modelContext?: ModelContext }).modelContext;
  const fromNavigator = (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  const context = fromDocument ?? fromNavigator;
  return typeof context?.getTools === 'function' && typeof context.executeTool === 'function' ? context : undefined;
}

async function runNativeWebMcp(name: string, args: Record<string, unknown>): Promise<unknown> {
  const context = resolveModelContext();
  const getTools = context?.getTools;
  const executeTool = context?.executeTool;
  if (!getTools || !executeTool) return null;
  const tools = await getTools.call(context);
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`WebMCP tool is not registered: ${name}`);
  return executeTool.call(context, tool, JSON.stringify(args ?? {}));
}

export async function runCanvasTool(name: string, args: Record<string, unknown> = {}): Promise<{
  ok: boolean;
  name: string;
  via: 'webmcp' | 'fallback';
  result: unknown;
}> {
  if (!isKnownTool(name)) throw new Error(`Unknown tool: ${name}`);

  const native = await runNativeWebMcp(name, args);
  if (native !== null) {
    const parsed = parseUnknown(native) as ToolResult;
    return {
      ok: parsed?.isError !== true,
      name,
      via: 'webmcp',
      result: parsed?.structuredContent ?? parsed?.content?.map((part) => part.text).filter(Boolean).join('\n') ?? parsed,
    };
  }

  const testing = (navigator as unknown as { modelContextTesting?: { executeTool?: (tool: string, input: string) => Promise<unknown> } }).modelContextTesting;
  if (typeof testing?.executeTool === 'function') {
    const raw = await testing.executeTool(name, JSON.stringify(args ?? {}));
    return { ok: true, name, via: 'webmcp', result: parseUnknown(raw) };
  }

  const registry = (window as unknown as { __canvasWebMcp?: Record<string, { execute?: (input: Record<string, unknown>) => Promise<ToolResult> }> }).__canvasWebMcp;
  const tool = registry?.[name];
  if (typeof tool?.execute !== 'function') throw new Error(`WebMCP tool is not registered: ${name}`);
  const result = await tool.execute(args ?? {});
  return {
    ok: result?.isError !== true,
    name,
    via: 'fallback',
    result: result?.structuredContent ?? result?.content?.map((part) => part.text).filter(Boolean).join('\n') ?? result,
  };
}
