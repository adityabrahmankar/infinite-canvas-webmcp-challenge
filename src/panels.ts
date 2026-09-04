const SIDEBAR_DEFAULT = 268;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 420;
const INSPECTOR_DEFAULT = 280;
const INSPECTOR_MIN = 220;
const INSPECTOR_MAX = 520;
const CANVAS_MIN = 280;
const STORAGE_SIDEBAR = 'infinite-canvas-sidebar-width';
const STORAGE_INSPECTOR = 'infinite-canvas-inspector-width';

let sidebarWidth = SIDEBAR_DEFAULT;
let inspectorWidth = INSPECTOR_DEFAULT;

function readStored(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const value = raw ? Number(raw) : fallback;
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function persist(key: string, value: number): void {
  try { window.localStorage.setItem(key, String(Math.round(value))); }
  catch { /* ignore quota / private mode */ }
}

function inspectorVisible(): boolean {
  const inspector = document.querySelector<HTMLElement>('.inspector');
  return !!inspector && getComputedStyle(inspector).display !== 'none';
}

function clampSidebar(width: number): number {
  const right = inspectorVisible() ? inspectorWidth : 0;
  const max = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, window.innerWidth - right - CANVAS_MIN));
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN, width)));
}

function clampInspector(width: number): number {
  const max = Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, window.innerWidth - sidebarWidth - CANVAS_MIN));
  return Math.round(Math.min(max, Math.max(INSPECTOR_MIN, width)));
}

function applyPanelWidths(): void {
  const root = document.documentElement;
  root.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  root.style.setProperty('--inspector-width', `${inspectorWidth}px`);
  const leftHandle = document.getElementById('sidebar-resize');
  const rightHandle = document.getElementById('inspector-resize');
  leftHandle?.setAttribute('aria-valuenow', String(sidebarWidth));
  rightHandle?.setAttribute('aria-valuenow', String(inspectorWidth));
}

function bindHandle(handle: HTMLElement, side: 'left' | 'right'): void {
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-valuemin', String(side === 'left' ? SIDEBAR_MIN : INSPECTOR_MIN));
  handle.setAttribute('aria-valuemax', String(side === 'left' ? SIDEBAR_MAX : INSPECTOR_MAX));
  handle.tabIndex = 0;

  const apply = (clientX: number) => {
    if (side === 'left') {
      sidebarWidth = clampSidebar(clientX);
      persist(STORAGE_SIDEBAR, sidebarWidth);
    } else {
      inspectorWidth = clampInspector(window.innerWidth - clientX);
      persist(STORAGE_INSPECTOR, inspectorWidth);
    }
    applyPanelWidths();
  };

  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    apply(event.clientX);
    document.body.classList.add('is-resizing-panels');
    try { handle.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
  });
  handle.addEventListener('pointermove', (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    apply(event.clientX);
  });
  const stop = (event: PointerEvent) => {
    document.body.classList.remove('is-resizing-panels');
    try { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('dblclick', () => {
    if (side === 'left') {
      sidebarWidth = clampSidebar(SIDEBAR_DEFAULT);
      persist(STORAGE_SIDEBAR, sidebarWidth);
    } else {
      inspectorWidth = clampInspector(INSPECTOR_DEFAULT);
      persist(STORAGE_INSPECTOR, inspectorWidth);
    }
    applyPanelWidths();
  });
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? step : -step;
      if (side === 'left') {
        sidebarWidth = clampSidebar(sidebarWidth + delta);
        persist(STORAGE_SIDEBAR, sidebarWidth);
      } else {
        inspectorWidth = clampInspector(inspectorWidth - delta);
        persist(STORAGE_INSPECTOR, inspectorWidth);
      }
      applyPanelWidths();
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (side === 'left') sidebarWidth = SIDEBAR_MIN;
      else inspectorWidth = INSPECTOR_MIN;
      persist(side === 'left' ? STORAGE_SIDEBAR : STORAGE_INSPECTOR, side === 'left' ? sidebarWidth : inspectorWidth);
      applyPanelWidths();
    }
    if (event.key === 'End') {
      event.preventDefault();
      if (side === 'left') sidebarWidth = clampSidebar(SIDEBAR_MAX);
      else inspectorWidth = clampInspector(INSPECTOR_MAX);
      persist(side === 'left' ? STORAGE_SIDEBAR : STORAGE_INSPECTOR, side === 'left' ? sidebarWidth : inspectorWidth);
      applyPanelWidths();
    }
  });
}

export function initPanelResize(): void {
  sidebarWidth = clampSidebar(readStored(STORAGE_SIDEBAR, SIDEBAR_DEFAULT));
  inspectorWidth = clampInspector(readStored(STORAGE_INSPECTOR, INSPECTOR_DEFAULT));
  applyPanelWidths();

  const left = document.getElementById('sidebar-resize');
  const right = document.getElementById('inspector-resize');
  if (left) bindHandle(left, 'left');
  if (right) bindHandle(right, 'right');

  window.addEventListener('resize', () => {
    sidebarWidth = clampSidebar(sidebarWidth);
    inspectorWidth = clampInspector(inspectorWidth);
    applyPanelWidths();
  });
}
