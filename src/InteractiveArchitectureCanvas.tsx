import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType, type MouseEvent } from 'react';
import * as Flow from '@xyflow/react';
import { useEdgesState, useNodesState, useReactFlow } from '@xyflow/react';
import type { Edge, Node, NodeProps, OnSelectionChangeParams } from '@xyflow/react';
import type { GraphEdge, GraphNode, RepositoryAnalysis } from './types';
import { createApiGraph, createDomainGraph, createFunctionGraph, createSequenceGraph, type ArchitectureGranularity } from './architectureLenses';
import {
  clearCanvasLayout,
  canvasLayoutKey,
  createCanvasLayout,
  createCanvasLayoutHistory,
  loadCanvasLayout,
  recordCanvasLayout,
  reconcileCanvasLayout,
  redoCanvasLayout,
  saveCanvasLayout,
  undoCanvasLayout,
  type CanvasLayoutMode,
  type CanvasLayoutHistory,
  type CanvasLayoutState,
  type CanvasPoint,
} from './canvasLayout';
import { filterGraphEdges, type EdgeFilter } from './mapFilters';
import { createLensGraph, edgeIdsForPath, type FeatureGraph } from './mapFeatures';
import { downloadSvgAsPng, downloadTextFile, mapAsJson, mapAsSvg } from './mapExport';
import type { SnapshotChangeKind } from './snapshotDiff';
import type { MapAnnotation } from './annotations';
import BrandIcon from './BrandIcon';

type Granularity = ArchitectureGranularity;

interface CanvasNodeData extends Record<string, unknown> {
  graphNode: GraphNode;
  locked: boolean;
  compact: boolean;
  dense: boolean;
  connected: boolean;
  pathActive: boolean;
  searchMatch: boolean;
  snapshotKind?: SnapshotChangeKind;
  annotation?: MapAnnotation;
}

type CanvasFlowNode = Node<CanvasNodeData, 'atlas'>;

const ReactFlowCanvas = Flow.ReactFlow as unknown as ComponentType<any>;
const BackgroundCanvas = Flow.Background as unknown as ComponentType<any>;
const ControlsCanvas = Flow.Controls as unknown as ComponentType<any>;
const HandleCanvas = Flow.Handle as unknown as ComponentType<any>;
const MiniMapCanvas = Flow.MiniMap as unknown as ComponentType<any>;
const FlowProvider = Flow.ReactFlowProvider;
const EMPTY_GROUPS: string[] = [];
const EMPTY_CHANGE_MAP: Record<string, SnapshotChangeKind> = {};
const EMPTY_ANNOTATIONS: MapAnnotation[] = [];

interface InteractiveArchitectureCanvasProps {
  analysis: RepositoryAnalysis;
  graph?: FeatureGraph;
  granularity: Granularity;
  selectedId: string | null;
  focusMode: boolean;
  compact?: boolean;
  edgeFilter?: EdgeFilter;
  nodeQuery?: string;
  highlightedPath?: string[] | null;
  collapsedGroups?: string[];
  snapshotNodeChanges?: Record<string, SnapshotChangeKind>;
  snapshotEdgeChanges?: Record<string, SnapshotChangeKind>;
  includedNodeIds?: string[];
  nodeLimit?: number;
  annotations?: MapAnnotation[];
  fullScreen?: boolean;
  showMinimap?: boolean;
  onToggleMinimap?: () => void;
  onSelect: (id: string) => void;
}

function nodeColor(node: GraphNode): string {
  if (node.kind === 'external') return '#f6b86a';
  if (node.id.startsWith('api:')) return '#6fd4c3';
  if (node.id.startsWith('function:')) return '#73d6ab';
  if (node.kind === 'file') return '#70a9ff';
  if (node.id.startsWith('domain:')) return '#ad91ff';
  if (node.score >= 8) return '#ad91ff';
  return '#7185dc';
}

function shortLabel(label: string, max = 25): string {
  return label.length <= max ? label : `…${label.slice(label.length - max + 1)}`;
}

