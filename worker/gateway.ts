import {
  AGENT_SYSTEM_PROMPT,
  chipCacheKey,
  normalizeToolCalls,
  reasoningForModel,
  userMessageText,
  type AgentChatMessage,
  type AgentToolCall,
} from '../src/agent-protocol';
import { gatewayToolDefinitions } from '../src/tool-catalog';

export const VERCEL_AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

export const GATEWAY_FALLBACK_MODELS = [
  'zai/glm-5.3-promo-50',
  'minimax/minimax-m3',
] as const;

export interface GatewayResult {
  text: string;
  toolCalls: AgentToolCall[];
  reasoning?: string;
  cacheStatus?: string;
  raw: unknown;
}

export function toGatewayMessages(messages: AgentChatMessage[]): Array<Record<string, unknown>> {
  return [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    ...messages.map((message) => {
      if (message.role === 'tool') {
        if (message.images?.length) {
          return {
            role: 'tool',
            tool_call_id: message.toolCallId,
            content: [
              { type: 'text', text: message.content },
              ...message.images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
            ],
          };
        }
        return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
      }
      if (message.role === 'assistant' && message.toolCalls?.length) {
        return {
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          })),
        };
      }
      if (message.role === 'user' && message.images?.length) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: userMessageText(message) },
            ...message.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
          ],
        };
      }
      if (message.role === 'user' && message.canvasContext) {
        return { role: 'user', content: userMessageText(message) };
      }
      return { role: message.role, content: message.content };
    }),
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function collectReasoningText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(collectReasoningText).filter(Boolean).join('\n').trim();
  const record = asRecord(value);
  if (!record) return '';
  if (typeof record.text === 'string') return record.text.trim();
  if (typeof record.reasoning === 'string') return record.reasoning.trim();
  if (typeof record.reasoning_content === 'string') return record.reasoning_content.trim();
  const parts = [record.summary, record.content, record.reasoning_details, record.details]
    .map(collectReasoningText)
    .filter(Boolean);
  return parts.join('\n').trim();
}

function extractReasoning(raw: unknown, message: Record<string, unknown>): string {
  const result = unwrapResult(raw);
  const fromMessage = collectReasoningText(message.reasoning)
    || collectReasoningText(message.reasoning_content)
    || collectReasoningText(message.reasoning_details);
  if (fromMessage) return fromMessage;
  const fromResult = collectReasoningText(result.reasoning) || collectReasoningText(result.reasoning_content);
  if (fromResult) return fromResult;
  const output = Array.isArray(result.output) ? result.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (!record || (record.type !== 'reasoning' && record.type !== 'thinking')) continue;
    const text = collectReasoningText(record.summary) || collectReasoningText(record.content) || collectReasoningText(record);
    if (text) chunks.push(text);
  }
  return chunks.join('\n').trim();
}

function unwrapResult(raw: unknown): Record<string, unknown> {
  const record = asRecord(raw) ?? {};
  return asRecord(record.result) ?? record;
}

function extractChatMessage(raw: unknown): Record<string, unknown> {
  const result = unwrapResult(raw);
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const choice = asRecord(choices[0]);
  return asRecord(choice?.message) ?? asRecord(result.message) ?? result;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const record = asRecord(part);
        if (!record) return '';
        if (typeof record.text === 'string') return record.text;
        if (typeof record.content === 'string') return record.content;
        if (Array.isArray(record.content)) return contentToText(record.content);
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  const record = asRecord(content);
  return record && typeof record.text === 'string' ? record.text.trim() : '';
}

function extractChatText(message: Record<string, unknown>, raw: unknown): string {
  const result = unwrapResult(raw);
  const record = asRecord(raw) ?? {};
  const fromContent = contentToText(message.content);
  if (fromContent) return fromContent;
  if (typeof message.refusal === 'string' && message.refusal.trim()) return message.refusal.trim();
  if (typeof record.response === 'string' && record.response.trim()) return record.response.trim();
  if (typeof result.response === 'string' && result.response.trim()) return result.response.trim();
  return '';
}

function extractResponsesText(raw: unknown): string {
  const result = unwrapResult(raw);
  if (typeof result.output_text === 'string' && result.output_text.trim()) return result.output_text;
  const output = Array.isArray(result.output) ? result.output : [];
  const texts: string[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (!record || record.type !== 'message') continue;
    const content = Array.isArray(record.content) ? record.content : [];
    for (const part of content) {
      const piece = asRecord(part);
      if (piece && typeof piece.text === 'string' && (piece.type === 'output_text' || piece.type === 'text')) {
        texts.push(piece.text);
      }
    }
  }
  return texts.join('\n');
}

