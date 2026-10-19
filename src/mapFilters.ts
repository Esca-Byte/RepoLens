import type { GraphEdge } from './types';

export type EdgeFilter = 'all' | 'imports' | 'calls' | 'exports';

export const EDGE_FILTER_LABELS: Record<EdgeFilter, string> = {
  all: 'All relationships',
  imports: 'Imports',
  calls: 'Calls',
  exports: 'Exports',
};

export function filterGraphEdges(edges: GraphEdge[], filter: EdgeFilter): GraphEdge[] {
  if (filter === 'all') return edges;
  return edges.filter((edge) => edge.type === filter);
}
