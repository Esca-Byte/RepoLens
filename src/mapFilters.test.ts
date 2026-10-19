import { describe, expect, it } from 'vitest';
import { filterGraphEdges } from './mapFilters';
import type { GraphEdge } from './types';

const edges: GraphEdge[] = [
  { id: 'imports:one', source: 'module:one', target: 'module:two', type: 'imports', weight: 1, label: 'imports' },
  { id: 'calls:one', source: 'module:two', target: 'module:three', type: 'calls', weight: 1, label: 'calls' },
  { id: 'exports:one', source: 'module:three', target: 'module:four', type: 'exports', weight: 1, label: 'exports' },
];

describe('map relationship filters', () => {
  it('returns every relationship for the default filter', () => {
    expect(filterGraphEdges(edges, 'all')).toEqual(edges);
  });

  it('returns only relationships of the selected type', () => {
    expect(filterGraphEdges(edges, 'calls').map((edge) => edge.id)).toEqual(['calls:one']);
    expect(filterGraphEdges(edges, 'exports').map((edge) => edge.id)).toEqual(['exports:one']);
  });
});
