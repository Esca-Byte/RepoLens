import { analyzeHealth, type HealthWarning } from './mapFeatures';
import type { GraphEdge, GraphNode, RepositoryAnalysis } from './types';

export interface HealthDashboard {
  score: number;
  status: 'Healthy' | 'Review' | 'At risk';
  cycles: number;
  hotspots: number;
  isolated: number;
  largeModules: number;
  dependencyDepth: number;
  averageLinks: number;
  topHotspots: GraphNode[];
  warnings: HealthWarning[];
}

function longestDependencyChain(nodes: GraphNode[], edges: GraphEdge[]): number {
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  });
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    if (memo.has(id)) return memo.get(id) ?? 0;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const value = 1 + Math.max(0, ...(outgoing.get(id) ?? []).map(depth));
    visiting.delete(id);
    memo.set(id, value);
    return value;
  };
  return Math.max(0, ...nodes.map((node) => depth(node.id))) - (nodes.length ? 1 : 0);
}

export function buildHealthDashboard(analysis: RepositoryAnalysis): HealthDashboard {
  const warnings = analyzeHealth(analysis);
  const cycles = warnings.filter((warning) => warning.kind === 'cycle').length;
  const hotspots = warnings.filter((warning) => warning.kind === 'hotspot').length;
  const isolated = warnings.filter((warning) => warning.kind === 'isolated').length;
  const largeModules = warnings.filter((warning) => warning.kind === 'large').length;
  const score = Math.max(0, Math.min(100, 100 - cycles * 15 - hotspots * 5 - isolated * 3 - largeModules * 4));
  const status = score >= 80 ? 'Healthy' : score >= 55 ? 'Review' : 'At risk';
  const averageLinks = analysis.nodes.length ? Math.round((analysis.nodes.reduce((total, node) => total + node.inbound + node.outbound, 0) / analysis.nodes.length) * 10) / 10 : 0;
  return {
    score,
    status,
    cycles,
    hotspots,
    isolated,
    largeModules,
    dependencyDepth: longestDependencyChain(analysis.nodes, analysis.edges),
    averageLinks,
    topHotspots: [...analysis.nodes].sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound)).slice(0, 3),
    warnings,
  };
}
