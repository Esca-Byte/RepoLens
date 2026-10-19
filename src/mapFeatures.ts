import { createApiGraph, createDomainGraph, createFunctionGraph, createSequenceGraph, type ArchitectureGranularity } from './architectureLenses';
import { filterGraphEdges, type EdgeFilter } from './mapFilters';
import type { GraphEdge, GraphNode, RepositoryAnalysis } from './types';

export interface FeatureGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const LARGE_MAP_EDGE_LIMIT_PER_NODE = 4;

export interface NodeGroup {
  key: string;
  label: string;
  nodeIds: string[];
}

export type HealthWarningKind = 'cycle' | 'hotspot' | 'isolated' | 'large';
export type HealthWarningSeverity = 'high' | 'medium' | 'low';

export interface HealthWarning {
  id: string;
  kind: HealthWarningKind;
  severity: HealthWarningSeverity;
  title: string;
  detail: string;
  nodeIds: string[];
}

function selectedNeighbors(edges: GraphEdge[], selectedId: string): Set<string> {
  const ids = new Set([selectedId]);
  edges.forEach((edge) => {
    if (edge.source === selectedId) ids.add(edge.target);
    if (edge.target === selectedId) ids.add(edge.source);
  });
  return ids;
}

function limitGraphEdges(edges: GraphEdge[], selectedId: string | null, maxEdges: number, priorityEdgeIds = new Set<string>()): GraphEdge[] {
  if (edges.length <= maxEdges) return edges;
  const keptEdgeIds = new Set<string>();
  edges.forEach((edge) => {
    if (priorityEdgeIds.has(edge.id) && keptEdgeIds.size < maxEdges) keptEdgeIds.add(edge.id);
  });
  if (selectedId) {
    edges
      .filter((edge) => edge.source === selectedId || edge.target === selectedId)
      .slice(0, Math.floor(maxEdges * .45))
      .forEach((edge) => {
        if (keptEdgeIds.size < maxEdges) keptEdgeIds.add(edge.id);
      });
  }
  for (const edge of edges) {
    if (keptEdgeIds.size >= maxEdges) break;
    keptEdgeIds.add(edge.id);
  }
  return edges.filter((edge) => keptEdgeIds.has(edge.id));
}

function sourceGraph(analysis: RepositoryAnalysis, granularity: ArchitectureGranularity, selectedId: string | null, fileNodeLimit?: number): FeatureGraph {
  const domainGraph = granularity === 'domain' ? createDomainGraph(analysis) : undefined;
  const apiGraph = granularity === 'api' ? createApiGraph(analysis) : undefined;
  const functionGraph = granularity === 'function' ? createFunctionGraph(analysis) : undefined;
  const sequenceGraph = granularity === 'sequence' ? createSequenceGraph(analysis, selectedId) : undefined;
  const nodes = granularity === 'module'
    ? analysis.nodes
    : granularity === 'domain'
      ? domainGraph?.nodes ?? []
      : granularity === 'api'
        ? apiGraph?.nodes ?? []
        : granularity === 'function'
          ? functionGraph?.nodes ?? []
          : granularity === 'sequence'
            ? sequenceGraph?.nodes ?? []
            : analysis.fileNodes
              .filter((node) => node.kind === 'file')
              .sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound) || a.path.localeCompare(b.path))
              .slice(0, fileNodeLimit ?? 48);
  const edges = granularity === 'module'
    ? analysis.edges
    : granularity === 'domain'
      ? domainGraph?.edges ?? []
      : granularity === 'api'
        ? apiGraph?.edges ?? []
        : granularity === 'function'
          ? functionGraph?.edges ?? []
          : granularity === 'sequence'
            ? sequenceGraph?.edges ?? []
            : analysis.fileEdges;
  return { nodes, edges };
}

export function groupKeyForNode(node: GraphNode): string {
  if (node.id.startsWith('domain:')) return node.id.slice('domain:'.length) || 'root';
  if (node.kind === 'external') return 'external';
  const segments = node.path.replaceAll('\\', '/').split('/').filter(Boolean);
  if (segments[0] === 'src') return segments[1] ?? 'root';
  return segments[0] ?? 'root';
}

