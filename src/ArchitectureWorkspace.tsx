import { useEffect, useMemo, useState } from 'react';
import InteractiveArchitectureCanvas from './InteractiveArchitectureCanvas';
import { createSequenceGraph, domainKeyForPath, type ArchitectureGranularity } from './architectureLenses';
import { EDGE_FILTER_LABELS, type EdgeFilter } from './mapFilters';
import { analyzeHealth, createLensGraph, edgeIdsForPath, findGraphPath, groupGraphNodes, type FeatureGraph, type HealthWarning, type NodeGroup } from './mapFeatures';
import { deleteMapView, loadSavedMapViews, saveMapView, type SavedMapView } from './savedViews';
import type { MapAnnotation } from './annotations';
import type { SnapshotChangeKind, SnapshotDiff } from './snapshotDiff';
import type { RepositoryAnalysis } from './types';

type Granularity = ArchitectureGranularity;
type ChangeFilter = 'all' | 'changed';
const EDGE_FILTERS: EdgeFilter[] = ['all', 'imports', 'calls', 'exports'];
const GRANULARITIES: Granularity[] = ['module', 'domain', 'api', 'function', 'sequence', 'file'];

interface ArchitectureWorkspaceProps {
  analysis: RepositoryAnalysis;
  selectedId: string | null;
  diff: SnapshotDiff | null;
  onSelect: (id: string) => void;
  changeFilter?: ChangeFilter;
  onChangeFilter?: (filter: ChangeFilter) => void;
  performanceMode?: boolean;
  annotations?: MapAnnotation[];
  onSaveAnnotation?: (annotation: { id?: string; nodeId: string; text: string; color: MapAnnotation['color'] }) => void;
  onDeleteAnnotation?: (id: string) => void;
}

function changeMap(diff: SnapshotDiff | null, category: 'node' | 'edge'): Record<string, SnapshotChangeKind> {
  if (!diff) return {};
  const changes = category === 'node'
    ? [...diff.addedNodes, ...diff.removedNodes, ...diff.changedNodes]
    : [...diff.addedEdges, ...diff.removedEdges, ...diff.changedEdges];
  return Object.fromEntries(changes.map((change) => [change.id, change.kind]));
}

function scopeLabel(granularity: Granularity, analysis: RepositoryAnalysis, nodeCount: number): string {
  if (granularity === 'module') return `${nodeCount} nodes`;
  if (granularity === 'domain') return `${nodeCount} domains`;
  if (granularity === 'api') return `${nodeCount} exports`;
  if (granularity === 'function') return `${nodeCount} functions`;
  if (granularity === 'sequence') return `${createSequenceGraph(analysis, null).nodes.length} steps`;
  return `${nodeCount} files`;
}

function changedGraphIds(analysis: RepositoryAnalysis, graph: FeatureGraph, diff: SnapshotDiff | null): Set<string> {
  if (!diff) return new Set();
  const changedNodes = [...diff.addedNodes, ...diff.changedNodes];
  const changedNodeIds = new Set(changedNodes.map((change) => change.id));
  const changedFiles = new Set([...diff.addedFiles, ...diff.changedFiles].map((change) => change.label));
  const changedDomainKeys = new Set(analysis.modules.filter((module) => module.filePaths.some((path) => changedFiles.has(path))).map((module) => domainKeyForPath(module.path)));
  const changedEdges = new Set([...diff.addedEdges, ...diff.changedEdges].map((change) => change.id));
  const ids = new Set<string>();
  graph.nodes.forEach((node) => {
    const module = node.kind === 'module' ? analysis.modules.find((candidate) => `module:${candidate.id}` === node.id) : undefined;
    const ownsChangedFile = module?.filePaths.some((path) => changedFiles.has(path)) ?? false;
    const isChangedDomain = node.id.startsWith('domain:') && changedDomainKeys.has(node.id.slice('domain:'.length));
    const isChanged = changedNodeIds.has(node.id) || changedFiles.has(node.path) || ownsChangedFile || isChangedDomain;
    if (isChanged) ids.add(node.id);
  });
  graph.edges.forEach((edge) => {
    const key = `${edge.source}->${edge.target}:${edge.type}`;
    if (changedEdges.has(edge.id) || changedEdges.has(key) || ids.has(edge.source) || ids.has(edge.target)) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
  });
  return ids;
}

