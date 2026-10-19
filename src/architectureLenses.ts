import type { GraphEdge, GraphNode, RepositoryAnalysis } from './types';

export type ArchitectureGranularity = 'module' | 'domain' | 'api' | 'function' | 'sequence' | 'file';

/**
 * Returns the stable architectural domain for a module path. Source folders
 * use their first folder below `src`; other repositories use their first path
 * segment. This keeps the lens deterministic without requiring a framework
 * specific classifier.
 */
export function domainKeyForPath(path: string): string {
  const segments = path.replaceAll('\\', '/').split('/').filter(Boolean);
  if (!segments.length || segments[0] === 'root') return 'root';
  if (segments[0] === 'src') return segments[1] ?? 'root';
  return segments[0];
}

function domainLabel(key: string): string {
  if (key === 'root') return 'Root';
  return key
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function domainNodeId(key: string): string {
  return `domain:${key}`;
}

function aggregateEdge(edges: Map<string, GraphEdge>, source: string, target: string, weight: number): void {
  if (source === target) return;
  const id = `domain-edge:${source}->${target}`;
  const existing = edges.get(id);
  if (existing) {
    existing.weight += weight;
    return;
  }
  edges.set(id, {
    id,
    source,
    target,
    type: 'imports',
    weight,
    label: 'imports',
  });
}

/**
 * Collapse module relationships into a stable domain graph while preserving
 * external package boundaries. Domain nodes intentionally retain the module
 * graph's `module` kind so existing inspectors and color semantics continue
 * to work for repositories that do not opt into the lens explicitly.
 */
export function createDomainGraph(analysis: RepositoryAnalysis): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const moduleNodes = analysis.nodes.filter((node) => node.kind === 'module');
  const externalNodes = analysis.nodes.filter((node) => node.kind === 'external');
  const moduleDomain = new Map<string, string>();
  const domainMembers = new Map<string, GraphNode[]>();

  moduleNodes.forEach((node) => {
    const key = domainKeyForPath(node.path);
    const id = domainNodeId(key);
    moduleDomain.set(node.id, id);
    const members = domainMembers.get(id) ?? [];
    members.push(node);
    domainMembers.set(id, members);
  });

  const edges = new Map<string, GraphEdge>();
  analysis.edges.forEach((edge) => {
    const source = moduleDomain.get(edge.source) ?? edge.source;
    const target = moduleDomain.get(edge.target) ?? edge.target;
    aggregateEdge(edges, source, target, edge.weight);
  });

  const domainNodes = [...domainMembers.entries()].map(([id, members]) => {
    const key = id.slice('domain:'.length);
    const fileCount = members.reduce((count, node) => count + node.fileCount, 0);
    return {
      id,
      label: domainLabel(key),
      kind: 'module' as const,
      path: key,
      description: `Domain spanning ${members.length} module${members.length === 1 ? '' : 's'} and ${fileCount} file${fileCount === 1 ? '' : 's'}.`,
      fileCount,
      inbound: 0,
      outbound: 0,
      score: 0,
    };
  });

  const nodes = [...domainNodes, ...externalNodes.map((node) => ({ ...node }))];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (source) source.outbound += edge.weight;
    if (target) target.inbound += edge.weight;
  });
  nodes.forEach((node) => {
    node.score = node.inbound * 2 + node.outbound;
  });

  return { nodes, edges: [...edges.values()] };
}

function symbolNodeId(prefix: 'api' | 'function', symbolId: string): string {
  return `${prefix}:${symbolId}`;
}

function addLensEdge(edges: Map<string, GraphEdge>, edge: GraphEdge): void {
  const existing = edges.get(edge.id);
  if (existing) {
    existing.weight += edge.weight;
    return;
  }
  edges.set(edge.id, edge);
}

/**
 * Builds a mixed module/symbol graph for an architecture surface. The public
 * API lens passes exported symbols; the function lens passes function symbols.
 * Module nodes remain as context so a reader can follow a symbol back to its
 * owning boundary.
 */
