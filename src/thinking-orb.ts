import { MODE_DRAWS, resolvePreset, type OrbSize, type OrbState } from 'thinking-orbs/engine';
import { getAgentLive, subscribeAgentLive, type AgentLive } from './agent-activity';
import { store } from './store';
import { panX, panY, zoom } from './viewport';

export type CanvasOrbState = OrbState;
export type CanvasOrbSize = OrbSize;

interface MountedOrb {
  canvas: HTMLCanvasElement;
  state: CanvasOrbState;
  size: CanvasOrbSize;
  time: number;
  paused: boolean;
  visible: boolean;
}

const mounts = new Set<MountedOrb>();
let clock = 0;
let lastTs = 0;
let raf = 0;

function isDark(): boolean {
  return document.documentElement.dataset.theme !== 'light';
}

function draw(mount: MountedOrb, dt: number): void {
  const { canvas, state, size } = mount;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const resolved = resolvePreset(state, size);
  const draw = MODE_DRAWS[resolved.mode];
  if (!draw) return;
  mount.time += dt * resolved.speed;
  ctx.clearRect(0, 0, size, size);
  draw(ctx, size, mount.time, isDark(), resolved.opts);
}

function tick(ts: number): void {
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  clock += dt;
  for (const mount of mounts) {
    if (mount.paused || !mount.visible) continue;
    draw(mount, dt);
  }
  raf = mounts.size ? requestAnimationFrame(tick) : 0;
}

function ensureClock(): void {
  if (!raf && mounts.size) {
    lastTs = 0;
    raf = requestAnimationFrame(tick);
  }
}

export function orbStateForAgent(live: AgentLive): CanvasOrbState | null {
  if (live.state === 'idle') return null;
  if (live.state === 'waiting') return 'listening';
  if (live.state === 'thinking') return 'composing';
  const label = live.label.toLowerCase();
  if (/(inspect|list_|get_design|read)/.test(label)) return 'searching';
  if (/(create|set_|move|resize|style|recreate)/.test(label)) return 'shaping';
  if (/(export|import|reset)/.test(label)) return 'solving';
  return 'working';
}

export function mountThinkingOrb(
  canvas: HTMLCanvasElement,
  options: { state: CanvasOrbState; size: CanvasOrbSize },
): { setState: (state: CanvasOrbState) => void; destroy: () => void } {
  const size = options.size;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

  const mount: MountedOrb = {
    canvas,
    state: options.state,
    size,
    time: clock,
    paused: false,
    visible: true,
  };
  mounts.add(mount);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    mount.paused = reduced.matches || document.hidden;
    if (!mount.paused) draw(mount, 0);
  };
  applyMotion();
  reduced.addEventListener('change', applyMotion);
  document.addEventListener('visibilitychange', applyMotion);

  const io = new IntersectionObserver((entries) => {
    mount.visible = entries.some((entry) => entry.isIntersecting);
  }, { threshold: 0.01 });
  io.observe(canvas);
  ensureClock();

  return {
    setState(state: CanvasOrbState) {
      mount.state = state;
      draw(mount, 0);
    },
    destroy() {
      reduced.removeEventListener('change', applyMotion);
      document.removeEventListener('visibilitychange', applyMotion);
      io.disconnect();
      mounts.delete(mount);
      if (!mounts.size && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}

export function createOrbCanvas(state: CanvasOrbState, size: CanvasOrbSize, label: string): {
  canvas: HTMLCanvasElement;
  setState: (state: CanvasOrbState) => void;
  destroy: () => void;
} {
  const canvas = document.createElement('canvas');
  canvas.className = 'thinking-orb';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  const handle = mountThinkingOrb(canvas, { state, size });
  return { canvas, ...handle };
}

const canvasOrbs = new Map<string, { wrap: HTMLElement; setState: (state: CanvasOrbState) => void; destroy: () => void }>();

/** Inline preset — 64 is chat-avatar scale and reads huge on the board. */
const CANVAS_ORB_DRAW_SIZE = 20 as const;
/** World-space marker size; screen size follows zoom so the orb stays relative to the canvas. */
const CANVAS_ORB_WORLD_SIZE = 32;
const CANVAS_ORB_MIN_SCREEN = 18;

function canvasOrbScreenSize(): number {
  return Math.max(CANVAS_ORB_MIN_SCREEN, CANVAS_ORB_WORLD_SIZE * zoom);
}

function frameIdFor(id: string): string {
  const start = store.getNode(id);
  if (!start) return id;
  if (start.kind === 'frame') return start.id;
  let current = start;
  while (current.parentId) {
    const parent = store.getNode(current.parentId);
    if (!parent) break;
    if (parent.kind === 'frame') return parent.id;
    current = parent;
  }
  return start.id;
}

function orbAnchorIds(live: AgentLive): string[] {
  const preferred = [...live.nodeIds, ...store.selectedIds].filter((id) => store.getNode(id));
  const ids = preferred.length ? preferred : store.rootIds.slice(0, 1);
  return [...new Set(ids.map(frameIdFor))].slice(0, 2);
}

export function syncCanvasAgentOrbs(): void {
  const layer = document.getElementById('canvas-agent-orbs');
  if (!layer) return;
  const live = getAgentLive();
  const state = orbStateForAgent(live);
  if (!state) {
    for (const entry of canvasOrbs.values()) entry.destroy();
    canvasOrbs.clear();
    layer.replaceChildren();
    return;
  }
  const ids = orbAnchorIds(live);
  for (const [id, entry] of canvasOrbs) {
    if (!ids.includes(id)) {
      entry.destroy();
      entry.wrap.remove();
      canvasOrbs.delete(id);
    }
  }
  for (const id of ids) {
    const node = store.getNode(id);
    if (!node) continue;
    const bounds = store.worldBounds(node);
    let entry = canvasOrbs.get(id);
    if (!entry) {
      const wrap = document.createElement('div');
      wrap.className = 'canvas-agent-orb';
      const mounted = createOrbCanvas(state, CANVAS_ORB_DRAW_SIZE, live.label || 'Working');
      wrap.append(mounted.canvas);
      layer.append(wrap);
      entry = { wrap, setState: mounted.setState, destroy: mounted.destroy };
      canvasOrbs.set(id, entry);
    } else {
      entry.setState(state);
      entry.wrap.querySelector('canvas')?.setAttribute('aria-label', live.label || 'Working');
    }
    const px = canvasOrbScreenSize();
    entry.wrap.style.width = `${px}px`;
    entry.wrap.style.height = `${px}px`;
    entry.wrap.style.left = `${panX + (bounds.x + bounds.width / 2) * zoom}px`;
    entry.wrap.style.top = `${panY + bounds.y * zoom}px`;
  }
}

export function initCanvasAgentOrbs(): void {
  subscribeAgentLive(syncCanvasAgentOrbs);
}
