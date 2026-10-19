import { analyzeHealth } from './mapFeatures';
import type { EntryPoint, GraphNode, RepositoryAnalysis, SymbolInfo } from './types';

export type SearchResultKind = 'file' | 'symbol' | 'entry' | 'module' | 'warning' | 'relationship';

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  kind: SearchResultKind;
  nodeId: string;
  score: number;
}

export type SearchFilter = 'all' | SearchResultKind;

function scoreText(query: string, title: string, subtitle: string, priority: number): number {
  if (!query) return priority;
  const normalizedTitle = title.toLowerCase();
  const haystack = `${title} ${subtitle}`.toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  if (terms.some((term) => !haystack.includes(term))) return -1;
  let score = priority;
  terms.forEach((term) => {
    if (normalizedTitle === term) score += 100;
    else if (normalizedTitle.startsWith(term)) score += 60;
    else if (normalizedTitle.includes(term)) score += 35;
    else score += 10;
  });
  return score;
}

function pushResult(results: SearchResult[], result: Omit<SearchResult, 'score'>, query: string, priority: number): void {
  const score = scoreText(query, result.title, result.subtitle, priority);
  if (score >= 0) results.push({ ...result, score });
}

function nodeLabel(analysis: RepositoryAnalysis, id: string): string {
  return analysis.nodes.find((node) => node.id === id)?.label ?? analysis.fileNodes.find((node) => node.id === id)?.label ?? id;
}

export function buildSearchResults(analysis: RepositoryAnalysis, query = '', filter: SearchFilter = 'all'): SearchResult[] {
  const normalized = query.trim().toLowerCase();
  const results: SearchResult[] = [];
  const include = (kind: SearchResultKind) => filter === 'all' || filter === kind;
  if (include('entry')) analysis.entryPoints.forEach((entry: EntryPoint) => pushResult(results, { id: entry.id, title: entry.name, subtitle: `${entry.path} · ${entry.confidence} confidence`, kind: 'entry', nodeId: entry.nodeId }, normalized, 90));
  if (include('symbol')) analysis.symbols.forEach((symbol: SymbolInfo) => pushResult(results, { id: symbol.id, title: symbol.name, subtitle: `${symbol.type} · ${symbol.filePath}:${symbol.line}`, kind: 'symbol', nodeId: `file:${symbol.filePath}` }, normalized, symbol.exported ? 80 : 65));
  if (include('module')) analysis.nodes.filter((node) => node.kind === 'module').forEach((node: GraphNode) => pushResult(results, { id: node.id, title: node.label, subtitle: `${node.path} · ${node.fileCount} files · ${node.inbound + node.outbound} links`, kind: 'module', nodeId: node.id }, normalized, 70));
  if (include('file')) analysis.files.forEach((file) => pushResult(results, { id: `search:${file.path}`, title: file.path, subtitle: `${file.language} · ${file.size} bytes`, kind: 'file', nodeId: `file:${file.path}` }, normalized, 55));
  if (include('warning')) analyzeHealth(analysis).forEach((warning) => pushResult(results, { id: warning.id, title: warning.title, subtitle: warning.detail, kind: 'warning', nodeId: warning.nodeIds[0] ?? '' }, normalized, warning.severity === 'high' ? 75 : 50));
  if (include('relationship')) analysis.edges.slice(0, 120).forEach((edge) => pushResult(results, { id: edge.id, title: `${nodeLabel(analysis, edge.source)} → ${nodeLabel(analysis, edge.target)}`, subtitle: `${edge.label} · ${edge.weight} link${edge.weight === 1 ? '' : 's'}`, kind: 'relationship', nodeId: edge.source }, normalized, 35));
  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 30);
}
