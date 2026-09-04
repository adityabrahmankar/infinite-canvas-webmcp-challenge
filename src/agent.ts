import { runCanvasTool } from './agent-bridge';
import {
  AGENT_MODELS,
  compactToolResult,
  DEFAULT_AGENT_MODEL,
  MAX_AGENT_IMAGE_CHARS,
  MAX_AGENT_IMAGES,
  MAX_CANVAS_SELECTION,
  MAX_LAYER_TEXT,
  modelHasVision,
  PROMPT_CHIPS,
  type AgentCanvasContext,
  type AgentImage,
  type AgentToolCall,
  type AgentTurnResponse,
} from './agent-protocol';
import { getAgentLive, nodeIdsFromToolArgs, nodeIdsFromToolResult, setAgentLive, subscribeAgentLive } from './agent-activity';
import {
  createApprovalCard,
  createAssistantMessage,
  createErrorMessage,
  createMessageActions,
  createThinkingIndicator,
  createToolCall,
  createToolGroup,
  markCopied,
  paintAgentStatus,
  toolDisplayName,
} from './agent-ui';
import { store } from './store';
import { DESTRUCTIVE_TOOLS } from './tool-catalog';
import type { DocumentSnapshot } from './types';

const VISITOR_KEY = 'infinite-canvas-agent-visitor';
const AUTO_KEY = 'infinite-canvas-agent-auto-approve';
const MODEL_KEY = 'infinite-canvas-agent-model';
const TAB_KEY = 'infinite-canvas-sidebar-tab';
const MAX_IMAGE_EDGE = 1280;

type SidebarTab = 'layers' | 'agents';
type StagedImage = AgentImage & { id: string };

interface ChatTurn {
  id: string;
  message: string;
  images: AgentImage[];
  contextLabel: string;
  snapshot: DocumentSnapshot;
  root: HTMLElement;
  userNode: HTMLElement;
}

const chatTurns: ChatTurn[] = [];
let editingTurnId: string | null = null;
let lastUnlimited = false;
let quotaLocked = false;
let sending = false;
let staged: StagedImage[] = [];

function visitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return 'anonymous';
  }
}

function storedModel(): string {
  try {
    const value = window.localStorage.getItem(MODEL_KEY);
    return AGENT_MODELS.some((model) => model.id === value) ? value as string : DEFAULT_AGENT_MODEL;
  } catch {
    return DEFAULT_AGENT_MODEL;
  }
}

function storedAutoApprove(): boolean {
  try { return window.localStorage.getItem(AUTO_KEY) !== '0'; }
  catch { return true; }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function modelMeta(id: string) {
  return AGENT_MODELS.find((model) => model.id === id) ?? AGENT_MODELS[0];
}

function userFacingAgentError(message: string | undefined, fallback: string): string {
  const text = (message || '').trim();
  if (!text) return fallback;
  if (/wrangler|pnpm|ai_gateway|worker|dev:worker|npx vercel|api key|http \d+/i.test(text)) return fallback;
  return text.length > 120 ? fallback : text;
}

function agentFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-agent-visitor': visitorId(),
      ...(init?.headers ?? {}),
    },
  });
}

function paintUserBubble(turn: ChatTurn): void {
  turn.userNode.className = 'agent-bubble is-user';
  const thumbs = turn.images.length
    ? `<div class="agent-thumbs">${turn.images.map((image) => `<img src="${escapeHtml(image.dataUrl)}" alt="${escapeHtml(image.name)}">`).join('')}</div>`
    : '';
  const context = turn.contextLabel ? `<div class="agent-bubble-context">${escapeHtml(turn.contextLabel)}</div>` : '';
  const caption = turn.message ? escapeHtml(turn.message) : '';
  const body = document.createElement('div');
  body.className = 'agent-bubble-body';
  body.innerHTML = `${thumbs}${context}${caption}`;
  turn.userNode.replaceChildren(body, createMessageActions('user'));
  applyComposerLock();
}

