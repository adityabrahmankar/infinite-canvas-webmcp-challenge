export type NodeKind = 'frame' | 'text' | 'rect' | 'button' | 'image';
export type CanvasTool = 'select' | 'hand' | 'frame' | 'rect' | 'text' | 'button';
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type LayoutMode = 'absolute' | 'flex-row' | 'flex-column';
export type SizingMode = 'fixed' | 'fill' | 'hug';

/**
 * Browser-resolved geometry for a node participating in auto layout.
 *
 * These values are intentionally kept outside the persisted document AST:
 * the AST remains the source of authored intent while the renderer can feed
 * the layout engine's measured result back to hit-testing and overlays.
 */
export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeStyle {
  background?: string;
  color?: string;
  border?: string;
  borderRadius?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  opacity?: number;
  padding?: number;
  letterSpacing?: string;
}

export interface TreeNodeInput {
  parentId?: string | null;
  kind?: NodeKind;
  name?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layout?: LayoutMode;
  gap?: number;
  padding?: number;
  widthSizing?: SizingMode;
  heightSizing?: SizingMode;
  style?: NodeStyle | Record<string, unknown>;
  children?: TreeNodeInput[];
  referenceId?: string;
  imageSrc?: string;
}

export interface SetLayoutInput {
  nodeId?: string;
  layout?: LayoutMode;
  gap?: number;
  padding?: number;
  widthSizing?: SizingMode;
  heightSizing?: SizingMode;
}

export interface DesignNode {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;
  children: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  style: NodeStyle;
  hidden?: boolean;
  locked?: boolean;
  imageSrc?: string;
  referenceId?: string;
  layout?: LayoutMode;
  gap?: number;
  clipContent?: boolean;
  widthSizing?: SizingMode;
  heightSizing?: SizingMode;
}

export interface DocumentSnapshot {
  nodes: DesignNode[];
  rootIds: string[];
  selectedId: string | null;
  selectedIds: string[];
  revision: number;
}

export type ExportFormat = 'png' | 'svg' | 'html' | 'json';

export interface ExportArtifact {
  artifactId: string;
  format: ExportFormat;
  filename: string;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  rootNodeId: string;
  revision: number;
  checksum: string;
  data: string;
  warnings: string[];
}

export interface ToolResult<T = unknown> {
  structuredContent?: T;
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}
