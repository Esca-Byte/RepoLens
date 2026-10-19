export type Language = 'TypeScript' | 'JavaScript' | 'Python' | 'Go' | 'Rust' | 'Java' | 'C#' | 'PHP' | 'Kotlin' | 'Swift' | 'C' | 'C++' | 'JSON' | 'Markdown' | 'Stylesheet' | 'Unknown';

export type NodeKind = 'module' | 'file' | 'external';
export type RelationshipType = 'imports' | 'calls' | 'exports';
export type EntryPointConfidence = 'High' | 'Likely' | 'Possible';

export interface RepositoryFile {
  path: string;
  content: string;
  language: Language;
  size: number;
}

export interface SymbolInfo {
  id: string;
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'constant' | 'method' | 'module';
  filePath: string;
  line: number;
  exported: boolean;
  signature: string;
}

export type SymbolReferenceRole = 'call' | 'read' | 'type' | 'import';

export interface SymbolReference {
  id: string;
  symbolId: string;
  name: string;
  filePath: string;
  line: number;
  role: SymbolReferenceRole;
  context: string;
}

export interface GitCommitSummary {
  hash: string;
  shortHash: string;
  author: string;
  email?: string;
  timestamp?: number;
  subject: string;
}

export interface GitSummary {
  isRepository: boolean;
  branch?: string;
  head?: string;
  remote?: string;
  commits: GitCommitSummary[];
}

export interface ModuleInfo {
  id: string;
  name: string;
  path: string;
  filePaths: string[];
  languages: Language[];
  description: string;
  inbound: number;
  outbound: number;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  path: string;
  moduleId?: string;
  language?: Language;
  description: string;
  fileCount: number;
  inbound: number;
  outbound: number;
  score: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  weight: number;
  label: string;
  sourcePath?: string;
  targetPath?: string;
}

export interface EntryPoint {
  id: string;
  name: string;
  path: string;
  type: string;
  confidence: EntryPointConfidence;
  score: number;
  reasons: string[];
  nodeId: string;
}

export interface RepositorySummary {
  headline: string;
  paragraphs: string[];
  startHere: string[];
  boundaries: string[];
  hotspots: string[];
}

export interface RepositoryAnalysis {
  name: string;
  files: RepositoryFile[];
  symbols: SymbolInfo[];
  references: SymbolReference[];
  git?: GitSummary;
  modules: ModuleInfo[];
  nodes: GraphNode[];
  fileNodes: GraphNode[];
  edges: GraphEdge[];
  fileEdges: GraphEdge[];
  entryPoints: EntryPoint[];
  languages: { name: Language; count: number }[];
  summary: RepositorySummary;
  metrics: {
    files: number;
    modules: number;
    symbols: number;
    references: number;
    relationships: number;
    externalDependencies: number;
  };
}