function discardedReplies(turn: ChatTurn): number {
  const start = chatTurns.indexOf(turn);
  if (start < 0) return 0;
  let count = 0;
  for (const entry of chatTurns.slice(start)) {
    count += entry.root.querySelectorAll('.agent-bubble.is-assistant').length;
  }
  return count;
}

function dropLaterTurns(turn: ChatTurn): void {
  const index = chatTurns.indexOf(turn);
  if (index < 0) return;
  for (const entry of chatTurns.splice(index + 1)) entry.root.remove();
}

function clearTurnFollowup(turn: ChatTurn): void {
  let node = turn.userNode.nextSibling;
  while (node) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }
}

function findTurn(target: HTMLElement): ChatTurn | undefined {
  const root = target.closest<HTMLElement>('.agent-turn');
  return chatTurns.find((turn) => turn.root === root);
}

function cancelEdit(turn?: ChatTurn): void {
  const target = turn ?? chatTurns.find((entry) => entry.id === editingTurnId);
  editingTurnId = null;
  if (target) paintUserBubble(target);
}

function startEdit(turn: ChatTurn): void {
  if (sending) return;
  if (editingTurnId && editingTurnId !== turn.id) cancelEdit();
  editingTurnId = turn.id;
  const discarded = discardedReplies(turn);
  const textarea = document.createElement('textarea');
  textarea.className = 'agent-edit-input';
  textarea.maxLength = 800;
  textarea.setAttribute('aria-label', 'Edit message');
  textarea.value = turn.message;
  const warning = document.createElement('div');
  warning.className = 'agent-edit-warning';
  warning.textContent = discarded ? 'This replaces later replies.' : '';
  warning.hidden = !discarded;
  const actions = document.createElement('div');
  actions.className = 'agent-edit-actions';
  actions.innerHTML = '<button type="button" data-turn-action="cancel-edit">Cancel</button><button type="button" data-turn-action="send-edit">Send</button>';
  turn.userNode.className = 'agent-bubble is-user is-editing';
  turn.userNode.replaceChildren(textarea, warning, actions);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function undoTurn(turn: ChatTurn): void {
  if (sending) return;
  cancelEdit();
  const index = chatTurns.indexOf(turn);
  if (index < 0) return;
  store.restoreSnapshot(turn.snapshot);
  for (const entry of chatTurns.splice(index)) entry.root.remove();
}

function resetLocalChat(): void {
  cancelEdit();
  for (const entry of chatTurns.splice(0)) entry.root.remove();
  staged = [];
  renderAttachments();
  const input = document.getElementById('agent-input') as HTMLTextAreaElement | null;
  if (input) {
    input.value = '';
    resizeComposerInput(input);
  }
  setAgentLive({ state: 'idle' });
  applyComposerLock();
}

async function startNewChat(): Promise<void> {
  if (sending) return;
  resetLocalChat();
  const quota = document.getElementById('agent-quota');
  try {
    await agentFetch('/api/agent/reset', { method: 'POST' });
  } catch {
    // Local thread is already empty; status refresh still runs below.
  }
  if (quota) await refreshStatus(quota);
}

function retryTurn(turn: ChatTurn): void {
  if (sending || quotaLocked) return;
  editingTurnId = null;
  void runTurn(turn.message, { images: turn.images, existing: turn, replay: true });
}

function sendEdit(turn: ChatTurn): void {
  if (sending || quotaLocked) return;
  const textarea = turn.userNode.querySelector('textarea');
  const next = textarea?.value.replace(/\s+/g, ' ').trim() ?? '';
  if (!next && !turn.images.length) return;
  editingTurnId = null;
  void runTurn(next, { images: turn.images, existing: turn, replay: true });
}

function decorateAssistant(host: HTMLElement, text: string, reasoning?: string, durationSec?: number): HTMLElement {
  const node = createAssistantMessage(text, reasoning, durationSec);
  host.append(node);
  const thread = host.closest('.agent-thread') ?? host;
  thread.scrollTop = thread.scrollHeight;
  applyComposerLock();
  return node;
}

async function copyReply(button: HTMLButtonElement): Promise<void> {
  const bubble = button.closest('.agent-bubble');
  const text = bubble instanceof HTMLElement ? (bubble.dataset.replyText ?? '') : '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    markCopied(button);
  } catch {
    button.title = 'Copy failed';
  }
}

