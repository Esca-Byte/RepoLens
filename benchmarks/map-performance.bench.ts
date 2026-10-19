import { bench, describe } from 'vitest';
import { createLensGraph } from '../src/mapFeatures';
import type { GraphEdge, GraphNode, RepositoryAnalysis } from '../src/types';

function largeAnalysis(nodeCount = 2_000, edgeCount = 24_000): RepositoryAnalysis {
  const nodes: GraphNode[] = Array.from({ length: nodeCount }, (_, index) => ({
    id: `module:module-${index}`,
    label: `Module ${index}`,
    kind: 'module',
    path: `src/domain-${index % 40}/module-${index}`,
    description: 'Synthetic module for the architecture-map performance workload.',
    fileCount: 4,
    inbound: 0,
    outbound: 0,
    score: nodeCount - index,
  }));
  const edges: GraphEdge[] = Array.from({ length: edgeCount }, (_, index) => {
    const visibleNodeCount = Math.min(nodeCount, 120);
    const source = index % visibleNodeCount;
    const target = (source * 17 + index * 13 + 7) % visibleNodeCount;
    nodes[source].outbound += 1;
    nodes[target].inbound += 1;
    return {
      id: `edge:${index}`,
      source: nodes[source].id,
      target: nodes[target].id,
      type: index % 5 === 0 ? 'exports' : 'imports',
      weight: (index % 4) + 1,
      label: 'imports',
    };
  });
  return {
    name: 'synthetic-large-repository',
    files: [],
    symbols: [],
    references: [],
    modules: [],
    nodes,
    fileNodes: [],
    edges,
    fileEdges: [],
    entryPoints: [],
    languages: [],
    summary: { headline: '', paragraphs: [], startHere: [], boundaries: [], hotspots: [] },
    metrics: { files: nodeCount * 4, modules: nodeCount, symbols: 0, references: 0, relationships: edgeCount, externalDependencies: 0 },
  };
}

const analysis = largeAnalysis();

function baselineVisibleModuleGraph(maxNodes: number) {
  const candidates = analysis.nodes;
  const edgeDegree = new Map<string, number>();
  const candidateIds = new Set(candidates.map((node) => node.id));
  analysis.edges.forEach((edge) => {
    if (!candidateIds.has(edge.source) || !candidateIds.has(edge.target)) return;
    edgeDegree.set(edge.source, (edgeDegree.get(edge.source) ?? 0) + edge.weight);
    edgeDegree.set(edge.target, (edgeDegree.get(edge.target) ?? 0) + edge.weight);
  });
  const ids = new Set(candidates
    .slice()
    .sort((left, right) => (edgeDegree.get(right.id) ?? 0) - (edgeDegree.get(left.id) ?? 0) || right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, maxNodes)
    .map((node) => node.id));
  return analysis.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
}

describe('large architecture map workload', () => {
  bench('baseline visible module graph', () => {
    baselineVisibleModuleGraph(120);
  });
  bench('builds the visible module graph', () => {
    createLensGraph(analysis, 'module', false, null, 'all', [], undefined, 120);
  });
});
