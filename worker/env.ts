import type { CanvasAgent } from './canvas-agent';

export interface Env {
  ASSETS?: Fetcher;
  CanvasAgent: DurableObjectNamespace<CanvasAgent>;
  CHAT_LIMIT?: { limit: (options: { key: string }) => Promise<{ success: boolean }> };
  ENFORCE_RATE_LIMIT?: string;
  AI_GATEWAY_API_KEY?: string;
  AI_GATEWAY_URL?: string;
}
