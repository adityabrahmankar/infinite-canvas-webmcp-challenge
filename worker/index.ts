import { getAgentByName, routeAgentRequest } from 'agents';
import { AGENT_MODELS, chipCacheKey, compactToolResult, DEFAULT_AGENT_MODEL, formatCanvasContext, isAllowedModel, MAX_AGENT_MESSAGE, MAX_AGENT_STEPS, modelHasVision, sanitizeAgentImages, sanitizeCanvasContext, sanitizeUserMessage, type AgentChatMessage, type AgentTurnResponse } from '../src/agent-protocol';
import { isKnownTool } from '../src/tool-catalog';
import { CanvasAgent } from './canvas-agent';
import type { Env } from './env';
import { runGateway, vercelGatewayConfigured } from './gateway';
import { RATE_LIMIT_MESSAGE, shouldEnforceRateLimit, visitorKey } from './limits';

export { CanvasAgent };

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function turnPayload(input: {
  turnId: string;
  text: string;
  toolCalls: AgentTurnResponse['toolCalls'];
  remaining: number;
  unlimited: boolean;
  cacheStatus?: string;
  model: string;
  step: number;
  done?: boolean;
  error?: string;
  reasoning?: string;
}): AgentTurnResponse {
  return {
    turnId: input.turnId,
    text: input.text,
    toolCalls: input.toolCalls,
    done: input.done ?? input.toolCalls.length === 0,
    remaining: input.remaining,
    unlimited: input.unlimited,
    cacheStatus: input.cacheStatus,
    model: input.model,
    step: input.step,
    error: input.error,
    reasoning: input.reasoning,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/agent')) {
      try {
        return await handleAgent(request, env, url.pathname);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Agent failed.';
        return json({ error: message }, 500);
      }
    }
    const routed = await routeAgentRequest(request, env);
    if (routed) return routed;
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};

