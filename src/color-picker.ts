import { applyDesignStyles } from './tools';
import { colorToCss, colorToPickerHex, hexToHsv, hsvToHex, normalizeHex } from './color';
import { store } from './store';

export type ColorField = 'background' | 'color';

const PRESETS = [
  '#FFFFFF', '#F8FAFC', '#94A3B8', '#1E293B', '#0B1220', '#000000',
  '#2563EB', '#3B82F6', '#60A5FA', '#F59E0B', '#EF4444', '#10B981',
  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
];

let hsv = { h: 0, s: 1, v: 1 };
let activeField: ColorField | null = null;
let pickerNodeId: string | null = null;
let inspectorPaused = false;
let dragging = false;

let popover: HTMLElement | null = null;
let satValArea: HTMLElement | null = null;
let satValCursor: HTMLElement | null = null;
let hueBar: HTMLElement | null = null;
let hueCursor: HTMLElement | null = null;
let hexInput: HTMLInputElement | null = null;
let previewSwatch: HTMLElement | null = null;
let anchorEl: HTMLElement | null = null;

export function isInspectorRenderPaused(): boolean {
  return inspectorPaused;
}

export function shouldCloseColorPicker(): boolean {
  return pickerNodeId !== null && store.selectedId !== pickerNodeId;
}

export function initColorPicker(): void {
  popover = document.getElementById('color-picker-popover');
  satValArea = document.getElementById('cp-sat-val');
  satValCursor = document.getElementById('cp-sat-val-cursor');
  hueBar = document.getElementById('cp-hue-bar');
  hueCursor = document.getElementById('cp-hue-cursor');
  hexInput = document.getElementById('cp-hex-input') as HTMLInputElement | null;
  previewSwatch = document.getElementById('cp-preview');

  document.getElementById('color-picker-close')?.addEventListener('click', () => closeColorPicker());
  document.addEventListener('pointerdown', (event) => {
    if (!popover || popover.hidden) return;
    const target = event.target as Node;
    if (popover.contains(target)) return;
    if ((target as HTMLElement).closest?.('[data-color-open]')) return;
    closeColorPicker();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popover && !popover.hidden) {
      event.preventDefault();
      closeColorPicker();
    }
  });

  popover?.addEventListener('pointerdown', (event) => event.stopPropagation());

  initSatValDrag();
  initHueDrag();
  initHexInput();
  initPresets();
}

function initPresets(): void {
  const row = document.getElementById('cp-presets');
  if (!row) return;
  row.innerHTML = PRESETS.map((hex) =>
    `<button type="button" class="color-preset" data-preset="${hex}" style="background:${hex}" aria-label="${hex}"></button>`,
  ).join('');
  row.innerHTML += `<button type="button" class="color-preset color-preset-transparent" data-preset="transparent" aria-label="Transparent"></button>`;
  row.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-preset]');
    if (!button || !activeField) return;
    const preset = button.dataset.preset ?? '';
    if (preset === 'transparent' && activeField === 'background') {
      commitColor('transparent');
      setPickerUi('#FFFFFF', { h: 0, s: 0, v: 1 });
      return;
    }
    const hex = normalizeHex(preset);
    if (!hex) return;
    hsv = hexToHsv(hex);
    commitColor(hex);
    syncPickerUi(hex);
  });
}

function initHexInput(): void {
  hexInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyHexInput();
    hexInput?.blur();
  });
  hexInput?.addEventListener('change', () => applyHexInput());
}

function applyHexInput(): void {
  if (!hexInput || !activeField) return;
  const hex = normalizeHex(hexInput.value);
  if (!hex) {
    hexInput.value = hsvToHex(hsv.h, hsv.s, hsv.v);
    return;
  }
  hsv = hexToHsv(hex);
  commitColor(hex);
  syncPickerUi(hex);
}

function initSatValDrag(): void {
  if (!satValArea) return;
  let active = false;

  const move = (event: PointerEvent) => {
    const rect = satValArea!.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    hsv.s = x / rect.width;
    hsv.v = 1 - y / rect.height;
    previewColor();
  };

  satValArea.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    active = true;
    if (!store.isGesturing()) store.beginGesture();
    dragging = true;
    satValArea!.setPointerCapture(event.pointerId);
    move(event);
  });
  satValArea.addEventListener('pointermove', (event) => {
    if (!active) return;
    event.stopPropagation();
    move(event);
  });
  const finish = (event: PointerEvent) => {
    if (!active) return;
    event.stopPropagation();
    active = false;
    dragging = false;
    if (store.isGesturing()) store.endGesture();
  };
  satValArea.addEventListener('pointerup', finish);
  satValArea.addEventListener('pointercancel', finish);
}

