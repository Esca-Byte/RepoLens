import { describe, expect, it } from 'vitest';
import { analyzeHealth, createLensGraph, edgeIdsForPath, findGraphPath, groupGraphNodes, LARGE_MAP_EDGE_LIMIT_PER_NODE } from './mapFeatures';
import { analyzeRepository } from './analyzer';
import type { GraphEdge, GraphNode, RepositoryAnalysis } from './types';

const node = (id: string, path = id): GraphNode => ({
  id,
  label: id,
  kind: 'module',
  path,
  description: '',
  fileCount: 1,
  inbound: 0,
  outbound: 0,
  score: 0,
});

const edges: GraphEdge[] = [
  { id: 'a-b', source: 'module:a', target: 'module:b', type: 'imports', weight: 1, label: 'imports' },
  { id: 'b-c', source: 'module:b', target: 'module:c', type: 'imports', weight: 1, label: 'imports' },
];

describe('map features', () => {
  it('finds a directed path and its edges', () => {
    const path = findGraphPath(edges, 'module:a', 'module:c');
    expect(path).toEqual(['module:a', 'module:b', 'module:c']);
    expect(edgeIdsForPath(edges, path)).toEqual(['a-b', 'b-c']);
  });

  it('groups nodes by their first source folder', () => {
    const groups = groupGraphNodes([node('module:a', 'src/api'), node('module:b', 'src/api'), node('module:c', 'src/data')]);
    expect(groups.map((group) => [group.key, group.nodeIds.length])).toEqual([['api', 2], ['data', 1]]);
  });

  it('reports cycles and isolated nodes', () => {
    const analysis = {
      nodes: [node('module:a'), node('module:b'), node('module:isolated')],
      edges: [
        { id: 'a-b', source: 'module:a', target: 'module:b', type: 'imports', weight: 1, label: 'imports' },
        { id: 'b-a', source: 'module:b', target: 'module:a', type: 'imports', weight: 1, label: 'imports' },
      ],
    } as RepositoryAnalysis;
    const warnings = analyzeHealth(analysis);
    expect(warnings.some((warning) => warning.kind === 'cycle')).toBe(true);
    expect(warnings.some((warning) => warning.kind === 'isolated')).toBe(true);
  });

  it('limits large graph lenses while preserving the selected node', () => {
    const analysis = analyzeRepository([
      { path: 'src/a/index.ts', content: 'export const a = true;', language: 'TypeScript', size: 0 },
      { path: 'src/b/index.ts', content: "import { a } from '../a'; export const b = a;", language: 'TypeScript', size: 0 },
      { path: 'src/c/index.ts', content: 'export const c = true;', language: 'TypeScript', size: 0 },
      { path: 'src/d/index.ts', content: 'export const d = true;', language: 'TypeScript', size: 0 },
    ], 'limited');
    const graph = createLensGraph(analysis, 'module', false, 'module:src/a', 'all', [], undefined, 2);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.some((node) => node.id === 'module:src/a')).toBe(true);
  });

  it('keeps connected endpoints when limiting a graph with many external nodes', () => {
    const imports = Array.from({ length: 12 }, (_, index) => `import package${index} from 'package-${index}';`).join('\n');
    const analysis = analyzeRepository([{ path: 'src/main.ts', content: imports, language: 'TypeScript', size: 0 }], 'external-heavy');
    const graph = createLensGraph(analysis, 'module', false, null, 'all', [], undefined, 5);

    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes.some((node) => node.id === 'module:src')).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.source) && graph.nodes.some((node) => node.id === edge.target))).toBe(true);
  });

  it('caps relationships in a large rendered lens', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => node(`module:${index}`, `src/module-${index}`));
    const analysis = {
      nodes,
      edges: Array.from({ length: 120 }, (_, index) => ({
        id: `edge:${index}`,
        source: `module:${index % nodes.length}`,
        target: `module:${(index * 5 + 1) % nodes.length}`,
        type: 'imports',
        weight: (index % 4) + 1,
        label: 'imports',
      })),
    } as RepositoryAnalysis;
    const graph = createLensGraph(analysis, 'module', false, null, 'all', [], undefined, 5);

    expect(graph.edges.length).toBeLessThanOrEqual(5 * LARGE_MAP_EDGE_LIMIT_PER_NODE);
  });
});
