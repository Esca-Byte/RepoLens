import type { GraphEdge, GraphNode, RepositoryAnalysis, RepositoryFile } from './types';

export type SnapshotChangeKind = 'added' | 'removed' | 'changed';
export type SnapshotChangeCategory = 'node' | 'file' | 'edge';

export interface SnapshotChange {
  id: string;
  kind: SnapshotChangeKind;
  category: SnapshotChangeCategory;
  label: string;
  detail: string;
}

export interface SnapshotDiff {
  addedNodes: SnapshotChange[];
  removedNodes: SnapshotChange[];
  changedNodes: SnapshotChange[];
  addedFiles: SnapshotChange[];
  removedFiles: SnapshotChange[];
  changedFiles: SnapshotChange[];
  addedEdges: SnapshotChange[];
  removedEdges: SnapshotChange[];
  changedEdges: SnapshotChange[];
  total: number;
  hasChanges: boolean;
}

function allNodes(analysis: RepositoryAnalysis): GraphNode[] {
  return [...analysis.nodes, ...analysis.fileNodes];
}

function nodeSignature(node: GraphNode): string {
  return [node.label, node.kind, node.path, node.moduleId ?? '', node.fileCount, node.inbound, node.outbound, node.score].join('|');
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.source}->${edge.target}:${edge.type}`;
}

function edgeSignature(edge: GraphEdge): string {
  return `${edgeKey(edge)}:${edge.weight}:${edge.label}`;
}

function nodeChange(node: GraphNode, kind: SnapshotChangeKind, detail: string): SnapshotChange {
  return { id: node.id, kind, category: 'node', label: node.label, detail };
}

function fileChange(file: RepositoryFile, kind: SnapshotChangeKind, detail: string): SnapshotChange {
  return { id: `file:${file.path}`, kind, category: 'file', label: file.path, detail };
}

function edgeChange(edge: GraphEdge, kind: SnapshotChangeKind, detail: string): SnapshotChange {
  return { id: edgeKey(edge), kind, category: 'edge', label: `${edge.source} → ${edge.target}`, detail };
}

function compareNodes(previous: RepositoryAnalysis, current: RepositoryAnalysis) {
  const before = new Map(allNodes(previous).map((node) => [node.id, node]));
  const after = new Map(allNodes(current).map((node) => [node.id, node]));
  const addedNodes: SnapshotChange[] = [];
  const removedNodes: SnapshotChange[] = [];
  const changedNodes: SnapshotChange[] = [];

  after.forEach((node, id) => {
    const oldNode = before.get(id);
    if (!oldNode) addedNodes.push(nodeChange(node, 'added', 'New structural node'));
    else if (nodeSignature(oldNode) !== nodeSignature(node)) changedNodes.push(nodeChange(node, 'changed', 'Metadata or relationship counts changed'));
  });
  before.forEach((node, id) => {
    if (!after.has(id)) removedNodes.push(nodeChange(node, 'removed', 'Node no longer exists in the snapshot'));
  });
  return { addedNodes, removedNodes, changedNodes };
}

function compareFiles(previous: RepositoryAnalysis, current: RepositoryAnalysis) {
  const before = new Map(previous.files.map((file) => [file.path, file]));
  const after = new Map(current.files.map((file) => [file.path, file]));
  const addedFiles: SnapshotChange[] = [];
  const removedFiles: SnapshotChange[] = [];
  const changedFiles: SnapshotChange[] = [];

  after.forEach((file, path) => {
    const oldFile = before.get(path);
    if (!oldFile) addedFiles.push(fileChange(file, 'added', 'New source file'));
    else if (oldFile.content !== file.content || oldFile.language !== file.language) changedFiles.push(fileChange(file, 'changed', 'Source content or language changed'));
  });
  before.forEach((file, path) => {
    if (!after.has(path)) removedFiles.push(fileChange(file, 'removed', 'Source file no longer exists'));
  });
  return { addedFiles, removedFiles, changedFiles };
}

function compareEdges(previous: RepositoryAnalysis, current: RepositoryAnalysis) {
  const before = new Map([...previous.edges, ...previous.fileEdges].map((edge) => [edgeKey(edge), edge]));
  const after = new Map([...current.edges, ...current.fileEdges].map((edge) => [edgeKey(edge), edge]));
  const addedEdges: SnapshotChange[] = [];
  const removedEdges: SnapshotChange[] = [];
  const changedEdges: SnapshotChange[] = [];

  after.forEach((edge, key) => {
    const oldEdge = before.get(key);
    if (!oldEdge) addedEdges.push(edgeChange(edge, 'added', 'New relationship'));
    else if (edgeSignature(oldEdge) !== edgeSignature(edge)) changedEdges.push(edgeChange(edge, 'changed', 'Relationship weight changed'));
  });
  before.forEach((edge, key) => {
    if (!after.has(key)) removedEdges.push(edgeChange(edge, 'removed', 'Relationship no longer exists'));
  });
  return { addedEdges, removedEdges, changedEdges };
}

export function compareAnalyses(previous: RepositoryAnalysis, current: RepositoryAnalysis): SnapshotDiff {
  const diff = {
    ...compareNodes(previous, current),
    ...compareFiles(previous, current),
    ...compareEdges(previous, current),
  };
  const total = Object.values(diff).reduce((count, changes) => count + (Array.isArray(changes) ? changes.length : 0), 0);
  return { ...diff, total, hasChanges: total > 0 };
}
