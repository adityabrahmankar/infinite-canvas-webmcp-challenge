export type AgentLiveState = 'idle' | 'thinking' | 'working' | 'waiting';

export interface AgentLive {
  state: AgentLiveState;
  label: string;
  nodeIds: string[];
  startedAt: number;
}

const listeners = new Set<(next: AgentLive) => void>();

let live: AgentLive = { state: 'idle', label: '', nodeIds: [], startedAt: 0 };

export function getAgentLive(): AgentLive {
  return live;
}

export function setAgentLive(next: { state: AgentLiveState; label?: string; nodeIds?: string[] }): void {
  if (next.state === 'idle') {
    live = { state: 'idle', label: '', nodeIds: [], startedAt: 0 };
  } else {
    const keepClock = live.state !== 'idle' && live.startedAt > 0;
    live = {
      state: next.state,
      label: next.label ?? live.label,
      nodeIds: next.nodeIds ?? live.nodeIds,
      startedAt: keepClock ? live.startedAt : Date.now(),
    };
  }
  for (const listener of listeners) listener(live);
}

export function subscribeAgentLive(listener: (next: AgentLive) => void): () => void {
  listeners.add(listener);
  listener(live);
  return () => listeners.delete(listener);
}

export function nodeIdsFromToolArgs(args: Record<string, unknown>, fallback: string[] = []): string[] {
  const ids: string[] = [];
  if (typeof args.nodeId === 'string' && args.nodeId) ids.push(args.nodeId);
  if (typeof args.rootNodeId === 'string' && args.rootNodeId) ids.push(args.rootNodeId);
  if (typeof args.referenceId === 'string' && args.referenceId) ids.push(args.referenceId);
  if (Array.isArray(args.nodeIds)) {
    for (const value of args.nodeIds) {
      if (typeof value === 'string' && value) ids.push(value);
    }
  }
  return ids.length ? [...new Set(ids)] : fallback;
}

export function nodeIdsFromToolResult(result: unknown, fallback: string[] = []): string[] {
  const ids: string[] = [];
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 4 || value == null) return;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { visit(JSON.parse(trimmed), depth + 1); } catch { /* ignore */ }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 12)) visit(entry, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const key of ['id', 'nodeId', 'selectedId', 'rootNodeId', 'referenceId']) {
      if (typeof record[key] === 'string' && record[key]) ids.push(record[key]);
    }
    if (Array.isArray(record.selectedIds)) {
      for (const entry of record.selectedIds) {
        if (typeof entry === 'string' && entry) ids.push(entry);
      }
    }
    if (Array.isArray(record.artboards)) for (const entry of record.artboards.slice(0, 4)) visit(entry, depth + 1);
    if (Array.isArray(record.moved)) for (const entry of record.moved.slice(0, 8)) visit(entry, depth + 1);
    if (record.selected && typeof record.selected === 'object') visit(record.selected, depth + 1);
    if (record.root && typeof record.root === 'object') visit(record.root, depth + 1);
  };
  visit(result);
  return ids.length ? [...new Set(ids)] : fallback;
}
