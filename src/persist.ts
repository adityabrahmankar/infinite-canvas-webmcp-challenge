import type { AgentChatMessage, AgentImage, AgentToolCall } from './agent-protocol';
import type { DesignNode } from './types';

export const DOC_STORAGE_KEY = 'infinite-canvas-doc-v3';
export const THREAD_STORAGE_KEY = 'infinite-canvas-agent-thread-v1';

const IMAGE_DB = 'infinite-canvas';
const IMAGE_STORE = 'images';
const IMAGE_DB_VERSION = 1;

export interface PersistedDocument {
  nodes: DesignNode[];
  rootIds: string[];
  revision?: number;
}

export interface PersistedToolStep {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  ok: boolean;
}

export type PersistedTurnBlock =
  | { type: 'tools'; steps: PersistedToolStep[] }
  | { type: 'reply'; text: string; reasoning?: string; durationSec?: number };

export interface PersistedAgentTurn {
  id: string;
  message: string;
  images: AgentImage[];
  contextLabel: string;
  blocks: PersistedTurnBlock[];
}

export interface PersistedAgentThread {
  version: 1;
  turns: PersistedAgentTurn[];
}

export function splitDocumentImages(nodes: DesignNode[]): { nodes: DesignNode[]; images: Record<string, string> } {
  const images: Record<string, string> = {};
  const next = nodes.map((node) => {
    if (!node.imageSrc) return node;
    images[node.id] = node.imageSrc;
    const { imageSrc: _imageSrc, ...rest } = node;
    return rest as DesignNode;
  });
  return { nodes: next, images };
}

export function mergeDocumentImages(nodes: DesignNode[], images: Record<string, string>): DesignNode[] {
  if (!images || !Object.keys(images).length) return nodes;
  return nodes.map((node) => {
    const imageSrc = images[node.id];
    if (!imageSrc) return node;
    return { ...node, imageSrc };
  });
}

export function serializePersistedDocument(doc: PersistedDocument): string {
  const { nodes, images: _images } = splitDocumentImages(doc.nodes);
  return JSON.stringify({ nodes, rootIds: doc.rootIds, revision: doc.revision });
}

export function parsePersistedDocument(raw: string | null | undefined): PersistedDocument | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedDocument;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.rootIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadPersistedDocument(): PersistedDocument | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return parsePersistedDocument(window.localStorage.getItem(DOC_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePersistedDocument(doc: PersistedDocument): Record<string, string> {
  const { nodes, images } = splitDocumentImages(doc.nodes);
  const payload: PersistedDocument = { nodes, rootIds: doc.rootIds, revision: doc.revision };
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Canvas document could not be saved to local storage.', error);
    }
  }
  void saveDocumentImages(images);
  return images;
}

export async function loadDocumentImages(): Promise<Record<string, string>> {
  const db = await openImageDb();
  if (!db) return {};
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, 'readonly');
      const store = tx.objectStore(IMAGE_STORE);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const images: Record<string, string> = {};
        for (const row of request.result as Array<{ id?: string; dataUrl?: string }>) {
          if (row?.id && typeof row.dataUrl === 'string') images[row.id] = row.dataUrl;
        }
        resolve(images);
      };
    });
  } catch {
    return {};
  } finally {
    db.close();
  }
}

export async function clearDocumentImages(): Promise<void> {
  await saveDocumentImages({});
}

async function saveDocumentImages(images: Record<string, string>): Promise<void> {
  const db = await openImageDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IMAGE_STORE, 'readwrite');
      const store = tx.objectStore(IMAGE_STORE);
      store.clear();
      for (const [id, dataUrl] of Object.entries(images)) {
        store.put({ id, dataUrl });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('Canvas images could not be saved.', error);
  } finally {
    db.close();
  }
}

function openImageDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IMAGE_DB, IMAGE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IMAGE_STORE)) {
          db.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function stripTurnImages(images: AgentImage[]): AgentImage[] {
  return images.map((image) => ({
    name: image.name,
    dataUrl: '',
    width: image.width,
    height: image.height,
  }));
}

export function serializeAgentThread(turns: PersistedAgentTurn[]): string {
  const payload: PersistedAgentThread = {
    version: 1,
    turns: turns.map((turn) => ({
      ...turn,
      images: stripTurnImages(turn.images),
    })),
  };
  return JSON.stringify(payload);
}

export function parseAgentThread(raw: string | null | undefined): PersistedAgentTurn[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PersistedAgentThread;
    if (parsed.version !== 1 || !Array.isArray(parsed.turns)) return [];
    return parsed.turns.filter((turn) => turn && typeof turn.id === 'string' && typeof turn.message === 'string');
  } catch {
    return [];
  }
}

export function loadAgentThread(): PersistedAgentTurn[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    return parseAgentThread(window.localStorage.getItem(THREAD_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveAgentThread(turns: PersistedAgentTurn[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(THREAD_STORAGE_KEY, serializeAgentThread(turns));
  } catch (error) {
    try {
      const stripped = turns.map((turn) => ({ ...turn, images: stripTurnImages(turn.images) }));
      window.localStorage.setItem(THREAD_STORAGE_KEY, serializeAgentThread(stripped));
    } catch {
      console.warn('Agent chat could not be saved to local storage.', error);
    }
  }
}

export function clearAgentThread(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(THREAD_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function rewindMessages(messages: AgentChatMessage[], userTurns: number): AgentChatMessage[] {
  const keep = Math.max(0, Math.floor(userTurns));
  if (keep < 1 || !Array.isArray(messages) || messages.length === 0) return [];
  let users = 0;
  let end = messages.length;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role !== 'user') continue;
    if (users === keep) {
      end = i;
      break;
    }
    users += 1;
  }
  return messages.slice(0, end);
}

export function threadTurnsFromMessages(messages: AgentChatMessage[]): PersistedAgentTurn[] {
  const turns: PersistedAgentTurn[] = [];
  let current: PersistedAgentTurn | undefined;
  let pendingCalls: AgentToolCall[] = [];
  let pendingIndex = 0;
  let openTools: PersistedToolStep[] | undefined;

  for (const message of messages) {
    if (!message || typeof message.role !== 'string') continue;
    if (message.role === 'user') {
      pendingCalls = [];
      pendingIndex = 0;
      openTools = undefined;
      current = {
        id: `restored-${turns.length + 1}`,
        message: message.content || '',
        images: stripTurnImages(message.images ?? []),
        contextLabel: '',
        blocks: [],
      };
      turns.push(current);
      continue;
    }
    if (!current) continue;
    if (message.role === 'assistant') {
      openTools = undefined;
      if (message.toolCalls?.length) {
        pendingCalls = message.toolCalls;
        pendingIndex = 0;
        openTools = [];
        current.blocks.push({ type: 'tools', steps: openTools });
      }
      if ((message.content && message.content.trim()) || (message.reasoning && message.reasoning.trim())) {
        current.blocks.push({
          type: 'reply',
          text: message.content || '',
          ...(message.reasoning ? { reasoning: message.reasoning } : {}),
        });
      }
      continue;
    }
    if (message.role === 'tool') {
      const call = pendingCalls[pendingIndex++];
      const step: PersistedToolStep = {
        name: call?.name || 'tool',
        arguments: call?.arguments ?? {},
        result: message.content || '',
        ok: !/"isError"\s*:\s*true/.test(message.content || '') && !/^{"error"/.test(message.content || ''),
      };
      if (openTools) openTools.push(step);
      else current.blocks.push({ type: 'tools', steps: [step] });
    }
  }
  return turns;
}