function handleTurnAction(button: HTMLButtonElement): void {
  const action = button.dataset.turnAction;
  if (action === 'copy') {
    void copyReply(button);
    return;
  }
  const turn = findTurn(button);
  if (!turn) return;
  if (action === 'edit') startEdit(turn);
  else if (action === 'cancel-edit') cancelEdit(turn);
  else if (action === 'send-edit') sendEdit(turn);
  else if (action === 'undo') undoTurn(turn);
  else if (action === 'retry') retryTurn(turn);
}

function rootOf(id: string) {
  let current = store.getNode(id);
  while (current?.parentId) {
    const parent = store.getNode(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

function captureCanvasContext(): AgentCanvasContext | undefined {
  const ids = store.selectedIds.filter((id) => store.getNode(id)).slice(0, MAX_CANVAS_SELECTION);
  if (!ids.length) return undefined;
  const selected = ids.flatMap((id) => {
    const node = store.getNode(id);
    if (!node) return [];
    const bounds = store.resolvedBounds(node);
    const parent = node.parentId ? store.getNode(node.parentId) : null;
    const text = node.text?.replace(/\s+/g, ' ').trim().slice(0, MAX_LAYER_TEXT);
    return [{
      id: node.id,
      name: node.name,
      kind: node.kind,
      text: text || undefined,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      parentId: node.parentId,
      parentName: parent?.name,
      childCount: node.children.length || undefined,
      background: node.style.background,
      color: node.style.color,
      fontSize: node.style.fontSize,
      fontFamily: node.style.fontFamily,
    }];
  });
  if (!selected.length) return undefined;
  const artboard = rootOf(ids[ids.length - 1]!);
  return {
    revision: store.revision,
    artboard: artboard ? { id: artboard.id, name: artboard.name } : undefined,
    selected,
  };
}

function selectionLabel(context: AgentCanvasContext | undefined): string {
  if (!context?.selected.length) return '';
  return context.selected[0]!.name;
}

function renderSelectionChip(): void {
  const el = document.getElementById('agent-selection');
  if (!el) return;
  const context = captureCanvasContext();
  const label = selectionLabel(context);
  el.hidden = !label;
  el.textContent = label;
  el.title = context?.selected.map((layer) => layer.name).join(', ') ?? '';
}

function setQuota(el: HTMLElement, remaining: number, used: boolean, unlimited = false): void {
  lastUnlimited = unlimited;
  el.hidden = true;
  el.textContent = '';
  el.classList.toggle('is-empty', !unlimited && (remaining < 1 || used));
}

function lockComposer(locked: boolean): void {
  quotaLocked = locked;
  applyComposerLock();
}

function applyComposerLock(): void {
  const locked = quotaLocked || sending;
  const input = document.getElementById('agent-input') as HTMLTextAreaElement | null;
  const send = document.getElementById('agent-send') as HTMLButtonElement | null;
  const attach = document.getElementById('agent-attach') as HTMLButtonElement | null;
  const attachInput = document.getElementById('agent-attach-input') as HTMLInputElement | null;
  const modelButton = document.getElementById('agent-model-button') as HTMLButtonElement | null;
  const newChat = document.getElementById('agent-new-chat') as HTMLButtonElement | null;
  const chips = document.getElementById('agent-chips');
  const attachFull = staged.length >= MAX_AGENT_IMAGES;
  if (input) {
    input.disabled = locked;
    input.placeholder = quotaLocked && !lastUnlimited ? '' : 'Ask to inspect, restyle, or export…';
  }
  if (send) send.disabled = locked;
  if (attach) attach.disabled = locked || attachFull;
  if (newChat) newChat.disabled = sending;
  if (attachInput) attachInput.disabled = locked || attachFull;
  if (modelButton) modelButton.disabled = locked;
  chips?.classList.toggle('is-locked', locked);
  chips?.querySelectorAll('button').forEach((button) => { button.disabled = locked; });
  document.querySelectorAll<HTMLButtonElement>('[data-turn-action]').forEach((button) => {
    const action = button.dataset.turnAction;
    if (action === 'copy') {
      button.disabled = false;
      return;
    }
    if (action === 'undo' || action === 'cancel-edit') {
      button.disabled = sending;
      return;
    }
    button.disabled = locked;
  });
}

function setSidebarTab(tab: SidebarTab): void {
  document.querySelectorAll<HTMLButtonElement>('[data-sidebar-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.sidebarTab === tab);
  });
  const layers = document.getElementById('layers-panel');
  const agents = document.getElementById('agents-panel');
  if (layers) layers.hidden = tab !== 'layers';
  if (agents) agents.hidden = tab !== 'agents';
  try { window.sessionStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
}

async function refreshStatus(quota: HTMLElement): Promise<void> {
  try {
    const response = await agentFetch('/api/agent/status');
    if (!response.ok) throw new Error('offline');
    const body = await response.json() as { remaining?: number; used?: boolean; unlimited?: boolean };
    if (body.unlimited) {
      setQuota(quota, 999, false, true);
      lockComposer(false);
      return;
    }
    const remaining = Number(body.remaining);
    const used = body.unlimited ? false : body.used === true || !(remaining > 0);
    setQuota(quota, Number.isFinite(remaining) ? remaining : 0, used, false);
    lockComposer(used);
  } catch {
    setQuota(quota, 5, false, lastUnlimited);
    lockComposer(false);
  }
}

function waitForApproval(name: string, args: Record<string, unknown>, thread: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    setAgentLive({ state: 'waiting', label: toolDisplayName(name) });
    const card = createApprovalCard(name, args);
    thread.append(card);
    const scroller = thread.closest('.agent-thread') ?? thread;
    scroller.scrollTop = scroller.scrollHeight;
    card.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-approve]');
      if (!button) return;
      const approved = button.dataset.approve === 'yes';
      card.dataset.state = approved ? 'running' : 'denied';
      card.querySelectorAll<HTMLButtonElement>('[data-approve]').forEach((entry) => { entry.disabled = true; });
      resolve(approved);
    });
  });
}