function initHueDrag(): void {
  if (!hueBar) return;
  let active = false;

  const move = (event: PointerEvent) => {
    const rect = hueBar!.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    hsv.h = (x / rect.width) * 360;
    previewColor();
  };

  hueBar.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    active = true;
    if (!store.isGesturing()) store.beginGesture();
    dragging = true;
    hueBar!.setPointerCapture(event.pointerId);
    move(event);
  });
  hueBar.addEventListener('pointermove', (event) => {
    if (!active) return;
    event.stopPropagation();
    move(event);
  });
  const finish = (event: PointerEvent) => {
    if (!active) return;
    event.stopPropagation();
    active = false;
    dragging = false;
    if (store.isGesturing()) store.endGesture();
  };
  hueBar.addEventListener('pointerup', finish);
  hueBar.addEventListener('pointercancel', finish);
}

function previewColor(): void {
  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
  syncPickerUi(hex);
  if (!activeField || !store.selectedId) return;
  store.updateStyle(store.selectedId, { [activeField]: hex });
  updateInspectorColorField(activeField, hex);
}

function commitColor(value: string): void {
  if (!activeField || !store.selectedId) return;
  applyDesignStyles({ nodeId: store.selectedId, styles: { [activeField]: value } });
  updateInspectorColorField(activeField, value);
  syncPickerUi(colorToPickerHex(value));
}

function syncPickerUi(hex: string): void {
  const pureHue = hsvToHex(hsv.h, 1, 1);
  if (satValArea) satValArea.style.backgroundColor = pureHue;
  if (satValCursor) {
    satValCursor.style.left = `${hsv.s * 100}%`;
    satValCursor.style.top = `${(1 - hsv.v) * 100}%`;
    satValCursor.style.backgroundColor = hex;
  }
  if (hueCursor) {
    hueCursor.style.left = `${(hsv.h / 360) * 100}%`;
    hueCursor.style.backgroundColor = pureHue;
  }
  if (hexInput) hexInput.value = hex;
  if (previewSwatch) previewSwatch.style.background = hex;
}

function setPickerUi(hex: string, nextHsv: typeof hsv): void {
  hsv = nextHsv;
  syncPickerUi(hex);
}

function positionPopover(): void {
  if (!popover) return;
  const inspector = document.querySelector('.inspector');
  const inspectorRect = inspector?.getBoundingClientRect();
  const popoverHeight = popover.offsetHeight || 320;
  const gap = 8;

  if (inspectorRect) {
    popover.style.right = `${window.innerWidth - inspectorRect.left + gap}px`;
    popover.style.left = 'auto';
  } else {
    popover.style.right = '300px';
    popover.style.left = 'auto';
  }

  if (anchorEl) {
    const anchorRect = anchorEl.getBoundingClientRect();
    const desiredTop = anchorRect.top - 12;
    const clampedTop = Math.max(12, Math.min(window.innerHeight - popoverHeight - 12, desiredTop));
    popover.style.top = `${clampedTop}px`;
  } else {
    popover.style.top = '80px';
  }
}

export function openColorPicker(field: ColorField, initialValue: string, trigger: HTMLElement): void {
  if (!popover) return;
  activeField = field;
  pickerNodeId = store.selectedId;
  anchorEl = trigger;
  inspectorPaused = true;

  const pickerHex = colorToPickerHex(initialValue);
  hsv = hexToHsv(pickerHex);

  popover.hidden = false;
  positionPopover();
  syncPickerUi(pickerHex);
  hexInput?.focus();
  hexInput?.select();
}

export function closeColorPicker(): void {
  if (!popover) return;
  if (dragging && store.isGesturing()) store.endGesture();
  dragging = false;
  popover.hidden = true;
  activeField = null;
  pickerNodeId = null;
  anchorEl = null;
  inspectorPaused = false;
  window.dispatchEvent(new CustomEvent('canvas:color-picker-closed'));
}

export function updateInspectorColorField(field: ColorField, value: string): void {
  const css = colorToCss(value, field === 'background' ? 'transparent' : '#FFFFFF');
  const hexInputEl = document.querySelector<HTMLInputElement>(`[data-inspector-field="${field}"][data-color-input]`);
  if (hexInputEl) hexInputEl.value = css === 'transparent' ? 'transparent' : (normalizeHex(css) ?? css);
  const swatch = document.querySelector<HTMLElement>(`[data-color-open="${field}"] .color-swatch-preview`);
  if (swatch) {
    swatch.style.background = css;
    swatch.classList.toggle('is-transparent', css === 'transparent');
  }
}

export function initInspectorColorFields(): void {
  const panel = document.getElementById('inspector-content');
  if (!panel || panel.dataset.colorBound === 'true') return;
  panel.dataset.colorBound = 'true';
  panel.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-color-open]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const field = button.dataset.colorOpen as ColorField | undefined;
    if (!field) return;
    const hexInputEl = button.parentElement?.querySelector<HTMLInputElement>(`[data-inspector-field="${field}"]`);
    const current = hexInputEl?.value ?? '';
    if (popover && !popover.hidden && activeField === field) {
      closeColorPicker();
      return;
    }
    openColorPicker(field, current, button);
  });
}