function createSymbolGraph(
  analysis: RepositoryAnalysis,
  symbols: RepositoryAnalysis['symbols'],
  prefix: 'api' | 'function',
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const moduleByFile = new Map<string, string>();
  analysis.modules.forEach((module) => module.filePaths.forEach((path) => moduleByFile.set(path, `module:${module.id}`)));

  const owningModules = new Set<string>();
  const symbolNodes = symbols.map((symbol) => {
    const moduleId = moduleByFile.get(symbol.filePath);
    if (moduleId) owningModules.add(moduleId);
    return {
      id: symbolNodeId(prefix, symbol.id),
      label: symbol.name,
      kind: 'file' as const,
      path: symbol.filePath,
      language: analysis.files.find((file) => file.path === symbol.filePath)?.language,
      description: `${symbol.type} exported from ${symbol.filePath} at line ${symbol.line}.`,
      fileCount: 1,
      inbound: 0,
      outbound: 0,
      score: symbol.exported ? 2 : 1,
    };
  });

  const contextModuleIds = new Set(owningModules);
  const contextExternalIds = new Set<string>();
  analysis.edges.forEach((edge) => {
    if (owningModules.has(edge.source) && edge.target.startsWith('external:')) contextExternalIds.add(edge.target);
    if (owningModules.has(edge.target) && edge.source.startsWith('external:')) contextExternalIds.add(edge.source);
  });

  const contextModules = analysis.nodes
    .filter((node) => contextModuleIds.has(node.id))
    .map((node) => ({ ...node }));
  const contextExternal = analysis.nodes
    .filter((node) => contextExternalIds.has(node.id))
    .map((node) => ({ ...node }));
  const nodes = [...contextModules, ...symbolNodes, ...contextExternal];
  const edges = new Map<string, GraphEdge>();

  symbols.forEach((symbol) => {
    const moduleId = moduleByFile.get(symbol.filePath);
    if (!moduleId) return;
    addLensEdge(edges, {
      id: `${prefix}-owner:${moduleId}->${symbolNodeId(prefix, symbol.id)}`,
      source: moduleId,
      target: symbolNodeId(prefix, symbol.id),
      type: 'exports',
      weight: 1,
      label: 'exports',
      sourcePath: symbol.filePath,
      targetPath: symbol.filePath,
    });
  });

  analysis.edges.forEach((edge) => {
    const sourceVisible = contextModuleIds.has(edge.source) || contextExternalIds.has(edge.source);
    const targetVisible = contextModuleIds.has(edge.target) || contextExternalIds.has(edge.target);
    if (!sourceVisible || !targetVisible) return;
    addLensEdge(edges, { ...edge, id: `api-context:${edge.source}->${edge.target}` });
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  edges.forEach((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (source) source.outbound += edge.weight;
    if (target) target.inbound += edge.weight;
  });
  nodes.forEach((node) => {
    node.score = node.inbound * 2 + node.outbound;
  });

  return { nodes, edges: [...edges.values()] };
}

export function createApiGraph(analysis: RepositoryAnalysis): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return createSymbolGraph(analysis, analysis.symbols.filter((symbol) => symbol.exported), 'api');
}

export function createFunctionGraph(analysis: RepositoryAnalysis): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return createSymbolGraph(analysis, analysis.symbols.filter((symbol) => symbol.type === 'function' || symbol.type === 'method'), 'function');
}

function sequenceRootId(analysis: RepositoryAnalysis, selectedId: string | null): string | undefined {
  const fileIds = new Set(analysis.fileNodes.filter((node) => node.kind === 'file').map((node) => node.id));
  if (selectedId && fileIds.has(selectedId)) return selectedId;
  if (selectedId?.startsWith('module:')) {
    const module = analysis.modules.find((candidate) => `module:${candidate.id}` === selectedId);
    const moduleFile = module?.filePaths.map((path) => `file:${path}`).find((id) => fileIds.has(id));
    if (moduleFile) return moduleFile;
  }
  const entry = analysis.entryPoints[0]?.nodeId;
  if (entry && fileIds.has(entry)) return entry;
  return analysis.fileNodes.find((node) => node.kind === 'file')?.id;
}

/**
 * Follows local imports outward from the selected file or strongest entry
 * point. The bounded traversal keeps the sequence lens readable on large
 * repositories while preserving the original file relationship metadata.
 */
export function createSequenceGraph(analysis: RepositoryAnalysis, selectedId: string | null): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const rootId = sequenceRootId(analysis, selectedId);
  if (!rootId) return { nodes: [], edges: [] };

  const outgoing = new Map<string, GraphEdge[]>();
  analysis.fileEdges.forEach((edge) => {
    const edges = outgoing.get(edge.source) ?? [];
    edges.push(edge);
    outgoing.set(edge.source, edges);
  });

  const visited = new Set<string>([rootId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 0 }];
  while (queue.length && visited.size < 28) {
    const current = queue.shift();
    if (!current || current.depth >= 5) continue;
    (outgoing.get(current.id) ?? []).forEach((edge) => {
      if (visited.size >= 28 || visited.has(edge.target)) return;
      visited.add(edge.target);
      queue.push({ id: edge.target, depth: current.depth + 1 });
    });
  }

  return {
    nodes: analysis.fileNodes.filter((node) => node.kind === 'file' && visited.has(node.id)),
    edges: analysis.fileEdges.filter((edge) => visited.has(edge.source) && visited.has(edge.target)),
  };
}
