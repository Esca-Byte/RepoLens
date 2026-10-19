import { calculateImpact } from './impactAnalysis';
import type { GraphEdge, GraphNode, RepositoryAnalysis } from './types';

export interface DependencyReport {
  node: GraphNode;
  directDependencies: GraphNode[];
  directDependents: GraphNode[];
  transitiveDependents: GraphNode[];
  relationships: GraphEdge[];
  markdown: string;
}

function graphNode(analysis: RepositoryAnalysis, id: string): GraphNode | undefined {
  return [...analysis.nodes, ...analysis.fileNodes].find((node) => node.id === id);
}

function uniqueNodes(analysis: RepositoryAnalysis, ids: string[]): GraphNode[] {
  return ids.flatMap((id) => {
    const node = graphNode(analysis, id);
    return node ? [node] : [];
  });
}

export function buildDependencyReport(analysis: RepositoryAnalysis, nodeId: string): DependencyReport | undefined {
  const node = graphNode(analysis, nodeId);
  if (!node) return undefined;
  const edges = node.kind === 'file' ? analysis.fileEdges : analysis.edges;
  const directDependencies = uniqueNodes(analysis, edges.filter((edge) => edge.source === nodeId).map((edge) => edge.target));
  const directDependents = uniqueNodes(analysis, edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source));
  const impact = calculateImpact(nodeId, edges);
  const transitiveDependents = uniqueNodes(analysis, impact.dependentIds.filter((id) => !directDependents.some((candidate) => candidate.id === id)));
  const relationships = edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
  const lines = [
    `# Dependency report: ${node.label}`,
    '',
    `- Path: \`${node.path}\``,
    `- Kind: ${node.kind}`,
    `- Direct dependencies: ${directDependencies.length}`,
    `- Direct dependents: ${directDependents.length}`,
    `- Total affected dependents: ${impact.transitiveDependents}`,
    '',
    '## Direct dependencies',
    ...(directDependencies.length ? directDependencies.map((candidate) => `- ${candidate.label} — \`${candidate.path}\``) : ['- None detected']),
    '',
    '## Dependents',
    ...(directDependents.length ? directDependents.map((candidate) => `- ${candidate.label} — \`${candidate.path}\``) : ['- None detected']),
    ...(transitiveDependents.length ? ['', '## Additional affected nodes', ...transitiveDependents.map((candidate) => `- ${candidate.label} — \`${candidate.path}\``)] : []),
  ];
  return { node, directDependencies, directDependents, transitiveDependents, relationships, markdown: lines.join('\n') };
}