function extractResponsesToolCalls(raw: unknown): unknown[] {
  const result = unwrapResult(raw);
  const output = Array.isArray(result.output) ? result.output : [];
  const calls: unknown[] = [];
  for (const item of output) {
    const record = asRecord(item);
    if (!record) continue;
    if (record.type === 'function_call' || record.type === 'tool_call') {
      calls.push({
        id: record.call_id ?? record.id,
        call_id: record.call_id,
        name: record.name,
        arguments: record.arguments,
      });
    }
  }
  return calls;
}

function gatewayError(raw: unknown, status?: number): string | undefined {
  const record = asRecord(raw) ?? {};
  const nested = asRecord(record.error) ?? asRecord(unwrapResult(raw).error);
  if (typeof record.error === 'string') return record.error;
  if (nested && typeof nested.message === 'string') return nested.message;
  if (typeof record.message === 'string' && (record.success === false || (status && status >= 400))) return record.message;
  return undefined;
}

export function parseGatewayOutput(raw: unknown, cacheStatus?: string): GatewayResult {
  const result = unwrapResult(raw);
  const isResponses = Array.isArray(result.output) || typeof result.output_text === 'string' || result.object === 'response';
  if (isResponses) {
    const toolCalls = normalizeToolCalls(extractResponsesToolCalls(raw));
    const reasoning = extractReasoning(raw, {});
    const text = extractResponsesText(raw).trim();
    return {
      text: text || (toolCalls.length ? '' : reasoning),
      toolCalls,
      reasoning,
      cacheStatus,
      raw,
    };
  }
  const message = extractChatMessage(raw);
  const toolCalls = normalizeToolCalls(message.tool_calls ?? result.tool_calls);
  const reasoning = extractReasoning(raw, message);
  const extracted = extractChatText(message, raw);
  return {
    text: extracted || (toolCalls.length ? '' : reasoning),
    toolCalls,
    reasoning,
    cacheStatus,
    raw,
  };
}

export function vercelGatewayConfigured(env: { AI_GATEWAY_API_KEY?: string }): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY?.trim());
}

export async function runGateway(env: { AI_GATEWAY_API_KEY?: string; AI_GATEWAY_URL?: string }, options: {
  model: string;
  messages: AgentChatMessage[];
  skipCache: boolean;
  cacheKey?: string;
  user?: string;
  toolChoice?: 'auto' | 'none';
}): Promise<GatewayResult> {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing AI_GATEWAY_API_KEY. Create one with `npx vercel ai-gateway api-keys create` and put it in .dev.vars (local) or `wrangler secret put AI_GATEWAY_API_KEY` (deploy).');
  }

  const cacheKey = options.cacheKey ?? (!options.skipCache && !options.messages.some((message) => message.images?.length) ? chipCacheKey(options.messages[0]?.content ?? '', options.model) : undefined);
  const fallbacks = GATEWAY_FALLBACK_MODELS.filter((model) => model !== options.model);
  const hasImages = options.messages.some((message) => !!message.images?.length);
  const endpoint = env.AI_GATEWAY_URL?.trim() || VERCEL_AI_GATEWAY_URL;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      messages: toGatewayMessages(options.messages),
      tools: gatewayToolDefinitions(),
      tool_choice: options.toolChoice ?? 'auto',
      max_tokens: 4096,
      reasoning: { effort: reasoningForModel(options.model) === 'xhigh' ? 'medium' : (reasoningForModel(options.model) as any) },
      models: fallbacks,
      providerOptions: {
        gateway: {
          cacheControl: options.skipCache || hasImages ? 'max-age=0' : 'max-age=86400',
          tags: ['feature:canvas-agent', options.skipCache ? 'step:continue' : 'step:chat'],
          ...(options.user ? { user: options.user } : {}),
          ...(cacheKey ? { cacheKey } : {}),
        },
      },
    }),
  });

  const raw: unknown = await response.json().catch(() => ({ error: `Vercel AI Gateway HTTP ${response.status}` }));
  const error = gatewayError(raw, response.status) ?? (!response.ok ? `Vercel AI Gateway HTTP ${response.status}` : undefined);
  if (error) throw new Error(error);
  const wrapped = asRecord(raw);
  const cacheStatus = typeof wrapped?.['cf-aig-cache-status'] === 'string'
    ? wrapped['cf-aig-cache-status']
    : typeof response.headers.get('x-vercel-cache') === 'string'
      ? response.headers.get('x-vercel-cache') ?? undefined
      : undefined;
  return parseGatewayOutput(raw, cacheStatus);
}
