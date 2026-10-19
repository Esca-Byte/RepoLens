import { buildHealthDashboard } from './healthDashboard';
import type { GraphEdge, RepositoryAnalysis } from './types';

function nodeLabel(analysis: RepositoryAnalysis, id: string): string {
  return [...analysis.nodes, ...analysis.fileNodes].find((node) => node.id === id)?.label ?? id;
}

function section(title: string, items: string[]): string[] {
  return [`## ${title}`, ...(items.length ? items.map((item) => `- ${item}`) : ['- None detected']), ''];
}

export function buildArchitectureReport(analysis: RepositoryAnalysis): string {
  const health = buildHealthDashboard(analysis);
  const lines = [
    `# RepoLens architecture report: ${analysis.name}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    analysis.summary.paragraphs.join('\n\n'),
    '',
    '## Metrics',
    `- Files: ${analysis.metrics.files}`,
    `- Modules: ${analysis.metrics.modules}`,
    `- Symbols: ${analysis.metrics.symbols}`,
    `- References: ${analysis.metrics.references}`,
    `- Relationships: ${analysis.metrics.relationships}`,
    `- External dependencies: ${analysis.metrics.externalDependencies}`,
    '',
    '## Health',
    `- Score: ${health.score}/100 (${health.status})`,
    `- Dependency depth: ${health.dependencyDepth}`,
    `- Average module links: ${health.averageLinks}`,
    `- Cycles: ${health.cycles}`,
    `- Hotspots: ${health.hotspots}`,
    `- Isolated modules: ${health.isolated}`,
    `- Large modules: ${health.largeModules}`,
    '',
    ...section('Languages', analysis.languages.map((language) => `${language.name}: ${language.count} files`)),
    ...section('Entry points', analysis.entryPoints.map((entry) => `${entry.name} — \`${entry.path}\` (${entry.confidence}, ${entry.type})`)),
    ...section('Modules', analysis.modules.map((module) => `${module.name} — ${module.filePaths.length} files, ${module.inbound} inbound, ${module.outbound} outbound`)),
    ...section('Relationships', analysis.edges.map((edge: GraphEdge) => `${nodeLabel(analysis, edge.source)} → ${nodeLabel(analysis, edge.target)} (${edge.label}, weight ${edge.weight})`)),
  ];
  const warningLines = health.warnings.map((warning) => `${warning.title} — ${warning.detail}`);
  lines.push(...section('Warnings', warningLines));
  if (analysis.git?.isRepository) {
    lines.push('## Git', `- Branch: ${analysis.git.branch ?? 'Detached HEAD'}`, `- HEAD: ${analysis.git.head ?? 'Unknown'}`, `- Remote: ${analysis.git.remote ?? 'None detected'}`, '', ...section('Recent commits', analysis.git.commits.slice(0, 12).map((commit) => `${commit.shortHash} — ${commit.subject.replace(/^commit:\s*/i, '')} (${commit.author})`)));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function buildArchitectureReportJson(analysis: RepositoryAnalysis): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    repository: analysis.name,
    metrics: analysis.metrics,
    languages: analysis.languages,
    entryPoints: analysis.entryPoints,
    health: buildHealthDashboard(analysis),
    git: analysis.git,
    modules: analysis.modules,
    nodes: analysis.nodes,
    edges: analysis.edges,
    fileEdges: analysis.fileEdges,
  }, null, 2);
}
