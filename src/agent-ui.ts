import { renderMarkdown } from './markdown';
import { getAgentLive, subscribeAgentLive, type AgentLive } from './agent-activity';
import { createOrbCanvas, orbStateForAgent, type CanvasOrbState } from './thinking-orb';

function svg(path: string): string {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

const ICONS = {
  copy: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 3v6h-6"/>'),
  pencil: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  undo: svg('<path d="M3 7v6h6"/><path d="M3 13a9 9 0 1 0 3-7.2L3 9"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  brain: svg('<path d="M12 5a3 3 0 1 0-5.8 1.1A3.5 3.5 0 0 0 6 18h12a3.5 3.5 0 0 0-.2-7A3 3 0 0 0 12 5Z"/><path d="M12 5v13"/><path d="M9 9h.01"/><path d="M15 9h.01"/>'),
};

export function ghostAction(action: string, label: string, icon: keyof typeof ICONS): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'aui-ghost-btn';
  button.dataset.turnAction = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = ICONS[icon];
  return button;
}

export function createMessageActions(kind: 'user' | 'assistant'): HTMLElement {
  const row = document.createElement('div');
  row.className = 'aui-message-actions';
  row.dataset.slot = 'message-actions';
  if (kind === 'user') {
    row.append(
      ghostAction('edit', 'Edit message', 'pencil'),
      ghostAction('undo', 'Undo message', 'undo'),
      ghostAction('retry', 'Regenerate response', 'refresh'),
    );
  } else {
    row.append(
      ghostAction('copy', 'Copy response', 'copy'),
      ghostAction('retry', 'Regenerate response', 'refresh'),
    );
  }
  return row;
}

export function markCopied(button: HTMLButtonElement): void {
  button.dataset.copied = 'true';
  button.innerHTML = ICONS.check;
  window.setTimeout(() => {
    if (!button.isConnected) return;
    button.dataset.copied = 'false';
    button.innerHTML = ICONS.copy;
  }, 3000);
}

function elapsedLabel(startedAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return `${seconds}s`;
}

export function createThinkingIndicator(host: HTMLElement): { root: HTMLElement; destroy: () => void } {
  const root = document.createElement('div');
  root.className = 'aui-thinking';
  root.dataset.slot = 'thinking-indicator';
  let label = document.createElement('span');
  label.className = 'aui-thinking-label';
  const elapsed = document.createElement('span');
  elapsed.className = 'aui-thinking-elapsed';
  elapsed.dataset.slot = 'thinking-elapsed';
  root.append(label, elapsed);
  host.append(root);

  let orb: ReturnType<typeof createOrbCanvas> | undefined;
  const placeOrb = (state: CanvasOrbState, text: string) => {
    if (!orb) {
      orb = createOrbCanvas(state, 20, text);
      root.prepend(orb.canvas);
    } else {
      orb.setState(state);
      orb.canvas.setAttribute('aria-label', text);
    }
  };

  const setLabel = (text: string) => {
    if (label.dataset.key === text) return;
    const next = document.createElement('span');
    next.className = 'aui-thinking-label';
    next.dataset.key = text;
    next.textContent = text;
    label.replaceWith(next);
    label = next;
  };

  const paint = (live: AgentLive) => {
    if (live.state === 'idle') return;
    const text = live.label || 'Thinking';
    const state = orbStateForAgent(live) ?? 'composing';
    placeOrb(state, text);
    setLabel(text);
    elapsed.textContent = elapsedLabel(live.startedAt);
  };

  paint(getAgentLive());
  const unsub = subscribeAgentLive(paint);
  const timer = window.setInterval(() => {
    const live = getAgentLive();
    if (live.state !== 'idle') elapsed.textContent = elapsedLabel(live.startedAt);
  }, 1000);

  const scroller = host.closest('.agent-thread') ?? host;
  scroller.scrollTop = scroller.scrollHeight;

  let destroyed = false;
  return {
    root,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsub();
      window.clearInterval(timer);
      orb?.destroy();
      root.remove();
    },
  };
}

