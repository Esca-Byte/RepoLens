import type { GraphEdge } from './types';

export interface ImpactSummary {
  directDependents: number;
  transitiveDependents: number;
  dependentIds: string[];
}

/**
 * Follows reverse dependency edges so a selected node can explain which
 * callers or owning boundaries may be affected by a change.
 */
export function calculateImpact(nodeId: string, edges: GraphEdge[]): ImpactSummary {
  const dependents = new Map<string, string[]>();
  edges.forEach((edge) => {
    const incoming = dependents.get(edge.target) ?? [];
    incoming.push(edge.source);
    dependents.set(edge.target, incoming);
  });

  const direct = new Set(dependents.get(nodeId) ?? []);
  const visited = new Set<string>(direct);
  const queue = [...direct];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    (dependents.get(current) ?? []).forEach((dependent) => {
      if (dependent === nodeId || visited.has(dependent)) return;
      visited.add(dependent);
      queue.push(dependent);
    });
  }

  return {
    directDependents: direct.size,
    transitiveDependents: visited.size,
    dependentIds: [...visited],
  };
}