async function executeCalls(
  calls: AgentToolCall[],
  autoApprove: boolean,
  thread: HTMLElement,
  bumpThinking: () => void,
): Promise<Array<{ id: string; name: string; result: unknown }>> {
  const results: Array<{ id: string; name: string; result: unknown }> = [];
  const group = createToolGroup();
  thread.append(group.root);
  group.setActive(true);
  bumpThinking();
  for (const call of calls) {
    if (DESTRUCTIVE_TOOLS.has(call.name) && !autoApprove) {
      const approved = await waitForApproval(call.name, call.arguments, thread);
      bumpThinking();
      if (!approved) {
        results.push({ id: call.id, name: call.name, result: { skipped: true } });
        continue;
      }
    }
    setAgentLive({
      state: 'working',
      label: toolDisplayName(call.name),
      nodeIds: nodeIdsFromToolArgs(call.arguments, [...store.selectedIds]),
    });
    const row = createToolCall(call.name, call.arguments);
    group.body.append(row.root);
    bumpThinking();
    try {
      const ran = await runCanvasTool(call.name, call.arguments);
      row.settle(compactToolResult(ran.result), ran.ok);
      setAgentLive({
        state: 'working',
        label: toolDisplayName(call.name),
        nodeIds: nodeIdsFromToolResult(ran.result, nodeIdsFromToolArgs(call.arguments, [...store.selectedIds])),
      });
      const dataUrl = (call.name === 'capture_preview' && ran.result && typeof ran.result === 'object' && typeof (ran.result as Record<string, unknown>).dataUrl === 'string')
        ? (ran.result as Record<string, unknown>).dataUrl as string
        : undefined;
      results.push({ id: call.id, name: call.name, result: compactToolResult(ran.result), ...(dataUrl ? { dataUrl } : {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      row.settle(message, false);
      results.push({ id: call.id, name: call.name, result: { error: message } });
    }
  }
  group.setActive(false);
  bumpThinking();
  return results;
}

function currentModelId(): string {
  const field = document.getElementById('agent-model') as HTMLInputElement | null;
  const value = field?.value || DEFAULT_AGENT_MODEL;
  return AGENT_MODELS.some((model) => model.id === value) ? value : DEFAULT_AGENT_MODEL;
}

function persistModel(id: string): void {
  const field = document.getElementById('agent-model') as HTMLInputElement | null;
  const label = document.getElementById('agent-model-label');
  if (field) field.value = id;
  if (label) label.textContent = modelMeta(id).label;
  try { window.localStorage.setItem(MODEL_KEY, id); } catch { /* ignore */ }
}

function closeModelMenu(): void {
  const button = document.getElementById('agent-model-button');
  const menu = document.getElementById('agent-model-menu');
  if (button) button.setAttribute('aria-expanded', 'false');
  if (menu) menu.hidden = true;
}

function renderModelMenu(): void {
  const menu = document.getElementById('agent-model-menu');
  if (!menu) return;
  const selected = currentModelId();
  menu.replaceChildren(...AGENT_MODELS.map((model) => {
    const item = document.createElement('li');
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `agent-model-option${model.id === selected ? ' is-active' : ''}`;
    option.role = 'option';
    option.setAttribute('aria-selected', model.id === selected ? 'true' : 'false');
    option.dataset.model = model.id;
    option.innerHTML = `<span class="agent-model-option-label">${escapeHtml(model.label)}</span>${model.id === selected ? '<span class="agent-model-check" aria-hidden="true">\u2713</span>' : ''}`;
    option.addEventListener('click', () => {
      persistModel(model.id);
      renderModelMenu();
      closeModelMenu();
    });
    item.append(option);
    return item;
  }));
}

function renderAttachments(): void {
  const row = document.getElementById('agent-attachments');
  if (!row) return;
  row.hidden = staged.length === 0;
  row.replaceChildren(...staged.map((image) => {
    const chip = document.createElement('div');
    chip.className = 'agent-attach-chip';
    chip.dataset.slot = 'composer-attachment';
    const thumb = document.createElement('img');
    thumb.src = image.dataUrl;
    thumb.alt = image.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${image.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      staged = staged.filter((entry) => entry.id !== image.id);
      renderAttachments();
    });
    chip.append(thumb, remove);
    return chip;
  }));
  applyComposerLock();
}

function resizeComposerInput(input: HTMLTextAreaElement): void {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file is not a readable image.'));
    image.src = src;
  });
}

function compressImage(image: HTMLImageElement, maxEdge: number, quality: number): { dataUrl: string; width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight, 1));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not compress that image.');
  ctx.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width, height };
}