export function paintAgentStatus(el: HTMLElement, live: AgentLive): void {
  if (live.state === 'idle') {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  el.hidden = false;
  el.dataset.slot = 'agent-status';
  el.dataset.state = live.state === 'waiting' ? 'waiting' : 'working';
  const state = live.state === 'waiting' ? 'waiting' : 'working';
  el.innerHTML = `<span class="aui-status-dot" data-state="${state}" aria-hidden="true"></span><span class="aui-sr">${state}</span><span class="aui-status-label">${live.label || 'Thinking'}</span><span class="aui-status-elapsed">${elapsedLabel(live.startedAt)}</span>`;
}

export function createReasoning(text: string, durationSec?: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'aui-reasoning';
  root.dataset.slot = 'reasoning-root';
  root.dataset.variant = 'muted';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.dataset.slot = 'reasoning-trigger';
  trigger.setAttribute('aria-expanded', 'false');
  const suffix = durationSec ? ` (${durationSec}s)` : '';
  trigger.innerHTML = `<span class="aui-reasoning-title">${ICONS.brain}<span data-reasoning-label>Reasoning${suffix}</span></span>${ICONS.chevron}`;
  const content = document.createElement('div');
  content.dataset.slot = 'reasoning-content';
  content.hidden = true;
  const body = document.createElement('div');
  body.dataset.slot = 'reasoning-text';
  body.className = 'aui-md';
  body.innerHTML = renderMarkdown(text);
  content.append(body);
  trigger.addEventListener('click', () => {
    const open = content.hidden;
    content.hidden = !open;
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  root.append(trigger, content);
  return root;
}

export function createMarkdown(text: string): HTMLElement {
  const body = document.createElement('div');
  body.className = 'aui-md agent-bubble-body';
  body.dataset.status = 'complete';
  body.innerHTML = renderMarkdown(text);
  return body;
}

export function toolDisplayName(name: string): string {
  return name.replaceAll('_', ' ');
}

function toolQuery(args: Record<string, unknown>): string {
  const keys = ['name', 'nodeId', 'referenceId', 'rootNodeId', 'format', 'text'];
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 42);
  }
  const first = Object.values(args).find((value) => typeof value === 'string' && value.trim());
  return typeof first === 'string' ? first.slice(0, 42) : '';
}

export function createToolCall(name: string, args: Record<string, unknown>): {
  root: HTMLElement;
  settle: (result: string, ok: boolean) => void;
} {
  const root = document.createElement('div');
  root.className = 'aui-tool-call';
  root.dataset.slot = 'tool-call';
  root.dataset.open = 'false';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'aui-tool-call-trigger';
  trigger.setAttribute('aria-expanded', 'false');
  const query = toolQuery(args);
  const label = document.createElement('span');
  label.className = 'aui-tool-call-label is-shimmer';
  label.textContent = toolDisplayName(name);
  const chip = document.createElement('span');
  chip.className = 'aui-tool-chip';
  chip.hidden = !query;
  chip.textContent = query;
  const mark = document.createElement('span');
  mark.className = 'aui-tool-check';
  mark.hidden = true;
  mark.innerHTML = ICONS.check;
  trigger.innerHTML = ICONS.chevron;
  trigger.append(label, chip, mark);
  const panel = document.createElement('div');
  panel.className = 'aui-tool-call-panel';
  panel.hidden = true;
  panel.innerHTML = `<div class="aui-tool-block"><pre>${escapeText(JSON.stringify(args, null, 2))}</pre></div><div class="aui-tool-block"><pre data-tool-result></pre></div>`;
  trigger.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    root.dataset.open = panel.hidden ? 'false' : 'true';
    trigger.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
  });
  root.append(trigger, panel);
  return {
    root,
    settle(result: string, ok: boolean) {
      label.classList.remove('is-shimmer');
      label.textContent = toolDisplayName(name);
      mark.hidden = false;
      root.classList.toggle('is-error', !ok);
      const pre = panel.querySelector('[data-tool-result]');
      if (pre) pre.textContent = result;
    },
  };
}

export function createToolGroup(): {
  root: HTMLElement;
  body: HTMLElement;
  setActive: (active: boolean) => void;
} {
  const root = document.createElement('div');
  root.className = 'aui-tool-group';
  root.dataset.slot = 'tool-group-root';
  root.dataset.variant = 'ghost';
  const body = document.createElement('div');
  body.dataset.slot = 'tool-group-content';
  root.append(body);
  return {
    root,
    body,
    setActive(active: boolean) {
      root.classList.toggle('is-active', active);
    },
  };
}

export function createApprovalCard(name: string, args: Record<string, unknown>): HTMLElement {
  const root = document.createElement('div');
  root.className = 'aui-approval';
  root.dataset.slot = 'approval-card';
  root.dataset.state = 'request';
  root.innerHTML = `
    <div class="aui-approval-head">
      <p class="aui-approval-title">${escapeText(toolDisplayName(name))}</p>
    </div>
    <pre class="aui-approval-command">${escapeText(JSON.stringify(args, null, 2))}</pre>
    <div class="aui-approval-footer">
      <button type="button" data-approve="no">Deny</button>
      <button type="button" data-approve="yes" class="is-primary">Allow</button>
    </div>`;
  return root;
}

export function createAssistantMessage(text: string, reasoning?: string, durationSec?: number): HTMLElement {
  const node = document.createElement('div');
  node.className = 'agent-bubble is-assistant';
  node.dataset.slot = 'message-pair';
  node.dataset.replyText = text || reasoning || '';
  if (reasoning) node.append(createReasoning(reasoning, durationSec));
  if (text.trim()) node.append(createMarkdown(text));
  node.append(createMessageActions('assistant'));
  return node;
}

export function createErrorMessage(text: string): HTMLElement {
  const node = createAssistantMessage(text);
  node.classList.add('is-error');
  return node;
}

function escapeText(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export { ICONS };
