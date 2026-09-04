export const AGENT_REQUEST_LIMIT = 5;

export function remainingRequests(usedCount: number, unlimited: boolean, limit = AGENT_REQUEST_LIMIT): number {
  if (unlimited) return 999;
  return Math.max(0, limit - Math.max(0, usedCount));
}

export function isLocalRequest(request: Request): boolean {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  return host.startsWith('localhost')
    || host.startsWith('127.0.0.1')
    || host.startsWith('[::1]');
}

export function shouldEnforceRateLimit(request: Request, env: { ENFORCE_RATE_LIMIT?: string }): boolean {
  const flag = env.ENFORCE_RATE_LIMIT?.trim().toLowerCase();
  if (flag === 'false' || flag === '0') return false;
  if (isLocalRequest(request)) return false;
  return true;
}

export function visitorKey(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'local';
  const local = ip === '127.0.0.1' || ip === '::1' || ip === 'local' || isLocalRequest(request);
  if (local) {
    const visitor = request.headers.get('x-agent-visitor')?.trim();
    return visitor ? `local:${visitor}` : 'local';
  }
  return `ip:${ip}`;
}
