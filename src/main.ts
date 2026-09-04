import '../style.css';
import {
  addReferenceImage,
  applyDesignStyles,
  createNode,
  deleteNodes,
  getDesignTree,
  handleChallengeTool,
  inspectCanvas,
  inspectReferenceImage,
  importProject,
  listReferenceImages,
  moveNodes,
  recreateFromReference,
  resetDocument,
  redoDocument,
  setDesignText,
  undoDocument,
} from './tools';
import { initAgentPanel } from './agent';
import { runCanvasTool } from './agent-bridge';
import { initRenderer } from './renderer';
import { registerWebMcp } from './webmcp';
import { store } from './store';

declare global {
  interface Window {
    canvasEngine: Record<string, unknown>;
    __canvasToolCount?: number;
    __canvasWebMcpNative?: boolean;
  }
}

window.canvasEngine = {
  store,
  inspectCanvas,
  getDesignTree,
  setDesignText,
  applyDesignStyles,
  addReferenceImage,
  listReferenceImages,
  inspectReferenceImage,
  recreateFromReference,
  createNode,
  deleteNodes,
  moveNodes,
  resetDocument,
  undoDocument,
  redoDocument,
  importProject,
  runCanvasTool,
  handleMcpToolCall: (name: string, args: Record<string, unknown> = {}) => handleChallengeTool(name, args),
};

void registerWebMcp()
  .then((registration) => {
    window.__canvasToolCount = registration.count;
    window.__canvasWebMcpNative = registration.native;
  })
  .catch((error) => {
    console.warn('WebMCP registration failed', error);
  })
  .finally(() => {
    initRenderer();
    initAgentPanel();
  });