function shortPath(path: string, max = 28): string {
  return path.length <= max ? path : `…${path.slice(path.length - max + 1)}`;
}

const AtlasNode = memo(function AtlasNode({ data, selected }: NodeProps<CanvasFlowNode>) {
  const { graphNode, locked, compact, dense, connected, pathActive, searchMatch, snapshotKind, annotation } = data;
  const color = nodeColor(graphNode);
  const label = shortLabel(graphNode.label, graphNode.kind === 'external' ? 20 : compact ? 19 : 25);
  const nodeLabel = graphNode.id.startsWith('domain:') ? 'DOMAIN' : graphNode.id.startsWith('api:') ? 'API' : graphNode.id.startsWith('function:') ? 'FUNCTION' : graphNode.kind === 'module' ? 'MODULE' : graphNode.kind === 'external' ? 'EXTERNAL' : 'FILE';
  const nodeClass = graphNode.id.startsWith('domain:') ? 'domain' : graphNode.id.startsWith('api:') ? 'api' : graphNode.id.startsWith('function:') ? 'function' : graphNode.kind;
  return (
    <div
      className={`atlas-flow-node atlas-flow-node-${nodeClass} ${selected ? 'atlas-flow-node-selected' : ''} ${locked ? 'atlas-flow-node-locked' : ''} ${connected ? '' : 'atlas-flow-node-dimmed'} ${searchMatch ? '' : 'atlas-flow-node-search-dimmed'} ${pathActive ? 'atlas-flow-node-path' : ''} ${snapshotKind ? `atlas-flow-node-diff-${snapshotKind}` : ''}`}
      style={{ '--atlas-node-color': color } as CSSProperties}
       title={annotation ? `Annotation: ${annotation.text}` : locked ? 'Locked node — unlock it to move' : 'Drag to move this node'}
      aria-label={`${nodeLabel}: ${graphNode.label}`}
    >
      {dense
        ? <HandleCanvas type="target" position={Flow.Position.Left} className="atlas-handle" />
        : <>
          <HandleCanvas type="target" position={Flow.Position.Left} id="target-left" className="atlas-handle" />
          <HandleCanvas type="target" position={Flow.Position.Right} id="target-right" className="atlas-handle" />
          <HandleCanvas type="target" position={Flow.Position.Top} id="target-top" className="atlas-handle" />
          <HandleCanvas type="target" position={Flow.Position.Bottom} id="target-bottom" className="atlas-handle" />
        </>}
      <div className="atlas-flow-accent" />
      <div className="atlas-flow-kind">
        {nodeLabel}
        {locked && <span className="atlas-lock-mark" aria-label="Locked">⌑</span>}
        {annotation && <span className={`atlas-annotation-mark atlas-annotation-${annotation.color}`} aria-label="Annotated">●</span>}
      </div>
      <div className="atlas-flow-label">{label}</div>
      <div className="atlas-flow-path" title={graphNode.path}>{shortPath(graphNode.path, compact ? 21 : 28)}</div>
      <div className="atlas-flow-meta">
        {graphNode.kind !== 'external' && graphNode.fileCount > 0 && <span>{graphNode.fileCount} {graphNode.fileCount === 1 ? 'file' : 'files'}</span>}
        <span>{graphNode.inbound + graphNode.outbound} links</span>
      </div>
      {dense
        ? <HandleCanvas type="source" position={Flow.Position.Right} className="atlas-handle" />
        : <>
          <HandleCanvas type="source" position={Flow.Position.Left} id="source-left" className="atlas-handle" />
          <HandleCanvas type="source" position={Flow.Position.Right} id="source-right" className="atlas-handle" />
          <HandleCanvas type="source" position={Flow.Position.Top} id="source-top" className="atlas-handle" />
          <HandleCanvas type="source" position={Flow.Position.Bottom} id="source-bottom" className="atlas-handle" />
        </>}
    </div>
  );
});

const nodeTypes = { atlas: AtlasNode };