async function handleAgent(request: Request, env: Env, pathname: string): Promise<Response> {
  const unlimited = !shouldEnforceRateLimit(request, env);
  const agent = await getAgentByName(env.CanvasAgent, visitorKey(request));

  if (request.method === 'GET' && pathname === '/api/agent/status') {
    const status = await agent.status(unlimited);
    return json({
      remaining: status.remaining,
      used: status.used,
      unlimited: status.unlimited,
      maxMessage: MAX_AGENT_MESSAGE,
      maxSteps: MAX_AGENT_STEPS,
      models: AGENT_MODELS,
      defaultModel: DEFAULT_AGENT_MODEL,
      provider: 'vercel-ai-gateway',
      configured: vercelGatewayConfigured(env),
    });
  }

  if (request.method === 'GET' && pathname === '/api/agent/history') {
    const messages = await agent.history();
    return json({
      messages: messages.map((message) => ({
        ...message,
        images: (message.images ?? []).map((image) => ({
          name: image.name,
          dataUrl: '',
          width: image.width,
          height: image.height,
        })),
      })),
    });
  }

  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (pathname === '/api/agent/chat') {
    const body = await readJson(request);
    const message = sanitizeUserMessage(body.message);
    const model = typeof body.model === 'string' && isAllowedModel(body.model) ? body.model : DEFAULT_AGENT_MODEL;
    const images = sanitizeAgentImages(body.images);
    if (images.length && !modelHasVision(model)) return json({ error: 'This mode cannot see images. Switch to Fast or Best.' }, 400);
    if (!message && !images.length) return json({ error: 'Type a prompt or attach a reference image.' }, 400);

    const selection = sanitizeCanvasContext(body.selection);
    const canvasContext = selection ? formatCanvasContext(selection) : undefined;
    const selectionKey = selection?.selected.map((layer) => layer.id).join(',') ?? '';
    const userMessage: AgentChatMessage = {
      role: 'user',
      content: message || 'Use these reference images on the canvas.',
      images,
      canvasContext,
    };
    const replay = body.replay === true;
    if (!unlimited && env.CHAT_LIMIT) {
      const burst = await env.CHAT_LIMIT.limit({ key: visitorKey(request) });
      if (!burst.success) {
        const status = await agent.status(unlimited);
        return json({ error: RATE_LIMIT_MESSAGE, remaining: status.remaining, unlimited: false }, 429);
      }
    }
    const started = await agent.startTurn(model, [userMessage], unlimited, replay);
    if (!started.ok) return json({ error: started.error, remaining: started.remaining, unlimited: false }, 429);

    const remaining = (await agent.status(unlimited)).remaining;
    try {
      const conversationMessages = started.allMessages ?? [userMessage];
      const result = await runGateway(env, {
        model,
        messages: conversationMessages,
        skipCache: images.length > 0 || replay,
        cacheKey: images.length || replay ? undefined : chipCacheKey(message, model, selectionKey),
        user: visitorKey(request),
      });
      const messages: AgentChatMessage[] = [
        ...conversationMessages,
        { role: 'assistant', content: result.text, toolCalls: result.toolCalls, reasoning: result.reasoning },
      ];
      await agent.saveMessages(started.turnId, messages);
      return json(turnPayload({
        turnId: started.turnId,
        text: result.text,
        toolCalls: result.toolCalls,
        remaining,
        unlimited,
        cacheStatus: result.cacheStatus,
        model,
        step: started.step,
        reasoning: result.reasoning,
      }));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'AI Gateway request failed.';
      return json(turnPayload({
        turnId: started.turnId,
        text: '',
        toolCalls: [],
        remaining,
        unlimited,
        model,
        step: started.step,
        done: true,
        error: messageText,
      }), 502);
    }
  }

  if (pathname === '/api/agent/continue') {
    const body = await readJson(request);
    const turnId = typeof body.turnId === 'string' ? body.turnId : '';
    const results = Array.isArray(body.toolResults) ? body.toolResults : [];
    if (!turnId) return json({ error: 'Missing turn.' }, 400);

    const state = await agent.loadTurn(turnId);
    if (!state) return json({ error: 'This agent turn is closed.', remaining: unlimited ? 999 : 0, unlimited }, 409);
    if (state.step >= MAX_AGENT_STEPS) {
      return json(turnPayload({
        turnId, text: 'Stopped after the tool loop limit for this request.', toolCalls: [], remaining: unlimited ? 999 : 0, unlimited, model: state.model, step: state.step, done: true,
      }));
    }

    const toolMessages: AgentChatMessage[] = [];
    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name : '';
      if (!isKnownTool(name)) continue;
      const dataUrl = typeof record.dataUrl === 'string' && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(record.dataUrl) ? record.dataUrl : undefined;
      toolMessages.push({
        role: 'tool',
        toolCallId: typeof record.id === 'string' ? record.id : name,
        content: compactToolResult(record.result ?? record.error ?? ''),
        ...(dataUrl && modelHasVision(state.model) ? { images: [{ name, dataUrl }] } : {}),
      });
    }
    if (!toolMessages.length) return json({ error: 'No tool results.' }, 400);

    const messages = [...state.messages, ...toolMessages];
    const continued = await agent.continueTurn(turnId, messages);
    if (!continued.ok) return json({ error: continued.error, remaining: unlimited ? 999 : 0, unlimited }, 429);

    const remaining = (await agent.status(unlimited)).remaining;
    const lastRound = continued.step >= MAX_AGENT_STEPS;
    const result = await runGateway(env, {
      model: state.model,
      messages,
      skipCache: true,
      user: visitorKey(request),
      toolChoice: lastRound ? 'none' : 'auto',
    });
    const nextMessages: AgentChatMessage[] = [...messages, { role: 'assistant', content: result.text, toolCalls: result.toolCalls, reasoning: result.reasoning }];
    await agent.saveMessages(turnId, nextMessages);
    return json(turnPayload({
      turnId,
      text: result.text,
      toolCalls: result.toolCalls,
      remaining,
      unlimited,
      cacheStatus: result.cacheStatus,
      model: state.model,
      step: continued.step,
      done: lastRound || result.toolCalls.length === 0,
      reasoning: result.reasoning,
    }));
  }

  if (pathname === '/api/agent/reset') {
    await agent.resetChat();
    const status = await agent.status(unlimited);
    return json({ ok: true, remaining: status.remaining, used: status.used, unlimited: status.unlimited });
  }

  if (pathname === '/api/agent/rewind') {
    const body = await readJson(request);
    const userTurns = typeof body.userTurns === 'number' && Number.isFinite(body.userTurns) ? body.userTurns : 0;
    await agent.rewindToUserTurns(userTurns);
    return json({ ok: true, userTurns: Math.max(0, Math.floor(userTurns)) });
  }

  return json({ error: 'Not found' }, 404);
}