function HealthPanel({ warnings, onSelect }: { warnings: HealthWarning[]; onSelect: (warning: HealthWarning) => void }) {
  return (
    <section className="map-health-panel" aria-label="Code health warnings">
      <div className="map-health-heading"><div><div className="eyebrow">CODE HEALTH</div><h2>{warnings.length ? `${warnings.length} things to review` : 'No common problems found'}</h2></div><span className="health-count">{warnings.length}</span></div>
      {warnings.length ? <div className="health-list">{warnings.slice(0, 4).map((warning) => <button key={warning.id} className="health-item" onClick={() => onSelect(warning)}><span className={`health-dot health-${warning.severity}`} /><span><strong>{warning.title}</strong><small>{warning.detail}</small></span><span className="health-arrow">→</span></button>)}</div> : <p className="muted">The module graph has no cycles, isolated nodes, or large modules.</p>}
    </section>
  );
}

function GroupPanel({ groups, groupMode, collapsedGroups, onModeChange, onToggle }: { groups: NodeGroup[]; groupMode: 'none' | 'folder'; collapsedGroups: string[]; onModeChange: (mode: 'none' | 'folder') => void; onToggle: (key: string) => void }) {
  return (
    <div className="map-group-panel">
      <div className="map-group-heading"><span className="toolbar-label">Groups</span><select aria-label="Group map nodes" value={groupMode} onChange={(event) => onModeChange(event.target.value as 'none' | 'folder')}><option value="none">No groups</option><option value="folder">By folder</option></select></div>
      {groupMode === 'folder' && <div className="map-group-list">{groups.map((group) => <button key={group.key} className={`map-group-chip ${collapsedGroups.includes(group.key) ? 'collapsed' : ''}`} onClick={() => onToggle(group.key)}><span>{collapsedGroups.includes(group.key) ? '+' : '−'}</span>{group.label}<small>{group.nodeIds.length}</small></button>)}</div>}
    </div>
  );
}