function layoutKey(analysis: RepositoryAnalysis, granularity: Granularity, selectedId: string | null, nodeLimit?: number): string {
  const domainGraph = granularity === 'domain' ? createDomainGraph(analysis) : undefined;
  const apiGraph = granularity === 'api' ? createApiGraph(analysis) : undefined;
  const functionGraph = granularity === 'function' ? createFunctionGraph(analysis) : undefined;
  const sequenceGraph = granularity === 'sequence' ? createSequenceGraph(analysis, selectedId) : undefined;
  const ids = granularity === 'module'
    ? analysis.nodes.map((node) => node.id)
    : granularity === 'domain'
      ? domainGraph?.nodes.map((node) => node.id) ?? []
      : granularity === 'api'
        ? apiGraph?.nodes.map((node) => node.id) ?? []
        : granularity === 'function'
          ? functionGraph?.nodes.map((node) => node.id) ?? []
        : granularity === 'sequence'
          ? sequenceGraph?.nodes.map((node) => node.id) ?? []
        : analysis.fileNodes.filter((node) => node.kind === 'file').sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound) || a.path.localeCompare(b.path)).slice(0, nodeLimit ?? 48).map((node) => node.id);
  return canvasLayoutKey(analysis.name, granularity, ids, selectedId);
}

function createFlowNodes(graphNodes: GraphNode[], layout: CanvasLayoutState, compact: boolean, dense = false): CanvasFlowNode[] {
  return graphNodes.map((graphNode) => ({
    id: graphNode.id,
    type: 'atlas',
    ...flowNodeDimensions(graphNode),
    position: layout.positions[graphNode.id] ?? { x: 40, y: 40 },
    draggable: !layout.locked.includes(graphNode.id),
    selectable: true,
    data: { graphNode, locked: layout.locked.includes(graphNode.id), compact, dense, connected: true, pathActive: false, searchMatch: true },
  }));
}

function flowNodeDimensions(graphNode: GraphNode): { width: number; height: number } {
  if (graphNode.kind === 'external') return { width: 154, height: 72 };
  if (graphNode.id.startsWith('domain:')) return { width: 202, height: 100 };
  if (graphNode.id.startsWith('api:')) return { width: 182, height: 88 };
  if (graphNode.id.startsWith('function:')) return { width: 176, height: 88 };
  if (graphNode.kind === 'file') return { width: 176, height: 88 };
  return { width: 190, height: 96 };
}

function connectionHandles(source: CanvasFlowNode | undefined, target: CanvasFlowNode | undefined): { sourceHandle?: string; targetHandle?: string } {
  if (!source || !target) return {};
  const sourceWidth = source.width ?? 190;
  const sourceHeight = source.height ?? 96;
  const targetWidth = target.width ?? 190;
  const targetHeight = target.height ?? 96;
  const sourceCenter = { x: source.position.x + sourceWidth / 2, y: source.position.y + sourceHeight / 2 };
  const targetCenter = { x: target.position.x + targetWidth / 2, y: target.position.y + targetHeight / 2 };
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? { sourceHandle: 'source-right', targetHandle: 'target-left' }
      : { sourceHandle: 'source-left', targetHandle: 'target-right' };
  }
  return deltaY >= 0
    ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
    : { sourceHandle: 'source-top', targetHandle: 'target-bottom' };
}