async function fileToAgentImage(file: File): Promise<AgentImage> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be attached.');
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const width = image.naturalWidth || 420;
  const height = image.naturalHeight || 280;
  if (original.length <= MAX_AGENT_IMAGE_CHARS && Math.max(width, height) <= MAX_IMAGE_EDGE) {
    return { name: (file.name || 'Reference image').slice(0, 80), dataUrl: original, width, height };
  }
  let edge = MAX_IMAGE_EDGE;
  let quality = 0.82;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const next = compressImage(image, edge, quality);
    if (next.dataUrl.length <= MAX_AGENT_IMAGE_CHARS) {
      return { name: (file.name || 'Reference image').slice(0, 80), ...next };
    }
    quality = Math.max(0.4, quality - 0.14);
    if (quality <= 0.4) edge = Math.round(edge * 0.75);
  }
  throw new Error('That image is still too large after compressing. Try a smaller file.');
}

function ensureVisionModel(): string {
  const selected = currentModelId();
  if (modelHasVision(selected)) return selected;
  persistModel(DEFAULT_AGENT_MODEL);
  renderModelMenu();
  return DEFAULT_AGENT_MODEL;
}

async function stageFiles(files: Iterable<File>): Promise<void> {
  if (quotaLocked || sending) return;
  const incoming = [...files].filter((file) => file.type.startsWith('image/'));
  if (!incoming.length) return;
  const room = MAX_AGENT_IMAGES - staged.length;
  if (room < 1) return;
  for (const file of incoming.slice(0, room)) {
    try {
      const image = await fileToAgentImage(file);
      staged = [...staged, { ...image, id: crypto.randomUUID() }];
    } catch {
      // Skip files that cannot be attached.
    }
  }
  renderAttachments();
  if (staged.length) ensureVisionModel();
}