export default function ArchitectureWorkspace({ analysis, selectedId, diff, onSelect, changeFilter = 'all', onChangeFilter, performanceMode = false, annotations = [] }: ArchitectureWorkspaceProps) {
  const [granularity, setGranularity] = useState<Granularity>('module');
  const [focusMode, setFocusMode] = useState(false);
  const [edgeFilter, setEdgeFilter] = useState<EdgeFilter>('all');
  const [mapQuery, setMapQuery] = useState('');
  const [pathStart, setPathStart] = useState('');
  const [pathEnd, setPathEnd] = useState('');
  const [pathIds, setPathIds] = useState<string[] | null>(null);
  const [pathSearched, setPathSearched] = useState(false);
  const [groupMode, setGroupMode] = useState<'none' | 'folder'>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [savedViews, setSavedViews] = useState<SavedMapView[]>(() => loadSavedMapViews());
  const [viewName, setViewName] = useState('');
  const [fullScreen, setFullScreen] = useState(false);
  const [showMinimap, setShowMinimap] = useState(() => !performanceMode);
  const [renderLimit, setRenderLimit] = useState(120);

  useEffect(() => {
    setRenderLimit(120);
  }, [analysis, granularity]);

  useEffect(() => {
    if (performanceMode) setShowMinimap(false);
  }, [performanceMode]);

  useEffect(() => {
    if (!fullScreen) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullScreen(false);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [fullScreen]);

  const fullGraph = useMemo(() => createLensGraph(analysis, granularity, false, selectedId, edgeFilter), [analysis, granularity, selectedId, edgeFilter]);
  const groups = useMemo(() => groupGraphNodes(fullGraph.nodes), [fullGraph.nodes]);
  const changedIds = useMemo(() => changedGraphIds(analysis, fullGraph, diff), [analysis, diff, fullGraph]);
  const effectiveNodeLimit = performanceMode ? renderLimit : undefined;
  const pathEdgeIds = useMemo(() => edgeIdsForPath(fullGraph.edges, pathIds), [fullGraph.edges, pathIds]);
  const visibleGraph = useMemo(() => createLensGraph(analysis, granularity, focusMode, selectedId, edgeFilter, collapsedGroups, changeFilter === 'changed' ? changedIds : undefined, effectiveNodeLimit, new Set(pathEdgeIds)), [analysis, changeFilter, changedIds, collapsedGroups, edgeFilter, effectiveNodeLimit, focusMode, granularity, pathEdgeIds, selectedId]);
  const nodeChanges = useMemo(() => changeMap(diff, 'node'), [diff]);
  const edgeChanges = useMemo(() => changeMap(diff, 'edge'), [diff]);
  const warnings = useMemo(() => analyzeHealth(analysis), [analysis]);
  const normalizedQuery = mapQuery.trim().toLowerCase();
  const matches = normalizedQuery ? fullGraph.nodes.filter((node) => `${node.label} ${node.path} ${node.description}`.toLowerCase().includes(normalizedQuery)).length : 0;

  const handleFindPath = () => {
    if (!pathStart || !pathEnd) return;
    setPathIds(findGraphPath(fullGraph.edges, pathStart, pathEnd));
    setPathSearched(true);
    setFocusMode(false);
    setCollapsedGroups([]);
  };

  const handleSaveView = () => {
    const name = viewName.trim();
    if (!name) return;
    setSavedViews(saveMapView({ name, granularity, focusMode, edgeFilter, selectedId }));
    setViewName('');
  };

  const handleLoadView = (id: string) => {
    const view = savedViews.find((candidate) => candidate.id === id);
    if (!view) return;
    setGranularity(view.granularity);
    setFocusMode(view.focusMode);
    setEdgeFilter(view.edgeFilter);
    setPathIds(null);
    setPathSearched(false);
    setCollapsedGroups([]);
    onSelect(view.selectedId ?? '');
  };

  const handleWarning = (warning: HealthWarning) => {
    onSelect(warning.nodeIds[0] ?? '');
    setGranularity('module');
    setFocusMode(false);
  };

  return (
    <div className={`page architecture-page ${fullScreen ? 'map-fullscreen-page' : ''}`}>
      <div className="page-header compact-header"><div><div className="eyebrow">ARCHITECTURE MAP <span className="status-live"><i />LIVE VIEW</span></div><h1>Explore the architecture.</h1><p>Switch between modules, domains, APIs, functions, import sequences, and files. Drag nodes to save your own layout and lock positions you want to keep.</p></div><div className="map-header-actions"><div className="header-stat"><span>Showing</span><strong>{scopeLabel(granularity, analysis, visibleGraph.nodes.length)}</strong></div><button className="toolbar-button fullscreen-button" onClick={() => setFullScreen((value) => !value)}>{fullScreen ? 'Exit full screen' : 'Full screen map'} <span>{fullScreen ? '×' : '↗'}</span></button></div></div>
       <div className="map-toolbar">
         <div className="toolbar-group"><span className="toolbar-label">View</span><div className="segmented-control">{GRANULARITIES.map((value) => <button key={value} className={granularity === value ? 'active' : ''} onClick={() => { setGranularity(value); setPathIds(null); setPathSearched(false); }}>{value === 'module' ? 'Modules' : value === 'domain' ? 'Domains' : value === 'api' ? 'API' : value === 'function' ? 'Functions' : value === 'sequence' ? 'Sequence' : 'Files'}</button>)}</div></div>
         <div className="toolbar-group relationship-filter-group"><label className="toolbar-label" htmlFor="map-relationship-filter">Relationships</label><label className="filter-select"><span className="edge-sample" /><select id="map-relationship-filter" aria-label="Filter relationships" value={edgeFilter} onChange={(event) => { setEdgeFilter(event.target.value as EdgeFilter); setPathIds(null); setPathSearched(false); }}>{EDGE_FILTERS.map((filter) => <option key={filter} value={filter}>{EDGE_FILTER_LABELS[filter]}</option>)}</select></label></div>
         <label className="map-search"><span>⌕</span><input aria-label="Search map" value={mapQuery} onChange={(event) => setMapQuery(event.target.value)} placeholder="Search this map" />{normalizedQuery && <small>{matches}</small>}</label><label className="filter-select map-change-filter"><span>Scope</span><select aria-label="Map change scope" value={changeFilter} onChange={(event) => onChangeFilter?.(event.target.value as ChangeFilter)}><option value="all">All structure</option><option value="changed" disabled={!diff?.hasChanges}>Changed only</option></select></label>
        <div className="toolbar-spacer" /><button className={`toolbar-button ${focusMode ? 'toolbar-active' : ''}`} onClick={() => setFocusMode((value) => !value)}>{focusMode ? 'Show all' : 'Show selected area'} <span>◉</span></button><button className="toolbar-button" onClick={() => onSelect('')}>Clear selection <span>×</span></button>
      </div>
      <div className="map-feature-grid">
         <section className="map-path-panel" aria-label="Find a path"><div className="map-feature-heading"><div><div className="eyebrow">FIND A PATH</div><strong>Trace a dependency</strong></div>{pathSearched && <button className="quiet-button" onClick={() => { setPathIds(null); setPathSearched(false); }}>Clear path</button>}</div><div className="map-path-fields"><select aria-label="Path start" value={pathStart} onChange={(event) => { setPathStart(event.target.value); setPathSearched(false); }}><option value="">Start node</option>{fullGraph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select><span>→</span><select aria-label="Path end" value={pathEnd} onChange={(event) => { setPathEnd(event.target.value); setPathSearched(false); }}><option value="">End node</option>{fullGraph.nodes.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select><button className="secondary-button" disabled={!pathStart || !pathEnd} onClick={handleFindPath}>Find path</button></div>{pathSearched && <p className="map-path-result">{pathIds && pathIds.length > 1 ? `${pathIds.length} nodes in path` : 'No path found'}{pathIds && pathIds.length > 1 && <span>{pathIds.map((id) => fullGraph.nodes.find((node) => node.id === id)?.label ?? id).join(' → ')}</span>}</p>}</section>
        <GroupPanel groups={groups} groupMode={groupMode} collapsedGroups={collapsedGroups} onModeChange={(mode) => { setGroupMode(mode); if (mode === 'none') setCollapsedGroups([]); }} onToggle={(key) => setCollapsedGroups((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key])} />
        <section className="map-saved-panel" aria-label="Saved map views"><div className="map-feature-heading"><div><div className="eyebrow">SAVED VIEWS</div><strong>Save this map</strong></div></div><div className="map-saved-fields"><input aria-label="Saved view name" value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="View name" /><button className="secondary-button" disabled={!viewName.trim()} onClick={handleSaveView}>Save</button>{savedViews.length > 0 && <><select aria-label="Load saved view" defaultValue="" onChange={(event) => handleLoadView(event.target.value)}><option value="">Load a view</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select><button className="quiet-button" onClick={() => { const id = savedViews[0]?.id; if (id) setSavedViews(deleteMapView(id)); }}>Remove latest</button></>}</div></section>
      </div>
       <HealthPanel warnings={warnings} onSelect={handleWarning} />
       {performanceMode && <section className="map-performance-panel" aria-label="Large repository performance mode"><div><div className="eyebrow">LARGE REPOSITORY MODE</div><strong>Rendering the most connected {Math.min(renderLimit, fullGraph.nodes.length)} of {fullGraph.nodes.length} map nodes</strong><p>Analysis runs in a worker and the map loads progressively to keep navigation responsive.</p></div>{fullGraph.nodes.length > renderLimit && <button className="secondary-button" onClick={() => setRenderLimit((limit) => Math.min(limit + 120, fullGraph.nodes.length))}>Show 120 more</button>}{renderLimit >= fullGraph.nodes.length && <span className="pill pill-green">All nodes rendered</span>}</section>}
        <section className="map-workspace"><InteractiveArchitectureCanvas analysis={analysis} graph={visibleGraph} granularity={granularity} selectedId={selectedId} focusMode={focusMode} edgeFilter={edgeFilter} nodeQuery={mapQuery} highlightedPath={pathIds} collapsedGroups={collapsedGroups} snapshotNodeChanges={nodeChanges} snapshotEdgeChanges={edgeChanges} includedNodeIds={changeFilter === 'changed' ? [...changedIds] : undefined} nodeLimit={effectiveNodeLimit} annotations={annotations} fullScreen={fullScreen} showMinimap={showMinimap} onToggleMinimap={() => setShowMinimap((value) => !value)} onSelect={onSelect} /><div className="map-hint"><span className="hint-key">Drag</span> arrange <span className="hint-key">Shift</span> multi-select <span className="hint-key">⌁</span> select multiple</div></section>
    </div>
  );
}