function createFlowEdges(graphEdges: GraphEdge[], selectedId: string | null, positionedNodes: CanvasFlowNode[] = [], pathEdgeIds = new Set<string>(), snapshotEdgeChanges: Record<string, SnapshotChangeKind> = {}, dense = false): Edge[] {
  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  return graphEdges.map((graphEdge) => {
    const active = Boolean(selectedId && (graphEdge.source === selectedId || graphEdge.target === selectedId));
    const pathActive = pathEdgeIds.has(graphEdge.id);
    const snapshotKind = snapshotEdgeChanges[graphEdge.id] ?? snapshotEdgeChanges[`${graphEdge.source}->${graphEdge.target}:${graphEdge.type}`];
    const baseColor = graphEdge.type === 'exports' ? '#6fd4c3' : '#59657e';
    const activeColor = graphEdge.type === 'exports' ? '#8ce9d8' : '#83adff';
    const snapshotColor = snapshotKind === 'added' ? '#73d6ab' : snapshotKind === 'removed' ? '#f28e9c' : '#f6b86a';
    return {
      id: graphEdge.id,
      source: graphEdge.source,
      target: graphEdge.target,
      ...(dense ? {} : connectionHandles(nodeById.get(graphEdge.source), nodeById.get(graphEdge.target))),
      type: dense ? 'straight' : 'smoothstep',
      label: dense || graphEdge.weight <= 1 ? undefined : `${graphEdge.weight}×`,
       markerEnd: dense ? undefined : { type: Flow.MarkerType.ArrowClosed, color: pathActive ? '#f6b86a' : snapshotKind ? snapshotColor : active ? activeColor : baseColor },
       animated: !dense && (active || pathActive),
       style: {
        stroke: pathActive ? '#f6b86a' : snapshotKind ? snapshotColor : active ? activeColor : baseColor,
        strokeWidth: pathActive ? 3 : active ? 2.4 : snapshotKind ? 2 : 1.3,
        opacity: pathActive || active || snapshotKind ? 1 : .62,
      },
       labelStyle: dense ? undefined : { fill: '#a0acc4', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' },
       labelBgStyle: dense ? undefined : { fill: '#101626', fillOpacity: .92 },
    };
  });
}

function CanvasToolbar({
  mode,
  selectedCount,
  selectedLocked,
  onModeChange,
  onAutoLayout,
  onToggleLock,
  onReset,
  onToggleLasso,
  onFitView,
  onFocusSelected,
  onToggleMinimap,
  onExportJson,
  onExportSvg,
  onExportPng,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  lasso,
  showMinimap,
  compact,
}: {
  mode: CanvasLayoutMode;
  selectedCount: number;
  selectedLocked: boolean;
  onModeChange: (mode: CanvasLayoutMode) => void;
  onAutoLayout: () => void;
  onToggleLock: () => void;
  onReset: () => void;
  onToggleLasso: () => void;
  onFitView: () => void;
  onFocusSelected: () => void;
  onToggleMinimap: () => void;
  onExportJson: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  lasso: boolean;
  showMinimap: boolean;
  compact: boolean;
}) {
  if (compact) return null;
  return (
    <div className="canvas-control-bar" role="toolbar" aria-label="Canvas controls">
      <div className="canvas-mode-toggle" role="group" aria-label="Layout mode">
        <button className={mode === 'generated' ? 'active' : ''} aria-pressed={mode === 'generated'} onClick={() => onModeChange('generated')}>Automatic layout</button>
        <button className={mode === 'curated' ? 'active' : ''} aria-pressed={mode === 'curated'} onClick={() => onModeChange('curated')}>Saved positions</button>
      </div>
      <span className="canvas-control-divider" />
      <button onClick={onUndo} disabled={!canUndo} aria-label="Undo layout change" aria-keyshortcuts="Control+Z Meta+Z" title="Undo layout change">Undo <span>↶</span></button>
      <button onClick={onRedo} disabled={!canRedo} aria-label="Redo layout change" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z" title="Redo layout change">Redo <span>↷</span></button>
      <span className="canvas-control-divider" />
      <button className={lasso ? 'canvas-control-active' : ''} aria-pressed={lasso} onClick={onToggleLasso}>{lasso ? 'Multi-select on' : 'Select multiple'} <span>⌁</span></button>
      <button onClick={onAutoLayout}>Arrange nodes <BrandIcon className="toolbar-brand-icon" /></button>
      <button onClick={onFitView}>Fit map <span>⌗</span></button>
      <button onClick={onFocusSelected} disabled={!selectedCount}>Focus selected <span>◎</span></button>
      <button onClick={onToggleMinimap} aria-pressed={showMinimap}>{showMinimap ? 'Hide minimap' : 'Show minimap'} <span>▦</span></button>
      <button onClick={onExportJson}>Export JSON <span>↓</span></button>
      <button onClick={onExportSvg}>Export SVG <span>↓</span></button>
      <button onClick={onExportPng}>Export PNG <span>↓</span></button>
      <button onClick={onToggleLock} disabled={!selectedCount}>{selectedLocked ? 'Unlock selected' : 'Lock selected'} <span>⌑</span></button>
      <button onClick={onReset}>Reset layout <span>⟲</span></button>
      {selectedCount > 0 && <span className="canvas-selection-count">{selectedCount} selected</span>}
    </div>
  );
}

function InteractiveArchitectureCanvasInner({
  analysis,
  graph: providedGraph,
  granularity,
  selectedId,
  focusMode,
  compact = false,
  edgeFilter = 'all',
  nodeQuery = '',
  highlightedPath = null,
  collapsedGroups = EMPTY_GROUPS,
  snapshotNodeChanges = EMPTY_CHANGE_MAP,
  snapshotEdgeChanges = EMPTY_CHANGE_MAP,
  annotations = EMPTY_ANNOTATIONS,
  includedNodeIds,
  nodeLimit,
  fullScreen = false,
  showMinimap = true,
  onToggleMinimap = () => undefined,
  onSelect,
}: InteractiveArchitectureCanvasProps) {
  const graphSelectionId = focusMode || granularity === 'sequence' ? selectedId : null;
  const includedIds = useMemo(() => includedNodeIds ? new Set(includedNodeIds) : undefined, [includedNodeIds]);
  const annotationMap = useMemo(() => new Map(annotations.map((annotation) => [annotation.nodeId, annotation])), [annotations]);
  const graph = useMemo(() => providedGraph ?? createLensGraph(analysis, granularity, focusMode, graphSelectionId, edgeFilter, collapsedGroups, includedIds, nodeLimit), [analysis, collapsedGroups, edgeFilter, focusMode, granularity, graphSelectionId, includedIds, nodeLimit, providedGraph]);
  const denseMap = Boolean(nodeLimit && (graph.nodes.length >= 80 || graph.edges.length >= 280));
  const pathEdgeIds = useMemo(() => new Set(edgeIdsForPath(graph.edges, highlightedPath)), [graph.edges, highlightedPath]);
  const key = useMemo(() => layoutKey(analysis, granularity, selectedId, nodeLimit), [analysis, granularity, nodeLimit, selectedId]);
  const [layout, setLayout] = useState<CanvasLayoutState>(() => loadCanvasLayout(key, graph.nodes));
  const layoutRef = useRef(layout);
  const [layoutHistory, setLayoutHistory] = useState<CanvasLayoutHistory>(() => createCanvasLayoutHistory());
  const layoutHistoryRef = useRef(layoutHistory);
  const [lasso, setLasso] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(selectedId ? [selectedId] : []);
  const initialNodes = useMemo(() => createFlowNodes(graph.nodes, layout, compact, denseMap), [graph.nodes, layout, compact, denseMap]);
  const initialEdges = useMemo(() => createFlowEdges(graph.edges, selectedId, initialNodes, pathEdgeIds, snapshotEdgeChanges, denseMap), [denseMap, graph.edges, initialNodes, pathEdgeIds, selectedId, snapshotEdgeChanges]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { fitView } = useReactFlow();

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    layoutHistoryRef.current = layoutHistory;
  }, [layoutHistory]);

  useEffect(() => {
    const empty = createCanvasLayoutHistory();
    layoutHistoryRef.current = empty;
    setLayoutHistory(empty);
  }, [key]);

  useEffect(() => {
    const next = reconcileCanvasLayout(loadCanvasLayout(key, graph.nodes), graph.nodes);
    setLayout(next);
    setNodes(createFlowNodes(graph.nodes, next, compact, denseMap));
    setEdges(createFlowEdges(graph.edges, null, createFlowNodes(graph.nodes, next, compact, denseMap), pathEdgeIds, snapshotEdgeChanges, denseMap));
  }, [compact, denseMap, graph.edges, graph.nodes, key, pathEdgeIds, setEdges, setNodes, snapshotEdgeChanges]);

  useEffect(() => {
    setSelectedIds(selectedId && graph.nodes.some((node) => node.id === selectedId) ? [selectedId] : []);
  }, [graph.nodes, selectedId]);

  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const shouldBeSelected = node.id === selectedId;
        if (node.selected === shouldBeSelected) return node;
        changed = true;
        return { ...node, selected: shouldBeSelected };
      });
      return changed ? next : current;
    });
    setEdges(createFlowEdges(graph.edges, selectedId, createFlowNodes(graph.nodes, layout, compact, denseMap), pathEdgeIds, snapshotEdgeChanges, denseMap));
  }, [compact, denseMap, graph.edges, graph.nodes, layout, pathEdgeIds, selectedId, setEdges, setNodes, snapshotEdgeChanges]);

  useEffect(() => {
    const connectedIds = selectedId ? new Set([selectedId, ...graph.edges.flatMap((edge) => edge.source === selectedId ? [edge.target] : edge.target === selectedId ? [edge.source] : [])]) : new Set(graph.nodes.map((node) => node.id));
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const connected = !selectedId || connectedIds.has(node.id);
        if (node.data.connected === connected) return node;
        changed = true;
        return { ...node, data: { ...node.data, connected } };
      });
      return changed ? next : current;
    });
  }, [graph.edges, graph.nodes, selectedId, setNodes]);

  useEffect(() => {
    const query = nodeQuery.trim().toLowerCase();
    const pathIds = new Set(highlightedPath ?? []);
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const searchMatch = !query || `${node.data.graphNode.label} ${node.data.graphNode.path} ${node.data.graphNode.description}`.toLowerCase().includes(query);
        const pathActive = pathIds.has(node.id);
        const snapshotKind = snapshotNodeChanges[node.id];
        if (node.data.searchMatch === searchMatch && node.data.pathActive === pathActive && node.data.snapshotKind === snapshotKind) return node;
        changed = true;
        return { ...node, data: { ...node.data, searchMatch, pathActive, snapshotKind } };
      });
      return changed ? next : current;
    });
  }, [highlightedPath, nodeQuery, setNodes, snapshotNodeChanges]);

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      const nextAnnotation = annotationMap.get(node.id);
      return node.data.annotation === nextAnnotation ? node : { ...node, data: { ...node.data, annotation: nextAnnotation } };
    }));
  }, [annotationMap, setNodes]);

  const persist = useCallback((next: CanvasLayoutState) => {
    const nextHistory = recordCanvasLayout(layoutHistoryRef.current, layoutRef.current, next);
    if (nextHistory === layoutHistoryRef.current) return;
    layoutHistoryRef.current = nextHistory;
    setLayoutHistory(nextHistory);
    layoutRef.current = next;
    setLayout(next);
    saveCanvasLayout(key, next);
  }, [key]);

  const handleSelectionChange = useCallback(({ nodes: selectedNodes }: OnSelectionChangeParams) => {
    const ids = selectedNodes.map((node) => node.id);
    setSelectedIds((current) => current.length === ids.length && current.every((id, index) => id === ids[index]) ? current : ids);
  }, []);

  const selectedLocked = selectedIds.length > 0 && selectedIds.every((id) => layout.locked.includes(id));

  const handleToggleLock = useCallback(() => {
    if (!selectedIds.length) return;
    const locked = new Set(layout.locked);
    if (selectedLocked) selectedIds.forEach((id) => locked.delete(id));
    else selectedIds.forEach((id) => locked.add(id));
    persist({ ...layout, locked: [...locked], mode: 'curated' });
    setNodes((current) => current.map((node) => ({ ...node, draggable: !locked.has(node.id), data: { ...node.data, locked: locked.has(node.id) } })));
  }, [layout, persist, selectedIds, selectedLocked, setNodes]);

  const handleAutoLayout = useCallback(() => {
    const generated = createCanvasLayout(graph.nodes).positions;
    const positions = { ...layout.positions };
    graph.nodes.forEach((node) => {
      if (!layout.locked.includes(node.id)) positions[node.id] = generated[node.id];
    });
    persist({ ...layout, positions, mode: 'generated' });
    setNodes(createFlowNodes(graph.nodes, { ...layout, positions }, compact, denseMap));
  }, [compact, denseMap, graph.nodes, layout, persist, setNodes]);

  const handleFitView = useCallback(() => {
    void fitView({ padding: compact ? .15 : .24, minZoom: compact ? .45 : .35, maxZoom: 1.2, duration: 280 });
  }, [compact, fitView]);

  const handleFocusSelected = useCallback(() => {
    if (!selectedId) return;
    void fitView({ nodes: [{ id: selectedId }], padding: .65, minZoom: .55, maxZoom: 1.6, duration: 280 });
  }, [fitView, selectedId]);

  const handleExportJson = useCallback(() => {
    downloadTextFile(`repolens-${granularity}.json`, mapAsJson(graph.nodes, graph.edges, layout.positions), 'application/json');
  }, [granularity, graph.edges, graph.nodes, layout.positions]);

  const handleExportSvg = useCallback(() => {
    downloadTextFile(`repolens-${granularity}.svg`, mapAsSvg(graph.nodes, graph.edges, layout.positions), 'image/svg+xml');
  }, [granularity, graph.edges, graph.nodes, layout.positions]);

  const handleExportPng = useCallback(() => {
    void downloadSvgAsPng(`repolens-${granularity}.png`, mapAsSvg(graph.nodes, graph.edges, layout.positions));
  }, [granularity, graph.edges, graph.nodes, layout.positions]);

  const handleReset = useCallback(() => {
    const next = createCanvasLayout(graph.nodes);
    clearCanvasLayout(key);
    persist(next);
    setNodes(createFlowNodes(graph.nodes, next, compact, denseMap));
  }, [compact, denseMap, graph.nodes, key, persist, setNodes]);

  const handleUndo = useCallback(() => {
    const result = undoCanvasLayout(layoutHistoryRef.current, layoutRef.current);
    if (!result.layout) return;
    layoutHistoryRef.current = result.history;
    setLayoutHistory(result.history);
    layoutRef.current = result.layout;
    setLayout(result.layout);
    saveCanvasLayout(key, result.layout);
    setNodes(createFlowNodes(graph.nodes, result.layout, compact, denseMap));
  }, [compact, denseMap, graph.nodes, key, setNodes]);

  const handleRedo = useCallback(() => {
    const result = redoCanvasLayout(layoutHistoryRef.current, layoutRef.current);
    if (!result.layout) return;
    layoutHistoryRef.current = result.history;
    setLayoutHistory(result.history);
    layoutRef.current = result.layout;
    setLayout(result.layout);
    saveCanvasLayout(key, result.layout);
    setNodes(createFlowNodes(graph.nodes, result.layout, compact, denseMap));
  }, [compact, denseMap, graph.nodes, key, setNodes]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return;
      event.preventDefault();
      if (event.shiftKey) handleRedo();
      else handleUndo();
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleRedo, handleUndo]);

  const handleModeChange = useCallback((nextMode: CanvasLayoutMode) => {
    if (nextMode === 'generated') handleAutoLayout();
    else persist({ ...layout, mode: 'curated' });
  }, [handleAutoLayout, layout, persist]);

  const handleNodeDragStop = useCallback((_: MouseEvent, node: CanvasFlowNode) => {
    const currentLayout = layoutRef.current;
    if (currentLayout.locked.includes(node.id)) return;
    persist({ ...currentLayout, positions: { ...currentLayout.positions, [node.id]: node.position }, mode: 'curated' });
  }, [persist]);

  const handleChanges = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes.filter((change) => change.type !== 'position' || !layout.locked.includes(change.id)));
  }, [layout.locked, onNodesChange]);

  const flowNodeCount = graph.nodes.length;
  const shellHeight = compact ? 390 : fullScreen ? 'calc(100vh - 250px)' : 572;
  const shellFlex = compact ? '0 0 390px' : fullScreen ? '1 1 auto' : '0 0 572px';
  return (
    <div className={`architecture-canvas interactive-canvas ${compact ? 'canvas-compact' : ''} ${denseMap ? 'interactive-canvas-dense' : ''}`}>
      <CanvasToolbar
        mode={layout.mode}
        selectedCount={selectedIds.length}
        selectedLocked={selectedLocked}
        onModeChange={handleModeChange}
        onAutoLayout={handleAutoLayout}
        onFitView={handleFitView}
        onFocusSelected={handleFocusSelected}
        onToggleMinimap={onToggleMinimap}
        onExportJson={handleExportJson}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={layoutHistory.past.length > 0}
        canRedo={layoutHistory.future.length > 0}
        onToggleLock={handleToggleLock}
        onReset={handleReset}
        onToggleLasso={() => setLasso((value) => !value)}
        lasso={lasso}
        showMinimap={showMinimap}
        compact={compact}
      />
      <div className="react-flow-shell" role="region" aria-label={`${granularity} interactive dependency map`} style={{ height: shellHeight, flex: shellFlex }}>
        <ReactFlowCanvas
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={handleChanges}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_: MouseEvent, node: CanvasFlowNode) => onSelect(node.id)}
          onNodeDragStop={handleNodeDragStop}
          onSelectionChange={handleSelectionChange}
          selectionOnDrag={lasso}
          panOnDrag={!lasso}
          selectionMode="partial"
          fitView
          fitViewOptions={{ padding: compact ? .15 : .24, minZoom: compact ? .45 : .35, maxZoom: 1.2 }}
          nodesDraggable={!compact}
          nodesConnectable={false}
          elementsSelectable
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          {!denseMap && <BackgroundCanvas variant={Flow.BackgroundVariant.Dots} gap={20} size={1} color="rgba(149, 164, 199, .16)" />}
          {!compact && <>{showMinimap && <><MiniMapCanvas className="map-minimap" nodeColor={(node: any) => node.data?.graphNode ? nodeColor(node.data.graphNode as GraphNode) : '#7185dc'} nodeStrokeColor={(node: any) => node.data?.graphNode ? nodeColor(node.data.graphNode as GraphNode) : '#7185dc'} nodeBorderRadius={5} maskColor="rgba(8, 12, 23, .72)" pannable zoomable /><div className="map-minimap-label">Map overview</div></>}<ControlsCanvas showInteractive={false} position="bottom-right" /></>}
        </ReactFlowCanvas>
      </div>
      {!compact && <div className="canvas-key" aria-label="Map legend"><span><i className="legend-swatch legend-module" />Local code</span><span><i className="legend-swatch legend-file" />Files and symbols</span><span><i className="legend-swatch legend-external" />External package</span></div>}
      {!compact && <div className="canvas-status-bar"><span><i className="legend-swatch legend-module" />{flowNodeCount} nodes</span><span><i className="legend-swatch legend-file" />{graph.edges.length} relationships</span><span className="canvas-status-mode">{layout.mode === 'curated' ? 'Saved positions' : 'Automatic layout'}</span></div>}
      {granularity === 'file' && analysis.fileNodes.filter((node) => node.kind === 'file').length > 48 && <div className="canvas-truncation">Showing the 48 most connected files. Narrow the scope from a module to explore more.</div>}
      {granularity === 'api' && !graph.nodes.some((node) => node.id.startsWith('api:')) && <div className="canvas-empty">No exported symbols were detected in this repository.</div>}
      {granularity === 'function' && !graph.nodes.some((node) => node.id.startsWith('function:')) && <div className="canvas-empty">No function symbols were detected in this repository.</div>}
    </div>
  );
}

export default function InteractiveArchitectureCanvas(props: InteractiveArchitectureCanvasProps) {
  return <FlowProvider><InteractiveArchitectureCanvasInner {...props} /></FlowProvider>;
}
