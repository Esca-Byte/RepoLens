import { describe, expect, it } from 'vitest';
import { mapAsJson, mapAsSvg } from './mapExport';
import type { GraphEdge, GraphNode } from './types';

const nodes: GraphNode[] = [
  { id: 'module:api', label: 'API', kind: 'module', path: 'src/api', description: '', fileCount: 1, inbound: 0, outbound: 1, score: 1 },
  { id: 'module:data', label: 'Data', kind: 'module', path: 'src/data', description: '', fileCount: 1, inbound: 1, outbound: 0, score: 1 },
];
const edges: GraphEdge[] = [{ id: 'api-data', source: 'module:api', target: 'module:data', type: 'imports', weight: 1, label: 'imports' }];

describe('map exports', () => {
  it('exports graph data as JSON', () => {
    const value = JSON.parse(mapAsJson(nodes, edges, { 'module:api': { x: 10, y: 20 }, 'module:data': { x: 220, y: 20 } }));
    expect(value.nodes).toHaveLength(2);
    expect(value.edges[0].source).toBe('module:api');
  });

  it('exports a standalone SVG with nodes and arrows', () => {
    const svg = mapAsSvg(nodes, edges, { 'module:api': { x: 10, y: 20 }, 'module:data': { x: 220, y: 20 } });
    expect(svg).toContain('<svg');
    expect(svg).toContain('API');
    expect(svg).toContain('marker-end');
  });
});
