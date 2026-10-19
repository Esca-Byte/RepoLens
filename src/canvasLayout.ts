import type { GraphNode } from './types';

export interface CanvasPoint {
  x: number;
  y: number;
}

export type CanvasLayoutMode = 'generated' | 'curated';

export interface CanvasLayoutState {
  positions: Record<string, CanvasPoint>;
  locked: string[];
  mode: CanvasLayoutMode;
  layoutStyle?: 'constellation';
}

export interface CanvasLayoutHistory {
  past: CanvasLayoutState[];
  future: CanvasLayoutState[];
}

const STORAGE_PREFIX = 'repolens:canvas-layout:';

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function nodeSize(node: GraphNode): { width: number; height: number } {
  if (node.kind === 'external') return { width: 154, height: 72 };
  if (node.id.startsWith('domain:')) return { width: 202, height: 100 };
  if (node.id.startsWith('api:')) return { width: 182, height: 88 };
  if (node.id.startsWith('function:')) return { width: 176, height: 88 };
  if (node.kind === 'file') return { width: 176, height: 88 };
  return { width: 190, height: 96 };
}

function placeOnRing(
  positions: Record<string, CanvasPoint>,
  node: GraphNode,
  center: CanvasPoint,
  radius: number,
  angle: number,
): void {
  const size = nodeSize(node);
  positions[node.id] = {
    x: center.x + Math.cos(angle) * radius - size.width / 2,
    y: center.y + Math.sin(angle) * radius - size.height / 2,
  };
}

export function generatedCanvasPositions(nodes: GraphNode[]): Record<string, CanvasPoint> {
  const positions: Record<string, CanvasPoint> = {};
  const center = { x: 600, y: 360 };
  const primary = nodes
    .filter((node) => node.kind !== 'external')
    .sort((a, b) => b.score - a.score || b.inbound + b.outbound - (a.inbound + a.outbound) || a.id.localeCompare(b.id));
  const external = nodes
    .filter((node) => node.kind === 'external')
    .sort((a, b) => a.id.localeCompare(b.id));

  if (primary[0]) {
    const hubSize = nodeSize(primary[0]);
    positions[primary[0].id] = {
      x: center.x - hubSize.width / 2,
      y: center.y - hubSize.height / 2,
    };
  }

  const ringCapacity = 7;
  primary.slice(1).forEach((node, index) => {
    const ring = Math.floor(index / ringCapacity);
    const ringIndex = index % ringCapacity;
    const count = Math.min(ringCapacity, primary.length - 1 - ring * ringCapacity);
    const radius = 280 + ring * 230;
    const angle = -Math.PI / 2 + (ringIndex / Math.max(count, 1)) * Math.PI * 2 + ring * 0.19;
    placeOnRing(positions, node, center, radius, angle);
  });

  if (external.length) {
    const externalRadius = 760 + Math.max(0, Math.ceil(primary.length / ringCapacity) - 1) * 120;
    external.forEach((node, index) => {
      const angle = Math.PI / 2 + (index / Math.max(external.length, 1)) * Math.PI * 2;
      placeOnRing(positions, node, center, externalRadius, angle);
    });
  }

  return positions;
}

export function createCanvasLayout(nodes: GraphNode[], mode: CanvasLayoutMode = 'generated'): CanvasLayoutState {
  return {
    positions: generatedCanvasPositions(nodes),
    locked: [],
    mode,
    layoutStyle: 'constellation',
  };
}

export function createCanvasLayoutHistory(): CanvasLayoutHistory {
  return { past: [], future: [] };
}

function samePoint(left: CanvasPoint | undefined, right: CanvasPoint | undefined): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

export function sameCanvasLayout(left: CanvasLayoutState, right: CanvasLayoutState): boolean {
  if (left.mode !== right.mode || left.layoutStyle !== right.layoutStyle) return false;
  if (left.locked.length !== right.locked.length || left.locked.some((id, index) => id !== right.locked[index])) return false;
  const ids = new Set([...Object.keys(left.positions), ...Object.keys(right.positions)]);
  return [...ids].every((id) => samePoint(left.positions[id], right.positions[id]));
}

export function recordCanvasLayout(history: CanvasLayoutHistory, previous: CanvasLayoutState, next: CanvasLayoutState, limit = 50): CanvasLayoutHistory {
  if (sameCanvasLayout(previous, next)) return history;
  return { past: [...history.past, previous].slice(-limit), future: [] };
}

export function undoCanvasLayout(history: CanvasLayoutHistory, current: CanvasLayoutState, limit = 50): { history: CanvasLayoutHistory; layout?: CanvasLayoutState } {
  const layout = history.past.at(-1);
  if (!layout) return { history };
  return {
    layout,
    history: { past: history.past.slice(0, -1), future: [...history.future, current].slice(-limit) },
  };
}

export function redoCanvasLayout(history: CanvasLayoutHistory, current: CanvasLayoutState, limit = 50): { history: CanvasLayoutHistory; layout?: CanvasLayoutState } {
  const layout = history.future.at(-1);
  if (!layout) return { history };
  return {
    layout,
    history: { past: [...history.past, current].slice(-limit), future: history.future.slice(0, -1) },
  };
}

export function canvasLayoutKey(
  repositoryName: string,
  granularity: string,
  nodeIds: string[],
  selectedId: string | null = null,
): string {
  const scope = granularity === 'sequence' ? selectedId ?? 'default' : 'default';
  return `${repositoryName}:${granularity}:${scope}:${nodeIds.join('|')}`;
}

export function reconcileCanvasLayout(
  saved: CanvasLayoutState | null,
  nodes: GraphNode[],
): CanvasLayoutState {
  const generated = generatedCanvasPositions(nodes);
  const validIds = new Set(nodes.map((node) => node.id));
  const shouldRegenerateLegacyGenerated = saved?.mode === 'generated' && saved.layoutStyle !== 'constellation';
  const positions = Object.fromEntries(
    nodes.map((node) => [node.id, shouldRegenerateLegacyGenerated ? generated[node.id] : saved?.positions[node.id] ?? generated[node.id]]),
  ) as Record<string, CanvasPoint>;

  return {
    positions,
    locked: (saved?.locked ?? []).filter((id) => validIds.has(id)),
    mode: saved?.mode ?? 'generated',
    layoutStyle: 'constellation',
  };
}

export function loadCanvasLayout(key: string, nodes: GraphNode[]): CanvasLayoutState {
  if (typeof window === 'undefined') return createCanvasLayout(nodes);
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return createCanvasLayout(nodes);
    const parsed = JSON.parse(raw) as CanvasLayoutState;
    if (!parsed || typeof parsed !== 'object' || !parsed.positions) return createCanvasLayout(nodes);
    return reconcileCanvasLayout(parsed, nodes);
  } catch {
    return createCanvasLayout(nodes);
  }
}

export function saveCanvasLayout(key: string, layout: CanvasLayoutState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(layout));
  } catch {
    // Layout persistence is an enhancement; a blocked storage area should not
    // make the architecture map unusable.
  }
}

export function clearCanvasLayout(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(key));
  } catch {
    // Ignore storage cleanup failures for the same reason as save failures.
  }
}