async function placeOnCanvas(images: AgentImage[]): Promise<void> {
  for (const image of images) {
    try {
      await runCanvasTool('add_reference_image', {
        name: image.name,
        dataUrl: image.dataUrl,
        width: image.width,
        height: image.height,
      });
    } catch {
      // Chat can still send the image even if the canvas copy is rejected.
    }
  }
}

async function runTurn(message: string, options: { images?: AgentImage[]; existing?: ChatTurn; replay?: boolean } = {}): Promise<void> {
  const thread = document.getElementById('agent-thread');
  const quota = document.getElementById('agent-quota');
  const input = document.getElementById('agent-input') as HTMLTextAreaElement | null;
  const autoApprove = (document.getElementById('agent-auto-approve') as HTMLInputElement | null)?.checked !== false;
  if (!thread || !quota || !input) return;

  const images = options.images ?? staged.map((image) => ({
    name: image.name,
    dataUrl: image.dataUrl,
    width: image.width,
    height: image.height,
  }));
  if (!message && !images.length) return;
  if (sending) return;

  cancelEdit();
  const model = images.length ? ensureVisionModel() : currentModelId();
  let turn = options.existing;
  let selection = captureCanvasContext();
  if (turn) {
    store.restoreSnapshot(turn.snapshot);
    dropLaterTurns(turn);
    clearTurnFollowup(turn);
    turn.message = message;
    turn.images = images;
    selection = captureCanvasContext();
    turn.contextLabel = selectionLabel(selection);
    paintUserBubble(turn);
  } else {
    const snapshot = store.captureSnapshot();
    selection = captureCanvasContext();
    turn = {
      id: crypto.randomUUID(),
      message,
      images,
      contextLabel: selectionLabel(selection),
      snapshot,
      root: document.createElement('div'),
      userNode: document.createElement('div'),
    };
    turn.root.className = 'agent-turn';
    turn.root.dataset.turnId = turn.id;
    turn.userNode.className = 'agent-bubble is-user';
    paintUserBubble(turn);
    turn.root.append(turn.userNode);
    thread.append(turn.root);
    chatTurns.push(turn);
    staged = [];
    renderAttachments();
    input.value = '';
    resizeComposerInput(input);
  }

  sending = true;
  applyComposerLock();
  if (!lastUnlimited) setQuota(quota, 0, true, false);
  setAgentLive({ state: 'thinking', label: 'Thinking' });
  const thinking = createThinkingIndicator(turn.root);
  const bumpThinking = () => {
    if (thinking.root.isConnected) turn.root.append(thinking.root);
  };
  const startedAt = Date.now();
  const hasAssistantReply = () => Boolean(turn.root.querySelector('.agent-bubble.is-assistant:not(.is-error)'));
  const appendReply = (text: string, reasoning?: string) => {
    if (!text.trim() && !reasoning?.trim()) return;
    const duration = Math.round((Date.now() - startedAt) / 1000);
    decorateAssistant(turn.root, text, reasoning, duration);
    bumpThinking();
  };

  try {
    if (images.length) await placeOnCanvas(images);

    let response: Response;
    try {
      response = await agentFetch('/api/agent/chat', {
        method: 'POST',
        body: JSON.stringify({ message, model, images, selection, replay: options.replay === true }),
      });
    } catch {
      thinking.destroy();
      turn.root.append(createErrorMessage("Couldn't reach the agent."));
      return;
    }

    const body = await response.json() as AgentTurnResponse & { error?: string };
    if (!response.ok && !body.turnId) {
      thinking.destroy();
      turn.root.append(createErrorMessage(userFacingAgentError(body.error, "Couldn't reach the agent.")));
      if (response.status !== 429) lockComposer(false);
      return;
    }
    if (body.error && !body.toolCalls?.length && !body.text) {
      thinking.destroy();
      turn.root.append(createErrorMessage(userFacingAgentError(body.error, "Couldn't reach the agent.")));
      return;
    }
    if (body.text) appendReply(body.text, body.reasoning);

    let gatewayTurn = body;
    let lastReasoning = body.reasoning ?? '';
    while (gatewayTurn.toolCalls?.length && gatewayTurn.turnId) {
      const results = await executeCalls(gatewayTurn.toolCalls, autoApprove, turn.root, bumpThinking);
      if (gatewayTurn.done) break;
      setAgentLive({ state: 'thinking', label: 'Thinking' });
      bumpThinking();
      let continued: Response;
      try {
        continued = await agentFetch('/api/agent/continue', {
          method: 'POST',
          body: JSON.stringify({ turnId: gatewayTurn.turnId, toolResults: results }),
        });
        gatewayTurn = await continued.json() as AgentTurnResponse & { error?: string };
      } catch {
        thinking.destroy();
        turn.root.append(createErrorMessage('The run stopped. Try again.'));
        return;
      }
      lastReasoning = gatewayTurn.reasoning || lastReasoning;
      if (gatewayTurn.error && !gatewayTurn.text && !gatewayTurn.toolCalls?.length) {
        thinking.destroy();
        turn.root.append(createErrorMessage(userFacingAgentError(gatewayTurn.error, 'The run stopped. Try again.')));
        return;
      }
      if (gatewayTurn.text) appendReply(gatewayTurn.text, gatewayTurn.reasoning || lastReasoning);
      if (gatewayTurn.done || !gatewayTurn.toolCalls?.length) break;
    }
    thinking.destroy();
    if (!hasAssistantReply()) {
      const reasoning = gatewayTurn.reasoning || lastReasoning || body.reasoning || '';
      if (reasoning.trim()) appendReply('', reasoning);
    }
  } finally {
    thinking.destroy();
    setAgentLive({ state: 'idle' });
    sending = false;
    await refreshStatus(quota);
  }
}