function groupLabel(key: string): string {
  if (key === 'external') return 'External packages';
  if (key === 'root') return 'Root';
  return key
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function groupGraphNodes(nodes: GraphNode[]): NodeGroup[] {
  const groups = new Map<string, string[]>();
  nodes.forEach((node) => {
    const key = groupKeyForNode(node);
    const ids = groups.get(key) ?? [];
    ids.push(node.id);
    groups.set(key, ids);
  });
  return [...groups.entries()]
    .map(([key, nodeIds]) => ({ key, label: groupLabel(key), nodeIds }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function createLensGraph(
  analysis: RepositoryAnalysis,
  granularity: ArchitectureGranularity,
  focusMode: boolean,
  selectedId: string | null,
  edgeFilter: EdgeFilter = 'all',
  collapsedGroups: string[] = [],
  includedNodeIds?: Set<string>,
  maxNodes?: number,
  priorityEdgeIds?: Set<string>,
): FeatureGraph {
  const fullGraph = sourceGraph(analysis, granularity, selectedId, maxNodes);
  const filteredEdges = filterGraphEdges(fullGraph.edges, edgeFilter);
  const selectedIsVisible = Boolean(selectedId && fullGraph.nodes.some((node) => node.id === selectedId));
  const focusIds = focusMode && selectedIsVisible && selectedId
    ? selectedNeighbors(filteredEdges, selectedId)
    : new Set(fullGraph.nodes.map((node) => node.id));
  const collapsed = new Set(collapsedGroups);
  const candidates = fullGraph.nodes.filter((node) => focusIds.has(node.id) && !collapsed.has(groupKeyForNode(node)) && (!includedNodeIds || includedNodeIds.has(node.id)));
  const selectedIsIncluded = Boolean(selectedId && candidates.some((node) => node.id === selectedId));
  const edgeDegree = new Map<string, number>();
  const candidateIds = new Set(candidates.map((node) => node.id));
  filteredEdges.forEach((edge) => {
    if (!candidateIds.has(edge.source) || !candidateIds.has(edge.target)) return;
    edgeDegree.set(edge.source, (edgeDegree.get(edge.source) ?? 0) + edge.weight);
    edgeDegree.set(edge.target, (edgeDegree.get(edge.target) ?? 0) + edge.weight);
  });
  const limitedIds = maxNodes && candidates.length > maxNodes
    ? new Set([
      ...(selectedIsIncluded && selectedId ? [selectedId] : []),
      ...[...candidates]
        .filter((node) => node.id !== selectedId)
        .sort((a, b) => (edgeDegree.get(b.id) ?? 0) - (edgeDegree.get(a.id) ?? 0) || b.score - a.score || b.inbound + b.outbound - (a.inbound + a.outbound) || a.id.localeCompare(b.id))
        .slice(0, Math.max(0, maxNodes - (selectedIsIncluded ? 1 : 0)))
        .map((node) => node.id),
    ])
    : undefined;
  const nodes = candidates.filter((node) => !limitedIds || limitedIds.has(node.id));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const visibleEdges = filteredEdges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const edgeLimit = maxNodes ? maxNodes * LARGE_MAP_EDGE_LIMIT_PER_NODE : undefined;
  return {
    nodes,
    edges: edgeLimit ? limitGraphEdges(visibleEdges, selectedId, edgeLimit, priorityEdgeIds) : visibleEdges,
  };
}

export function findGraphPath(edges: GraphEdge[], startId: string, endId: string): string[] | null {
  if (startId === endId) return [startId];
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  });
  const queue = [startId];
  const previous = new Map<string, string | null>([[startId, null]]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    for (const target of outgoing.get(current) ?? []) {
      if (previous.has(target)) continue;
      previous.set(target, current);
      if (target === endId) {
        const path: string[] = [];
        let cursor: string | null = target;
        while (cursor) {
          path.unshift(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return path;
      }
      queue.push(target);
    }
  }
  return null;
}

export function edgeIdsForPath(edges: GraphEdge[], path: string[] | null): string[] {
  if (!path || path.length < 2) return [];
  const pairs = new Set(path.slice(0, -1).map((id, index) => `${id}->${path[index + 1]}`));
  return edges.filter((edge) => pairs.has(`${edge.source}->${edge.target}`)).map((edge) => edge.id);
}

function cycleWarnings(nodes: GraphNode[], edges: GraphEdge[]): HealthWarning[] {
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  });
  const active = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles = new Map<string, string[]>();

  const visit = (id: string): void => {
    if (active.has(id)) {
      const start = stack.indexOf(id);
      const cycle = stack.slice(Math.max(start, 0));
      if (cycle.length > 1) cycles.set([...cycle].sort().join('|'), cycle);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    stack.push(id);
    (outgoing.get(id) ?? []).forEach(visit);
    stack.pop();
    active.delete(id);
  };

  nodes.forEach((node) => visit(node.id));
  return [...cycles.values()].map((cycle, index) => ({
    id: `cycle:${index}:${cycle.join('|')}`,
    kind: 'cycle',
    severity: 'high',
    title: 'Circular dependency',
    detail: `${cycle.length} nodes depend on each other in a loop.`,
    nodeIds: cycle,
  }));
}

export function analyzeHealth(analysis: RepositoryAnalysis): HealthWarning[] {
  const nodes = analysis.nodes;
  const warnings = cycleWarnings(nodes, analysis.edges);
  const hotspotThreshold = Math.max(4, Math.ceil(nodes.length * .45));
  nodes.filter((node) => node.inbound + node.outbound >= hotspotThreshold)
    .sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound))
    .slice(0, 4)
    .forEach((node) => warnings.push({
      id: `hotspot:${node.id}`,
      kind: 'hotspot',
      severity: 'medium',
      title: 'Highly connected node',
      detail: `${node.inbound + node.outbound} relationships make this node a likely change point.`,
      nodeIds: [node.id],
    }));
  nodes.filter((node) => node.inbound + node.outbound === 0).slice(0, 4).forEach((node) => warnings.push({
    id: `isolated:${node.id}`,
    kind: 'isolated',
    severity: 'low',
    title: 'No relationships',
    detail: 'This node is not connected to another local node in the module view.',
    nodeIds: [node.id],
  }));
  nodes.filter((node) => node.fileCount >= 5).slice(0, 4).forEach((node) => warnings.push({
    id: `large:${node.id}`,
    kind: 'large',
    severity: 'medium',
    title: 'Large module',
    detail: `${node.fileCount} files are grouped under this node.`,
    nodeIds: [node.id],
  }));
  return warnings.slice(0, 12);
}