export function initAgentPanel(): void {
  const chips = document.getElementById('agent-chips');
  const modelField = document.getElementById('agent-model') as HTMLInputElement | null;
  const modelButton = document.getElementById('agent-model-button') as HTMLButtonElement | null;
  const modelMenu = document.getElementById('agent-model-menu');
  const picker = document.getElementById('agent-model-picker');
  const auto = document.getElementById('agent-auto-approve') as HTMLInputElement | null;
  const form = document.getElementById('agent-composer') as HTMLFormElement | null;
  const input = document.getElementById('agent-input') as HTMLTextAreaElement | null;
  const quota = document.getElementById('agent-quota');
  const thread = document.getElementById('agent-thread');
  const attach = document.getElementById('agent-attach') as HTMLButtonElement | null;
  const attachInput = document.getElementById('agent-attach-input') as HTMLInputElement | null;
  const dropzone = document.getElementById('agent-dropzone');
  const newChat = document.getElementById('agent-new-chat') as HTMLButtonElement | null;
  if (!chips || !modelField || !modelButton || !modelMenu || !picker || !auto || !form || !input || !quota || !thread || !attach || !attachInput || !dropzone || !newChat) return;

  persistModel(storedModel());
  renderModelMenu();
  renderSelectionChip();
  store.subscribe(renderSelectionChip);
  const status = document.getElementById('agent-status');
  if (status) {
    subscribeAgentLive((live) => paintAgentStatus(status, live));
    window.setInterval(() => {
      const live = getAgentLive();
      if (live.state !== 'idle') paintAgentStatus(status, live);
    }, 1000);
  }
  auto.checked = storedAutoApprove();

  chips.replaceChildren(...PROMPT_CHIPS.map((chip) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.chip = chip.id;
    button.textContent = chip.label;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      input.value = chip.prompt;
      resizeComposerInput(input);
      void runTurn(chip.prompt);
    });
    return button;
  }));

  document.querySelectorAll<HTMLButtonElement>('[data-sidebar-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.sidebarTab;
      if (tab === 'layers' || tab === 'agents') setSidebarTab(tab);
    });
  });
  try {
    const saved = window.sessionStorage.getItem(TAB_KEY);
    if (saved === 'agents' || saved === 'layers') setSidebarTab(saved);
  } catch { /* ignore */ }

  auto.addEventListener('change', () => {
    try { window.localStorage.setItem(AUTO_KEY, auto.checked ? '1' : '0'); } catch { /* ignore */ }
  });
  modelButton.addEventListener('click', () => {
    const open = modelButton.getAttribute('aria-expanded') === 'true';
    if (open) {
      closeModelMenu();
      return;
    }
    renderModelMenu();
    modelButton.setAttribute('aria-expanded', 'true');
    modelMenu.hidden = false;
  });
  document.addEventListener('pointerdown', (event) => {
    if (!picker.contains(event.target as Node)) closeModelMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeModelMenu();
    if (event.target instanceof HTMLTextAreaElement && event.target.classList.contains('agent-edit-input')) return;
    cancelEdit();
  });

  thread.addEventListener('click', (event) => {
    const copyCode = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]');
    if (copyCode) {
      const block = copyCode.closest('.agent-md-codeblock, .aui-md');
      const code = block?.querySelector('pre')?.textContent ?? '';
      void navigator.clipboard.writeText(code).then(() => {
        copyCode.textContent = 'Copied';
        window.setTimeout(() => { if (copyCode.isConnected) copyCode.textContent = 'Copy'; }, 3000);
      });
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-turn-action]');
    if (!button || button.disabled) return;
    handleTurnAction(button);
  });
  thread.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.classList.contains('agent-edit-input')) return;
    const turn = findTurn(event.target);
    if (!turn) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit(turn);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendEdit(turn);
    }
  });

  attach.addEventListener('click', () => {
    if (attach.disabled) return;
    attachInput.click();
  });
  attachInput.addEventListener('change', () => {
    const files = attachInput.files ? [...attachInput.files] : [];
    attachInput.value = '';
    void stageFiles(files);
  });
  input.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void stageFiles(files);
  });

  const setDragging = (active: boolean) => {
    dropzone.classList.toggle('is-drag', active);
    dropzone.dataset.dragging = active ? 'true' : 'false';
  };
  dropzone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    setDragging(true);
  });
  dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  });
  dropzone.addEventListener('dragleave', (event) => {
    if (event.relatedTarget instanceof Node && dropzone.contains(event.relatedTarget)) return;
    setDragging(false);
  });
  dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    setDragging(false);
    void stageFiles(event.dataTransfer?.files ?? []);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if ((!message && !staged.length) || input.disabled) return;
    void runTurn(message);
  });
  input.addEventListener('input', () => resizeComposerInput(input));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  void refreshStatus(quota);
  newChat.addEventListener('click', () => {
    if (newChat.disabled) return;
    void startNewChat();
  });
}
