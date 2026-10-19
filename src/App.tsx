import { useEffect, useMemo, useRef, useState } from 'react';
import { strFromU8, unzipSync } from 'fflate';
import { analyzeRepository, isIgnoredImportPath, repositoryFilesFromEntries } from './analyzer';
import { createApiGraph, createDomainGraph, createFunctionGraph, domainKeyForPath } from './architectureLenses';
import { calculateImpact } from './impactAnalysis';
import { compareAnalyses, type SnapshotDiff } from './snapshotDiff';
import { loadSnapshots, saveSnapshot, snapshotLabel, type RepositorySnapshot } from './snapshotStore';
import { isLargeRepository, isLargeRepositoryFiles } from './performance';
import { buildHealthDashboard } from './healthDashboard';
import { buildDependencyReport, type DependencyReport } from './dependencyReport';
import { buildSearchResults, type SearchFilter, type SearchResult } from './search';
import { deleteAnnotation, loadAnnotations, saveAnnotation, type MapAnnotation } from './annotations';
import { deleteProject, loadSavedProjects, saveProject, touchProject, type SavedProject } from './projects';
import { downloadTextFile } from './mapExport';
import { buildArchitectureReport, buildArchitectureReportJson } from './architectureReport';
import { completeOnboarding, isOnboardingComplete } from './onboarding';
import InteractiveArchitectureCanvas from './InteractiveArchitectureCanvas';
import ArchitectureWorkspace from './ArchitectureWorkspace';
import { loadRecentRepositories, rememberRepository, type RecentRepository } from './repositoryHistory';
import WindowChrome from './WindowChrome';
import { isTauri } from '@tauri-apps/api/core';
import BrandIcon from './BrandIcon';
import type {
  EntryPoint,
  GraphNode,
  NodeKind,
  RepositoryAnalysis,
  RepositoryFile,
  SymbolInfo,
} from './types';

type ViewKey = 'overview' | 'architecture' | 'files' | 'symbols' | 'entry-points';
const NAV_ITEMS: Array<{ id: ViewKey; label: string; icon: string; hint?: string }> = [
  { id: 'overview', label: 'Overview', icon: '◒' },
  { id: 'architecture', label: 'Architecture map', icon: '⌘', hint: '1' },
  { id: 'files', label: 'Files', icon: '▤' },
  { id: 'symbols', label: 'Symbols', icon: 'ƒ' },
  { id: 'entry-points', label: 'Entry points', icon: '↳' },
];

const externalColor = '#f6b86a';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function analyzeRepositoryAsync(files: RepositoryFile[], name: string, onProgress: (message: string) => void): Promise<RepositoryAnalysis> {
  if (!isLargeRepositoryFiles(files) || typeof Worker === 'undefined') return Promise.resolve(analyzeRepository(files, name));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(analyzeRepository(files, name));
      return;
    }
    worker.onmessage = (event: MessageEvent<{ type: string; message?: string; analysis?: RepositoryAnalysis }>) => {
      if (event.data.type === 'progress' && event.data.message) onProgress(event.data.message);
      if (event.data.type === 'complete' && event.data.analysis) {
        worker.terminate();
        resolve(event.data.analysis);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'Background analysis failed.'));
    };
    worker.postMessage({ files, name });
  });
}

function shortPath(path: string, max = 36): string {
  if (path.length <= max) return path;
  return `…${path.slice(path.length - max + 1)}`;
}

function safeFileName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'repository';
}

function nodeKindLabel(node: GraphNode | NodeKind): string {
  if (typeof node !== 'string' && node.id.startsWith('domain:')) return 'Domain';
  if (typeof node !== 'string' && node.id.startsWith('api:')) return 'API surface';
  if (typeof node !== 'string' && node.id.startsWith('function:')) return 'Function';
  const kind = typeof node === 'string' ? node : node.kind;
  return kind === 'module' ? 'Module' : kind === 'external' ? 'External boundary' : 'Source file';
}

function nodeColor(node: GraphNode): string {
  if (node.kind === 'external') return externalColor;
  if (node.id.startsWith('api:')) return '#6fd4c3';
  if (node.id.startsWith('function:')) return '#73d6ab';
  if (node.kind === 'file') return '#70a9ff';
  if (node.id.startsWith('domain:')) return '#ad91ff';
  if (node.score >= 8) return '#ad91ff';
  return '#7185dc';
}

function findNode(analysis: RepositoryAnalysis, nodeId: string | null): GraphNode | undefined {
  if (!nodeId) return undefined;
  return [...analysis.nodes, ...analysis.fileNodes, ...createDomainGraph(analysis).nodes, ...createApiGraph(analysis).nodes, ...createFunctionGraph(analysis).nodes].find((node) => node.id === nodeId);
}

function fileForNode(analysis: RepositoryAnalysis, node: GraphNode | undefined): RepositoryFile | undefined {
  if (!node || node.kind !== 'file') return undefined;
  return analysis.files.find((file) => file.path === node.path);
}

function moduleForNode(analysis: RepositoryAnalysis, node: GraphNode | undefined) {
  if (!node || node.kind !== 'module') return undefined;
  return analysis.modules.find((module) => `module:${module.id}` === node.id);
}

function domainModulesForNode(analysis: RepositoryAnalysis, node: GraphNode | undefined) {
  if (!node || !node.id.startsWith('domain:')) return [];
  const key = node.id.slice('domain:'.length);
  return analysis.modules.filter((module) => domainKeyForPath(module.path) === key);
}

function apiSymbolForNode(analysis: RepositoryAnalysis, node: GraphNode | undefined) {
  if (!node || !node.id.startsWith('api:')) return undefined;
  const symbolId = node.id.slice('api:'.length);
  return analysis.symbols.find((symbol) => symbol.id === symbolId);
}

function functionSymbolForNode(analysis: RepositoryAnalysis, node: GraphNode | undefined) {
  if (!node || !node.id.startsWith('function:')) return undefined;
  const symbolId = node.id.slice('function:'.length);
  return analysis.symbols.find((symbol) => symbol.id === symbolId);
}

function symbolsForFile(analysis: RepositoryAnalysis, path: string): SymbolInfo[] {
  return analysis.symbols.filter((symbol) => symbol.filePath === path);
}

function bestSelection(analysis: RepositoryAnalysis): string | null {
  const entry = analysis.entryPoints[0];
  if (entry) {
    const module = analysis.modules.find((candidate) => candidate.filePaths.includes(entry.path));
    if (module) return `module:${module.id}`;
    return entry.nodeId;
  }
  return analysis.nodes.find((node) => node.kind === 'module')?.id ?? analysis.nodes[0]?.id ?? null;
}

function MetricCard({ label, value, detail, tone = 'blue' }: { label: string; value: string; detail: string; tone?: string }) {
  return (
    <div className={`metric-card metric-${tone}`}>
      <div className="metric-topline"><span>{label}</span><span className="metric-dot" /></div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'blue' | 'purple' | 'amber' | 'green' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function SnapshotDiffSummary({ diff, onNavigate, onInspectChanges, onDismiss, comparisonLabel }: { diff: SnapshotDiff; onNavigate: (view: ViewKey) => void; onInspectChanges: () => void; onDismiss: () => void; comparisonLabel?: string }) {
  const changes = [
    ...diff.addedFiles,
    ...diff.removedFiles,
    ...diff.changedFiles,
    ...diff.addedNodes,
    ...diff.removedNodes,
    ...diff.changedNodes,
  ].slice(0, 6);
  return (
    <section className="panel snapshot-diff-panel" aria-label="Structural snapshot diff">
       <div className="panel-heading"><div><div className="eyebrow">STRUCTURAL DIFF <span className="status-live"><i />LOCAL SNAPSHOT</span></div><h2>{diff.total} changes {comparisonLabel ? `between ${comparisonLabel}` : 'since the previous index'}</h2></div><button className="icon-button" aria-label="Dismiss snapshot diff" title="Dismiss snapshot diff" onClick={onDismiss}>×</button></div>
      <div className="diff-metrics"><span><strong>{diff.addedFiles.length + diff.addedNodes.length}</strong><small>added</small></span><span><strong>{diff.removedFiles.length + diff.removedNodes.length}</strong><small>removed</small></span><span><strong>{diff.changedFiles.length + diff.changedNodes.length}</strong><small>changed</small></span><span><strong>{diff.addedEdges.length + diff.removedEdges.length + diff.changedEdges.length}</strong><small>relationships</small></span></div>
       {changes.length ? <div className="diff-change-list">{changes.map((change) => <div key={`${change.kind}:${change.category}:${change.id}`} className="diff-change"><span className={`diff-change-kind diff-${change.kind}`}>{change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '~'}</span><span><strong>{shortPath(change.label, 48)}</strong><small>{change.detail}</small></span></div>)}</div> : <p className="muted diff-empty">The structure is equivalent; only non-structural metadata may have changed.</p>}
       <div className="diff-footer"><button className="secondary-button" onClick={onInspectChanges}>Inspect changed structure <span>↗</span></button><button className="quiet-button" onClick={onDismiss}>Dismiss</button></div>
   </section>
  );
}

function SnapshotComparePanel({ snapshots, currentName, onSaveCurrent, onCompare }: { snapshots: RepositorySnapshot[]; currentName: string; onSaveCurrent: () => void; onCompare: (beforeId: string, afterId: string) => void }) {
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');

  useEffect(() => {
    if (!snapshots.some((snapshot) => snapshot.id === beforeId)) setBeforeId(snapshots[1]?.id ?? snapshots[0]?.id ?? '');
    if (!snapshots.some((snapshot) => snapshot.id === afterId)) setAfterId(snapshots[0]?.id ?? '');
  }, [afterId, beforeId, snapshots]);

  return (
    <section className="panel snapshot-compare-panel" aria-label="Compare repository snapshots">
      <div className="panel-heading"><div><div className="eyebrow">COMPARE SNAPSHOTS</div><h2>Review architecture between two indexes</h2></div><span className="sparkle">⇄</span></div>
      <p className="panel-intro">Save the current index, then choose a baseline and a newer snapshot to see changed files, nodes, and relationships.</p>
      <div className="snapshot-compare-fields">
        <label><span>Baseline</span><select aria-label="Baseline snapshot" value={beforeId} onChange={(event) => setBeforeId(event.target.value)}><option value="">Choose a snapshot</option>{snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}</select></label>
        <span className="snapshot-arrow">→</span>
        <label><span>Compare with</span><select aria-label="Comparison snapshot" value={afterId} onChange={(event) => setAfterId(event.target.value)}><option value="">Choose a snapshot</option>{snapshots.map((snapshot) => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}</select></label>
        <button className="secondary-button" disabled={!beforeId || !afterId || beforeId === afterId} onClick={() => onCompare(beforeId, afterId)}>Compare</button>
      </div>
      <div className="snapshot-compare-footer"><span className="muted">Current index: <strong>{currentName}</strong></span><button className="quiet-button" onClick={onSaveCurrent}>Save current snapshot</button>{!snapshots.length && <span className="muted">No saved snapshots yet.</span>}</div>
    </section>
  );
}

function OnboardingPanel({ onNavigate, onImport, onDismiss }: { onNavigate: (view: ViewKey) => void; onImport: () => void; onDismiss: () => void }) {
  return (
    <section className="panel onboarding-panel" aria-label="RepoLens onboarding guide">
       <BrandIcon className="onboarding-art" />
      <div className="onboarding-content"><div className="eyebrow">QUICK START</div><h2>Find your way around RepoLens</h2><p>Use this three-step tour to turn an unfamiliar repository into a useful map.</p><ol><li><strong>Import source</strong><span>Choose a local folder or ZIP. Your code stays in this browser.</span><button className="text-button" onClick={onImport}>Import a repository <span>↗</span></button></li><li><strong>Find the starting point</strong><span>Open entry points to see likely runtime beginnings and why they were ranked.</span><button className="text-button" onClick={() => onNavigate('entry-points')}>See entry points <span>→</span></button></li><li><strong>Trace the architecture</strong><span>Open the map, select a module, and follow its relationships.</span><button className="text-button" onClick={() => onNavigate('architecture')}>Open map <span>↗</span></button></li></ol></div>
      <button className="onboarding-dismiss" aria-label="Dismiss onboarding guide" onClick={onDismiss}>×</button>
    </section>
  );
}

function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"><div className="source-dialog-heading"><div><div className="eyebrow">KEYBOARD SHORTCUTS</div><h2 id="shortcuts-title">Move through RepoLens faster.</h2><p>Shortcuts work when a text field is not focused.</p></div><button className="icon-button" aria-label="Close keyboard shortcuts" onClick={onClose}>×</button></div><dl className="shortcut-list"><div><dt><kbd>⌘ K</kbd> or <kbd>Ctrl K</kbd></dt><dd>Open search</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Close a dialog or full-screen map</dd></div><div><dt><kbd>⌘ Z</kbd> or <kbd>Ctrl Z</kbd></dt><dd>Undo the last map layout change</dd></div><div><dt><kbd>⇧ ⌘ Z</kbd> or <kbd>Ctrl ⇧ Z</kbd></dt><dd>Redo a map layout change</dd></div><div><dt><kbd>Shift</kbd> + drag</dt><dd>Select multiple map nodes</dd></div></dl><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Close</button></div></section></div>;
}

function HealthDashboardPanel({ analysis, onSelect }: { analysis: RepositoryAnalysis; onSelect: (nodeId: string) => void }) {
  const dashboard = buildHealthDashboard(analysis);
  return (
    <section className="panel health-dashboard-panel" aria-label="Architecture health dashboard">
      <div className="panel-heading"><div><div className="eyebrow">ARCHITECTURE HEALTH</div><h2>Where the structure needs attention</h2></div><Pill tone={dashboard.status === 'Healthy' ? 'green' : dashboard.status === 'Review' ? 'amber' : 'blue'}>{dashboard.status}</Pill></div>
      <div className="health-dashboard-score"><div className="health-score-ring"><strong>{dashboard.score}</strong><span>score</span></div><div><strong>{dashboard.cycles ? `${dashboard.cycles} circular dependencies` : 'No dependency cycles detected'}</strong><p>Average connectivity is {dashboard.averageLinks} links per module, with a maximum dependency depth of {dashboard.dependencyDepth}.</p></div></div>
      <div className="health-dashboard-metrics"><button onClick={() => dashboard.warnings.find((warning) => warning.kind === 'cycle')?.nodeIds[0] && onSelect(dashboard.warnings.find((warning) => warning.kind === 'cycle')?.nodeIds[0] ?? '')}><strong>{dashboard.cycles}</strong><span>cycles</span></button><button onClick={() => dashboard.topHotspots[0] && onSelect(dashboard.topHotspots[0].id)}><strong>{dashboard.hotspots}</strong><span>hotspots</span></button><button onClick={() => dashboard.warnings.find((warning) => warning.kind === 'isolated')?.nodeIds[0] && onSelect(dashboard.warnings.find((warning) => warning.kind === 'isolated')?.nodeIds[0] ?? '')}><strong>{dashboard.isolated}</strong><span>isolated</span></button><button onClick={() => dashboard.warnings.find((warning) => warning.kind === 'large')?.nodeIds[0] && onSelect(dashboard.warnings.find((warning) => warning.kind === 'large')?.nodeIds[0] ?? '')}><strong>{dashboard.largeModules}</strong><span>large modules</span></button></div>
      <div className="health-dashboard-hotspots"><span className="section-label">Most connected modules</span>{dashboard.topHotspots.map((node) => <button key={node.id} onClick={() => onSelect(node.id)}><span>{node.label}</span><small>{node.inbound + node.outbound} links</small></button>)}</div>
    </section>
  );
}

function GitActivityPanel({ analysis }: { analysis: RepositoryAnalysis }) {
  const git = analysis.git;
  return (
    <section className="panel git-activity-panel" aria-label="Git activity">
      <div className="panel-heading"><div><div className="eyebrow">GIT ACTIVITY</div><h2>{git?.isRepository ? 'Repository history' : 'Git metadata'}</h2></div><Pill tone={git?.isRepository ? 'green' : 'neutral'}>{git?.isRepository ? 'Detected locally' : 'Not detected'}</Pill></div>
      {git?.isRepository ? <><div className="git-summary"><span><small>Branch</small><strong>{git.branch ?? 'Detached HEAD'}</strong></span><span><small>HEAD</small><strong>{git.head?.slice(0, 10) ?? 'Unknown'}</strong></span>{git.remote && <span><small>Remote</small><strong>{shortPath(git.remote, 28)}</strong></span>}</div><div className="git-commit-list">{git.commits.slice(0, 4).map((commit) => <div key={`${commit.hash}:${commit.timestamp}`}><span className="git-commit-hash">{commit.shortHash}</span><span><strong>{commit.subject.replace(/^commit:\s*/i, '')}</strong><small>{commit.author}{commit.timestamp ? ` · ${new Date(commit.timestamp).toLocaleDateString()}` : ''}</small></span></div>)}</div></> : <p className="panel-intro">Import a folder or ZIP containing its <code>.git</code> metadata to see the active branch, commit, and recent local history.</p>}
    </section>
  );
}

function DependencyReportDialog({ report, onClose }: { report: DependencyReport | null; onClose: () => void }) {
  if (!report) return null;
  return <div className="modal-backdrop source-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="dependency-report-dialog" role="dialog" aria-modal="true" aria-label="Dependency report"><div className="source-dialog-heading"><div><div className="eyebrow">DEPENDENCY REPORT</div><h2>{shortPath(report.node.path, 58)}</h2><p>{report.node.label} · {report.directDependencies.length} dependencies · {report.directDependents.length} direct dependents</p></div><button className="icon-button" aria-label="Close dependency report" onClick={onClose}>×</button></div><div className="dependency-report-grid"><section><div className="section-label">Direct dependencies</div>{report.directDependencies.length ? <ul>{report.directDependencies.map((node) => <li key={node.id}><strong>{node.label}</strong><small>{shortPath(node.path, 32)}</small></li>)}</ul> : <p className="muted">None detected.</p>}</section><section><div className="section-label">Dependents</div>{report.directDependents.length ? <ul>{report.directDependents.map((node) => <li key={node.id}><strong>{node.label}</strong><small>{shortPath(node.path, 32)}</small></li>)}</ul> : <p className="muted">None detected.</p>}</section></div><div className="dialog-actions"><button className="secondary-button" onClick={() => downloadTextFile(`repolens-dependency-${report.node.label}.md`, report.markdown, 'text/markdown')}>Export Markdown</button><button className="quiet-button" onClick={onClose}>Close</button></div></section></div>;
}

function Inspector({
  analysis,
  selectedId,
  selectedSymbolId,
  annotations,
  onNavigate,
  onSelect,
  onSelectSymbol,
  onOpenSource,
  onSaveAnnotation,
  onDeleteAnnotation,
  onOpenReport,
}: {
  analysis: RepositoryAnalysis;
  selectedId: string | null;
  selectedSymbolId: string | null;
  annotations: MapAnnotation[];
  onNavigate: (view: ViewKey) => void;
  onSelect: (id: string) => void;
  onSelectSymbol: (symbol: SymbolInfo) => void;
  onOpenSource: (path: string, line?: number) => void;
  onSaveAnnotation: (annotation: { id?: string; nodeId: string; text: string; color: MapAnnotation['color'] }) => void;
  onDeleteAnnotation: (id: string) => void;
  onOpenReport: (nodeId: string) => void;
}) {
  const node = findNode(analysis, selectedId);
  const file = fileForNode(analysis, node);
  const module = moduleForNode(analysis, node);
  const domainModules = domainModulesForNode(analysis, node);
  const apiSymbol = apiSymbolForNode(analysis, node);
  const functionSymbol = functionSymbolForNode(analysis, node);
  const selectedSymbol = analysis.symbols.find((symbol) => symbol.id === selectedSymbolId);
  const selectedSymbolReferences = selectedSymbol ? analysis.references.filter((reference) => reference.symbolId === selectedSymbol.id) : [];
  const annotation = annotations.find((candidate) => candidate.nodeId === selectedId);
  const [annotationText, setAnnotationText] = useState('');
  const [annotationColor, setAnnotationColor] = useState<MapAnnotation['color']>('blue');
  useEffect(() => {
    setAnnotationText(annotation?.text ?? '');
    setAnnotationColor(annotation?.color ?? 'blue');
  }, [annotation?.color, annotation?.text, selectedId]);
  const isDomain = Boolean(node?.id.startsWith('domain:'));
  const isApi = Boolean(apiSymbol);
  const isFunction = Boolean(functionSymbol);
  const relatedEdges = isDomain
    ? createDomainGraph(analysis).edges.filter((edge) => edge.source === node?.id || edge.target === node?.id)
    : isApi
      ? createApiGraph(analysis).edges.filter((edge) => edge.source === node?.id || edge.target === node?.id)
      : isFunction
        ? createFunctionGraph(analysis).edges.filter((edge) => edge.source === node?.id || edge.target === node?.id)
    : node?.kind === 'module'
      ? analysis.edges.filter((edge) => edge.source === node.id || edge.target === node.id)
      : analysis.fileEdges.filter((edge) => edge.source === node?.id || edge.target === node?.id);
  const fileSymbols = file ? symbolsForFile(analysis, file.path) : [];
  const impactEdges = isDomain
    ? createDomainGraph(analysis).edges
    : isApi
      ? createApiGraph(analysis).edges
      : isFunction
        ? createFunctionGraph(analysis).edges
        : node?.kind === 'module'
          ? analysis.edges
          : analysis.fileEdges;
  const impact = node ? calculateImpact(node.id, impactEdges) : null;

  if (!node) {
    return (
      <aside className="inspector inspector-empty">
        <BrandIcon className="inspector-empty-art" />
        <h2>Select something to inspect</h2>
        <p>Choose a module, file, or entry point and RepoLens will explain how it fits into the repository.</p>
        <button className="text-button" onClick={() => onNavigate('architecture')}>Open architecture map <span>↗</span></button>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <div>
          <div className="eyebrow">{nodeKindLabel(node)}</div>
          <h2>{node.label}</h2>
        </div>
        <button className="icon-button" aria-label="Close inspector" title="Clear selection" onClick={() => onSelect('')}>×</button>
      </div>
      <p className="inspector-path">{shortPath(node.path, 42)}</p>
       <div className="inspector-pills"><Pill tone={node.kind === 'external' ? 'amber' : node.kind === 'module' ? 'purple' : 'blue'}>{isDomain ? 'Domain' : isApi ? 'API surface' : isFunction ? 'Function' : node.language ?? 'Package'}</Pill><Pill>{node.inbound + node.outbound} links</Pill></div>
       <p className="inspector-description">{node.description}</p>
       <div className="inspector-stats"><div><strong>{node.inbound}</strong><span>inbound</span></div><div><strong>{node.outbound}</strong><span>outbound</span></div><div><strong>{node.fileCount || '—'}</strong><span>files</span></div></div>
       {impact && <section className="inspector-section impact-section"><div className="section-label">Change impact</div><div className="impact-stats"><div><strong>{impact.directDependents}</strong><span>direct dependents</span></div><div><strong>{impact.transitiveDependents}</strong><span>total affected</span></div></div>{impact.transitiveDependents ? <p className="muted">A change here can propagate through {impact.transitiveDependents} dependent {impact.transitiveDependents === 1 ? 'node' : 'nodes'}.</p> : <p className="muted">No downstream dependents were detected in this lens.</p>}</section>}
       <section className="inspector-section annotation-section" aria-label="Map annotation"><div className="section-label">Map annotation</div><textarea aria-label="Map annotation text" value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} placeholder="Add a note for this node…" rows={3} /><div className="annotation-controls"><select aria-label="Annotation color" value={annotationColor} onChange={(event) => setAnnotationColor(event.target.value as MapAnnotation['color'])}><option value="blue">Blue</option><option value="amber">Amber</option><option value="green">Green</option><option value="purple">Purple</option></select><button className="secondary-button" disabled={!annotationText.trim()} onClick={() => onSaveAnnotation({ id: annotation?.id, nodeId: node.id, text: annotationText, color: annotationColor })}>{annotation ? 'Update note' : 'Add note'}</button>{annotation && <button className="quiet-button" onClick={() => { onDeleteAnnotation(annotation.id); setAnnotationText(''); }}>Remove</button>}</div></section>

       {module && <section className="inspector-section"><div className="section-label">Inside this module</div><div className="inspector-list">{module.filePaths.slice(0, 6).map((path) => <button key={path} className="inspector-list-item" onClick={() => onSelect(`file:${path}`)}><span className="file-glyph">{path.endsWith('.ts') ? 'TS' : '•'}</span><span>{shortPath(path, 30)}</span></button>)}</div>{module.filePaths.length > 6 && <small className="muted">+ {module.filePaths.length - 6} more files</small>}</section>}
       {domainModules.length > 0 && <section className="inspector-section"><div className="section-label">Inside this domain</div><div className="inspector-list">{domainModules.slice(0, 6).map((candidate) => <button key={candidate.id} className="inspector-list-item" onClick={() => onSelect(`module:${candidate.id}`)}><span className="connection-dot" style={{ background: nodeColor({ ...node, id: `module:${candidate.id}` }) }} /><span>{candidate.name}<small>{candidate.filePaths.length} files</small></span></button>)}</div>{domainModules.length > 6 && <small className="muted">+ {domainModules.length - 6} more modules</small>}</section>}
        {apiSymbol && <section className="inspector-section"><div className="section-label">Exported API</div><p className="inspector-description"><code>{apiSymbol.signature}</code></p><p className="muted">Public {apiSymbol.type} at line {apiSymbol.line} in {shortPath(apiSymbol.filePath, 34)}.</p><button className="text-button" onClick={() => onOpenSource(apiSymbol.filePath, apiSymbol.line)}>Open line {apiSymbol.line} <span>↗</span></button></section>}
        {functionSymbol && <section className="inspector-section"><div className="section-label">Function detail</div><p className="inspector-description"><code>{functionSymbol.signature}</code></p><p className="muted">{functionSymbol.exported ? 'Exported' : 'Local'} function at line {functionSymbol.line} in {shortPath(functionSymbol.filePath, 34)}.</p><button className="text-button" onClick={() => onOpenSource(functionSymbol.filePath, functionSymbol.line)}>Open line {functionSymbol.line} <span>↗</span></button></section>}
       {selectedSymbol && <section className="inspector-section symbol-navigation-section" aria-label="Symbol definition and references"><div className="section-label">Definition</div><div className="symbol-definition"><span className="symbol-glyph">{selectedSymbol.type === 'function' ? 'ƒ' : '◇'}</span><span><strong>{selectedSymbol.name}</strong><small>{selectedSymbol.type} · {shortPath(selectedSymbol.filePath, 34)}:{selectedSymbol.line}</small></span></div><button className="secondary-button" onClick={() => onOpenSource(selectedSymbol.filePath, selectedSymbol.line)}>Jump to definition <span>↗</span></button><div className="section-label symbol-reference-label">References <span>{selectedSymbolReferences.length}</span></div>{selectedSymbolReferences.length ? <div className="inspector-list">{selectedSymbolReferences.slice(0, 12).map((reference) => <button key={reference.id} className="inspector-list-item" onClick={() => onOpenSource(reference.filePath, reference.line)}><span className="connection-dot" /><span><strong>{shortPath(reference.filePath, 28)}:{reference.line}</strong><small>{reference.role} · {reference.context}</small></span></button>)}</div> : <p className="muted">No references were detected for this symbol.</p>}{selectedSymbolReferences.length > 12 && <small className="muted">+ {selectedSymbolReferences.length - 12} more references</small>}</section>}
      {file && <>
         <section className="inspector-section"><div className="section-label">Key symbols</div>{fileSymbols.length ? <div className="inspector-list">{fileSymbols.slice(0, 5).map((symbol) => <button key={symbol.id} className="inspector-list-item" onClick={() => onSelectSymbol(symbol)}><span className="symbol-glyph">{symbol.type === 'function' ? 'ƒ' : '◇'}</span><span><strong>{symbol.name}</strong><small>{symbol.type} · line {symbol.line} · {analysis.references.filter((reference) => reference.symbolId === symbol.id).length} refs</small></span></button>)}</div> : <p className="muted">No named symbols detected in this file.</p>}</section>
        <section className="inspector-section"><div className="section-label">Source preview</div><pre className="code-preview"><code>{file.content.split(/\r?\n/).slice(0, 8).map((line, index) => `${String(index + 1).padStart(2, ' ')}  ${line}`).join('\n')}</code></pre></section>
      </>}
      {node.kind === 'external' && <section className="inspector-section"><div className="section-label">Why it matters</div><p className="muted">This package is outside the repository. Follow the inbound edges to see which local modules cross this boundary.</p></section>}

       <section className="inspector-section"><div className="section-label">Connected to</div>{relatedEdges.length ? <div className="inspector-list">{relatedEdges.slice(0, 8).map((edge) => { const relatedId = edge.source === node.id ? edge.target : edge.source; const related = findNode(analysis, relatedId); if (!related) return null; return <button key={edge.id} className="inspector-list-item" onClick={() => onSelect(related.id)}><span className="connection-dot" style={{ background: nodeColor(related) }} /><span><strong>{related.label}</strong><small>{edge.label}{edge.weight > 1 ? ` · ${edge.weight}×` : ''} · {nodeKindLabel(related)}</small></span></button>; })}</div> : <p className="muted">No local relationships detected.</p>}</section>
        <div className="inspector-actions"><button className="secondary-button" onClick={() => onNavigate('architecture')}>Focus on map</button><button className="secondary-button" onClick={() => onOpenReport(node.id)}>Dependency report</button>{file && <button className="primary-button" onClick={() => onOpenSource(file.path, 1)}>Open source</button>}</div>
    </aside>
  );
}

function OverviewView({ analysis, diff, snapshots, comparisonLabel, showOnboarding, onNavigate, onSelect, onInspectChanges, onDismissDiff, onSaveSnapshot, onCompareSnapshots, onSelectHealth, onImport, onDismissOnboarding, onExportReport }: { analysis: RepositoryAnalysis; diff: SnapshotDiff | null; snapshots: RepositorySnapshot[]; comparisonLabel?: string; showOnboarding: boolean; onNavigate: (view: ViewKey) => void; onSelect: (id: string) => void; onInspectChanges: () => void; onDismissDiff: () => void; onSaveSnapshot: () => void; onCompareSnapshots: (beforeId: string, afterId: string) => void; onSelectHealth: (nodeId: string) => void; onImport: () => void; onDismissOnboarding: () => void; onExportReport: (format: 'markdown' | 'json') => void }) {
  const topEntries = analysis.entryPoints.slice(0, 3);
  const hasRepository = analysis.files.length > 0;
  return (
    <div className="page overview-page">
      <div className="page-header hero-header">
         <div><div className="eyebrow">{hasRepository ? 'REPOSITORY OVERVIEW' : 'READY TO EXPLORE'} {hasRepository && <span className="status-live"><i />INDEXED</span>}</div><h1>{hasRepository ? <>Explore <em>{analysis.name}</em>.</> : <>Open your repository.</>}</h1><p className="hero-copy">{hasRepository ? 'Browse files, modules, symbols, and the connections between them.' : 'Choose a local folder or ZIP to build an architecture map without uploading your source code.'}</p></div>
         <div className="hero-actions">{hasRepository && <><button className="secondary-button" onClick={() => onNavigate('entry-points')}>View entry points <span>→</span></button><button className="secondary-button" onClick={() => onExportReport('markdown')}>Export report <span>↓</span></button><button className="quiet-button" onClick={() => onExportReport('json')}>Export JSON <span>↓</span></button></>}<button className="primary-button" onClick={hasRepository ? () => onNavigate('architecture') : onImport}>{hasRepository ? 'Open architecture map' : 'Open repository'} <span>↗</span></button></div>
       </div>
       {showOnboarding && <OnboardingPanel onNavigate={onNavigate} onImport={onImport} onDismiss={onDismissOnboarding} />}
       {!hasRepository ? <section className="panel empty-repository-panel" aria-label="Open your repository"><BrandIcon className="empty-repository-art" /><div><div className="eyebrow">NO REPOSITORY OPEN</div><h2>Start with your own codebase.</h2><p>RepoLens reads source files locally, finds likely entry points, and builds a connected architecture map. Nothing is uploaded.</p><button className="primary-button" onClick={onImport}>Choose a folder or ZIP <span>↗</span></button></div></section> : <>
         <div className="metric-grid"><MetricCard label="Files" value={formatNumber(analysis.metrics.files)} detail={`${analysis.metrics.modules} modules · ${analysis.metrics.symbols} symbols`} tone="blue" /><MetricCard label="Relationships" value={formatNumber(analysis.metrics.relationships)} detail={`${analysis.metrics.externalDependencies} external packages`} tone="purple" /><MetricCard label="Entry points" value={String(analysis.entryPoints.length).padStart(2, '0')} detail="detected application starts" tone="amber" /><MetricCard label="Languages" value={String(analysis.languages.length).padStart(2, '0')} detail={analysis.languages.slice(0, 3).map((language) => language.name).join(' · ')} tone="green" /></div>
         {diff?.hasChanges && <SnapshotDiffSummary diff={diff} onNavigate={onNavigate} onInspectChanges={onInspectChanges} comparisonLabel={comparisonLabel} onDismiss={onDismissDiff} />}
         <SnapshotComparePanel snapshots={snapshots} currentName={analysis.name} onSaveCurrent={onSaveSnapshot} onCompare={onCompareSnapshots} />
         <div className="overview-insights-grid"><HealthDashboardPanel analysis={analysis} onSelect={onSelectHealth} /><GitActivityPanel analysis={analysis} /></div>
         <div className="overview-grid">
           <section className="panel start-panel"><div className="panel-heading"><div><div className="eyebrow">YOUR FIRST 60 SECONDS</div><h2>Start here</h2></div><button className="quiet-button" onClick={() => onNavigate('entry-points')}>See all <span>→</span></button></div><p className="panel-intro">RepoLens ranked these places by runtime signals and how much of the repository they reveal.</p><div className="entry-list">{topEntries.length ? topEntries.map((entry, index) => <button key={entry.id} className="entry-card" onClick={() => { onSelect(entry.nodeId); onNavigate('architecture'); }}><span className="entry-number">0{index + 1}</span><span className="entry-card-main"><strong>{entry.name}</strong><span>{shortPath(entry.path, 34)}</span></span><Pill tone={entry.confidence === 'High' ? 'green' : entry.confidence === 'Likely' ? 'blue' : 'amber'}>{entry.confidence}</Pill><span className="entry-arrow">↗</span></button>) : <div className="empty-inline">No likely entry points yet. Explore the architecture map to find the most connected modules.</div>}</div></section>
            <section className="panel summary-panel"><div className="panel-heading"><div><div className="eyebrow">SUMMARY</div><h2>How the repository fits together</h2></div><BrandIcon className="sparkle" /></div><div className="summary-callout"><BrandIcon className="callout-icon" /><p>{analysis.summary.paragraphs[0]}</p></div><div className="summary-lines">{analysis.summary.paragraphs.slice(1).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div><div className="summary-footer"><span><i className="legend-swatch legend-module" />Most connected: {analysis.summary.hotspots.slice(0, 2).join(' · ') || 'Not enough data'}</span><button className="text-button" onClick={() => onNavigate('architecture')}>Open map <span>→</span></button></div></section>
         </div>
         <section className="panel map-preview-panel"><div className="panel-heading"><div><div className="eyebrow">MAP PREVIEW</div><h2>Architecture map</h2></div><button className="quiet-button" onClick={() => onNavigate('architecture')}>Open map <span>↗</span></button></div><InteractiveArchitectureCanvas analysis={analysis} granularity="module" selectedId={null} focusMode={false} compact onSelect={(id) => { onSelect(id); onNavigate('architecture'); }} /></section>
       </>}
    </div>
  );
}

function ArchitectureView({ analysis, selectedId, onSelect, diff, changeFilter, onChangeFilter, performanceMode, annotations }: { analysis: RepositoryAnalysis; selectedId: string | null; onSelect: (id: string) => void; diff: SnapshotDiff | null; changeFilter: 'all' | 'changed'; onChangeFilter: (filter: 'all' | 'changed') => void; performanceMode: boolean; annotations: MapAnnotation[] }) {
  return <ArchitectureWorkspace analysis={analysis} selectedId={selectedId} onSelect={onSelect} diff={diff} changeFilter={changeFilter} onChangeFilter={onChangeFilter} performanceMode={performanceMode} annotations={annotations} />;
}

function FilesView({ analysis, query, onQueryChange, onSelect }: { analysis: RepositoryAnalysis; query: string; onQueryChange: (query: string) => void; onSelect: (id: string) => void }) {
  const normalized = query.toLowerCase().trim();
  const files = analysis.files.filter((file) => !normalized || `${file.path} ${file.language}`.toLowerCase().includes(normalized));
  return <div className="page explorer-page"><div className="page-header compact-header"><div><div className="eyebrow">REPOSITORY FILES</div><h1>Every source location, accounted for.</h1><p>Search by path or language, then inspect its place in the architecture.</p></div><div className="header-stat"><span>Showing</span><strong>{files.length} / {analysis.files.length}</strong></div></div><div className="explorer-toolbar"><label className="inline-search"><span>⌕</span><input aria-label="Filter files" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Filter files by path or language" /><kbd>⌘ F</kbd></label><div className="toolbar-summary"><Pill>{analysis.languages.map((language) => `${language.name} ${language.count}`).join(' · ')}</Pill></div></div><section className="data-panel"><div className="data-header"><span>Path</span><span>Language</span><span>Module</span><span>Symbols</span><span>Size</span></div>{files.map((file) => { const module = analysis.modules.find((candidate) => candidate.filePaths.includes(file.path)); return <button key={file.path} className="data-row file-row" onClick={() => onSelect(`file:${file.path}`)}><span className="path-cell"><span className="file-type-icon">{file.language === 'TypeScript' ? 'TS' : file.language.slice(0, 2).toUpperCase()}</span><strong>{file.path}</strong></span><span><Pill tone="blue">{file.language}</Pill></span><span className="muted">{module?.name ?? 'Root'}</span><span className="muted">{symbolsForFile(analysis, file.path).length || '—'}</span><span className="muted mono">{formatSize(file.size)}</span></button> })}{!files.length && <div className="empty-table"><span>⌕</span><strong>No files match “{query}”</strong><p>Try a directory name, extension, or clear the filter.</p></div>}</section></div>;
}

function SymbolsView({ analysis, query, onQueryChange, onSelectSymbol }: { analysis: RepositoryAnalysis; query: string; onQueryChange: (query: string) => void; onSelectSymbol: (symbol: SymbolInfo) => void }) {
  const normalized = query.toLowerCase().trim();
  const symbols = analysis.symbols.filter((symbol) => !normalized || `${symbol.name} ${symbol.filePath} ${symbol.type}`.toLowerCase().includes(normalized));
   return <div className="page explorer-page"><div className="page-header compact-header"><div><div className="eyebrow">SYMBOL INDEX</div><h1>Search the ideas inside the files.</h1><p>Functions, classes, types, and constants linked back to their source.</p></div><div className="header-stat"><span>Indexed symbols</span><strong>{formatNumber(analysis.symbols.length)}</strong></div></div><div className="explorer-toolbar"><label className="inline-search"><span>⌕</span><input aria-label="Filter symbols" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Find a function, class, or type" /><kbd>⌘ F</kbd></label><div className="toolbar-summary"><Pill tone="purple">{symbols.length} results</Pill></div></div><section className="data-panel"><div className="data-header symbol-header"><span>Symbol</span><span>Type</span><span>File</span><span>Line</span><span>Reach</span></div>{symbols.map((symbol) => { const referenceCount = analysis.references.filter((reference) => reference.symbolId === symbol.id).length; return <button key={symbol.id} className="data-row symbol-row" onClick={() => onSelectSymbol(symbol)}><span className="path-cell"><span className="symbol-type-icon">{symbol.type === 'function' ? 'ƒ' : symbol.type === 'class' ? '◇' : '∷'}</span><strong>{symbol.name}</strong>{symbol.exported && <span className="export-badge">exported</span>}</span><span><Pill tone={symbol.type === 'function' ? 'green' : 'purple'}>{symbol.type}</Pill></span><span className="muted mono">{shortPath(symbol.filePath, 30)}</span><span className="muted">:{symbol.line}</span><span className="muted">{referenceCount} refs</span></button> })}{!symbols.length && <div className="empty-table"><span>ƒ</span><strong>No symbols match “{query}”</strong><p>Try a symbol name or source path.</p></div>}</section></div>;
}

function EntryPointsView({ analysis, onNavigate, onSelect }: { analysis: RepositoryAnalysis; onNavigate: (view: ViewKey) => void; onSelect: (id: string) => void }) {
   return <div className="page entry-points-page"><div className="page-header compact-header"><div><div className="eyebrow">ENTRY POINTS</div><h1>Find where the app starts.</h1><p>These files are likely runtime starting points based on project files, naming, and imports.</p></div><div className="header-stat"><span>Status</span><strong>{analysis.entryPoints.length ? 'Ready' : 'Needs review'}</strong></div></div><div className="entry-explanation"><BrandIcon className="explanation-icon" /><div><strong>How this works</strong><p>Each file is ranked using project configuration, common file names, and connections to other files.</p></div><Pill tone="green">Local analysis</Pill></div><div className="entry-point-grid">{analysis.entryPoints.map((entry, index) => <article key={entry.id} className="entry-point-card"><div className="entry-point-top"><span className="entry-rank">0{index + 1}</span><Pill tone={entry.confidence === 'High' ? 'green' : entry.confidence === 'Likely' ? 'blue' : 'amber'}>{entry.confidence}</Pill></div><h2>{entry.name}</h2><code>{entry.path}</code><p>{entry.type} found using:</p><ul>{entry.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><div className="entry-point-actions"><button className="secondary-button" onClick={() => { onSelect(entry.nodeId); onNavigate('architecture'); }}>Show on map</button><button className="quiet-button" onClick={() => { onSelect(entry.nodeId); onNavigate('files'); }}>Open source ↗</button></div></article>)}{!analysis.entryPoints.length && <div className="empty-state-card"><span>◎</span><h2>No entry points found.</h2><p>Open the architecture map to inspect the most connected modules and find a likely application start.</p><button className="primary-button" onClick={() => onNavigate('architecture')}>Open map</button></div>}</div></div>;
}

function CommandPalette({ results, open, query, filter, onFilterChange, onQueryChange, onClose, onSelect, onImport }: { results: SearchResult[]; open: boolean; query: string; filter: SearchFilter; onFilterChange: (filter: SearchFilter) => void; onQueryChange: (value: string) => void; onClose: () => void; onSelect: (result: SearchResult) => void; onImport: () => void }) {
  if (!open) return null;
  const filters: Array<{ id: SearchFilter; label: string }> = [{ id: 'all', label: 'All' }, { id: 'file', label: 'Files' }, { id: 'symbol', label: 'Symbols' }, { id: 'entry', label: 'Entries' }, { id: 'module', label: 'Modules' }, { id: 'warning', label: 'Warnings' }, { id: 'relationship', label: 'Links' }];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Search RepoLens"><div className="palette-search"><span aria-hidden="true">⌕</span><input autoFocus aria-label="Search files, symbols, or actions" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search files, symbols, modules, or warnings…" /><kbd>ESC</kbd><button type="button" className="icon-button palette-close" aria-label="Close search" title="Close search" onClick={onClose}>×</button></div><div className="palette-filters" aria-label="Search filters">{filters.map((item) => <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => onFilterChange(item.id)}>{item.label}</button>)}</div><div className="palette-results">{!query && <div className="palette-section-label">ACTIONS</div>}{!query && <button className="palette-action" onClick={onImport}><span className="palette-icon">＋</span><span><strong>Import another repository</strong><small>Choose a local folder or ZIP</small></span><kbd>↵</kbd></button>}{!query && <div className="palette-section-label">RESULTS</div>}{results.slice(0, 10).map((result) => <button key={result.id} className="palette-result" onClick={() => onSelect(result)}><span className={`palette-kind palette-kind-${result.kind}`}>{result.kind === 'symbol' ? 'ƒ' : result.kind === 'entry' ? '↳' : result.kind === 'warning' ? '!' : result.kind === 'module' ? '◈' : result.kind === 'relationship' ? '→' : '▤'}</span><span><strong>{result.title}</strong><small>{result.subtitle}</small></span><span className="palette-arrow">↵</span></button>)}{query && !results.length && <div className="palette-empty"><span>⌕</span><strong>No results</strong><p>Try a file path, symbol name, module, or warning.</p></div>}</div><div className="palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>ESC</kbd> close</span></div></section></div>;
}

function ImportOverlay({ importing, message, error, onClose, onImport }: { importing: boolean; message: string; error: string | null; onClose: () => void; onImport: () => void }) {
  if (!importing && !error) return null;
  return <div className="modal-backdrop"><section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">{importing ? <><div className="indexing-orb"><BrandIcon /></div><div className="eyebrow">INDEXING REPOSITORY</div><h2 id="import-title">Reading the repository…</h2><p>{message}</p><div className="progress-track"><span /></div><div className="indexing-steps"><span className="complete">✓ Reading source files</span><span className="active">→ Resolving imports and symbols</span><span>○ Finding entry points</span></div></> : <><div className="error-orb">!</div><div className="eyebrow">IMPORT FAILED</div><h2 id="import-title">This repository could not be indexed.</h2><p>{error}</p><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Keep current map</button><button className="primary-button" onClick={onImport}>Try again</button></div></>}</section></div>;
}

function SourceDialog({ analysis, target, onClose }: { analysis: RepositoryAnalysis; target: { path: string; line: number } | null; onClose: () => void }) {
  if (!target) return null;
  const file = analysis.files.find((candidate) => candidate.path === target.path);
  if (!file) return null;
  const lines = file.content.split(/\r?\n/);
  const line = Math.min(Math.max(target.line, 1), Math.max(lines.length, 1));
  const start = Math.max(0, line - 4);
  const end = Math.min(lines.length, line + 4);
  return <div className="modal-backdrop source-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="source-dialog" role="dialog" aria-modal="true" aria-label="Source code" aria-labelledby="source-dialog-title"><div className="source-dialog-heading"><div><div className="eyebrow">SOURCE</div><h2 id="source-dialog-title">{shortPath(file.path, 58)}</h2><p>Line {line} of {lines.length}</p></div><button className="icon-button" aria-label="Close source" title="Close source" onClick={onClose}>×</button></div><pre className="source-dialog-code"><code>{lines.slice(start, end).map((sourceLine, index) => { const lineNumber = start + index + 1; return <span key={lineNumber} className={lineNumber === line ? 'source-line-active' : ''}><b>{String(lineNumber).padStart(4, ' ')}</b>{sourceLine || ' '}{'\n'}</span>; })}</code></pre><div className="dialog-actions"><button className="secondary-button" onClick={onClose}>Close</button></div></section></div>;
}

function RecentRepositoryMenu({ repositories, projects, onLoad, onLoadProject, onSaveProject, onDeleteProject, onClose }: { repositories: RecentRepository[]; projects: SavedProject[]; onLoad: (repository: RecentRepository) => void; onLoadProject: (project: SavedProject) => void; onSaveProject: () => void; onDeleteProject: (id: string) => void; onClose: () => void }) {
  return <div className="repository-history-menu" role="dialog" aria-label="Recent repositories"><div className="repository-history-heading"><strong>Projects</strong><button className="icon-button" aria-label="Close recent repositories" onClick={onClose}>×</button></div><button className="project-save-button" onClick={onSaveProject}>＋ Save current project</button><div className="project-menu-label">SAVED PROJECTS</div>{projects.length ? projects.map((project) => <div key={project.id} className="saved-project-item"><button className="repository-history-item" onClick={() => onLoadProject(project)}><span className="project-dot" /><span><strong>{project.name}</strong><small>{project.files.length} files · saved locally</small></span><span>→</span></button><button className="project-delete-button" aria-label={`Delete saved project ${project.name}`} onClick={() => onDeleteProject(project.id)}>×</button></div>) : <p className="muted">Save a project to reopen its indexed files and metadata later.</p>}<div className="project-menu-label">RECENT IMPORTS</div>{repositories.length ? repositories.map((repository) => <button key={`${repository.name}:${repository.importedAt}`} className="repository-history-item" onClick={() => onLoad(repository)}><span className="project-dot" /><span><strong>{repository.name}</strong><small>{repository.files.length} files</small></span><span>→</span></button>) : <p className="muted">Imported repositories will appear here.</p>}</div>;
}

interface AppProps {
  initialAnalysis?: RepositoryAnalysis;
}

export default function App({ initialAnalysis: providedInitialAnalysis }: AppProps = {}) {
  const emptyAnalysis = useMemo(() => analyzeRepository([], 'No repository selected'), []);
  const initialAnalysis = providedInitialAnalysis ?? emptyAnalysis;
  const [analysis, setAnalysis] = useState<RepositoryAnalysis>(initialAnalysis);
  const [view, setView] = useState<ViewKey>('overview');
  const [selectedId, setSelectedId] = useState<string | null>(() => bestSelection(initialAnalysis));
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteFilter, setPaletteFilter] = useState<SearchFilter>('all');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(() => isOnboardingComplete());
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('Scanning files and preparing a local index…');
  const [importError, setImportError] = useState<string | null>(null);
  const [snapshotDiff, setSnapshotDiff] = useState<SnapshotDiff | null>(null);
  const [comparisonLabel, setComparisonLabel] = useState<string | undefined>();
  const [snapshots, setSnapshots] = useState<RepositorySnapshot[]>(() => loadSnapshots());
  const [mapChangeFilter, setMapChangeFilter] = useState<'all' | 'changed'>('all');
  const [sourceTarget, setSourceTarget] = useState<{ path: string; line: number } | null>(null);
  const [recentRepositories, setRecentRepositories] = useState<RecentRepository[]>(() => loadRecentRepositories());
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>(() => loadSavedProjects());
  const [annotations, setAnnotations] = useState<MapAnnotation[]>(() => loadAnnotations());
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setPaletteQuery('');
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const paletteResults = useMemo<SearchResult[]>(() => buildSearchResults(analysis, paletteQuery, paletteFilter), [analysis, paletteFilter, paletteQuery]);

  const handleNavigate = (nextView: ViewKey) => {
    setView(nextView);
    setSearchQuery('');
  };

  const handleSelect = (id: string) => {
    setSelectedId(id || null);
    setSelectedSymbolId(null);
  };

  const handleSelectSymbol = (symbol: SymbolInfo) => {
    setSelectedId(`file:${symbol.filePath}`);
    setSelectedSymbolId(symbol.id);
  };

  const handleOpenSource = (path: string, line = 1) => {
    setSourceTarget({ path, line });
  };

  const handleSaveSnapshot = () => {
    setSnapshots(saveSnapshot(analysis.name, analysis.files));
  };

  const handleExportReport = (format: 'markdown' | 'json') => {
    const fileBase = `repolens-${safeFileName(analysis.name)}-architecture-report`;
    if (format === 'json') downloadTextFile(`${fileBase}.json`, buildArchitectureReportJson(analysis), 'application/json');
    else downloadTextFile(`${fileBase}.md`, buildArchitectureReport(analysis), 'text/markdown');
  };

  const handleDismissOnboarding = () => {
    completeOnboarding();
    setOnboardingComplete(true);
  };

  const handleSaveProject = () => {
    setSavedProjects(saveProject(analysis.name, analysis.files));
  };

  const handleSaveAnnotation = (annotation: { id?: string; nodeId: string; text: string; color: MapAnnotation['color'] }) => {
    setAnnotations(saveAnnotation(annotation));
  };

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations(deleteAnnotation(id));
  };

  const handleSelectHealth = (nodeId: string) => {
    handleSelect(nodeId);
    handleNavigate('architecture');
  };

  const handleCompareSnapshots = async (beforeId: string, afterId: string) => {
    const before = snapshots.find((snapshot) => snapshot.id === beforeId);
    const after = snapshots.find((snapshot) => snapshot.id === afterId);
    if (!before || !after) return;
    setImportError(null);
    setImporting(true);
    setImportMessage(`Comparing ${before.name} with ${after.name}…`);
    try {
      const beforeAnalysis = await analyzeRepositoryAsync(before.files, before.name, setImportMessage);
      const afterAnalysis = await analyzeRepositoryAsync(after.files, after.name, setImportMessage);
      setSnapshotDiff(compareAnalyses(beforeAnalysis, afterAnalysis));
      setComparisonLabel(`${before.name} → ${after.name}`);
      setMapChangeFilter('all');
      setView('overview');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The snapshots could not be compared.');
    } finally {
      setImporting(false);
    }
  };

  const openImport = () => {
    setImportError(null);
    const input = fileInputRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.click();
  };

  const handleFileImport = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setPaletteOpen(false);
    setImportError(null);
    setImporting(true);
    try {
      const files = Array.from(fileList);
      const entries: Array<{ path: string; content: string }> = [];
      let ignoredFileCount = 0;
      for (const file of files) {
        if (file.name.toLowerCase().endsWith('.zip')) {
          setImportMessage(`Unpacking ${file.name} locally…`);
          const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
          Object.entries(archive).forEach(([path, bytes]) => {
            if (isIgnoredImportPath(path)) {
              if (!path.endsWith('/')) ignoredFileCount += 1;
              return;
            }
            if (!path.endsWith('/') && !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|lockb)$/i.test(path)) entries.push({ path, content: strFromU8(bytes) });
          });
        } else if (!/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|exe|dylib|so|dll|zip)$/i.test(file.name)) {
          const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          if (isIgnoredImportPath(relativePath)) {
            ignoredFileCount += 1;
            continue;
          }
          entries.push({ path: relativePath, content: await file.text() });
        }
      }
      if (!entries.length) throw new Error('No readable source files were found. Choose a source folder or a ZIP containing text files.');
       setImportMessage(`Indexed ${formatNumber(entries.length)} readable files${ignoredFileCount ? `; skipped ${formatNumber(ignoredFileCount)} files in ignored folders` : ''}. Creating the architecture map…`);
       await new Promise((resolve) => window.setTimeout(resolve, 120));
      const firstPath = entries[0].path.split('/')[0];
       const repositoryName = files.length === 1 && files[0].name.endsWith('.zip') ? files[0].name.replace(/\.zip$/i, '') : firstPath || 'local-repository';
       const repositoryFiles = repositoryFilesFromEntries(entries);
        const nextAnalysis = await analyzeRepositoryAsync(repositoryFiles, repositoryName, setImportMessage);
        setRecentRepositories(rememberRepository(repositoryName, repositoryFiles));
        saveSnapshot(analysis.name, analysis.files);
        setSnapshots(saveSnapshot(nextAnalysis.name, nextAnalysis.files));
        setSavedProjects(saveProject(nextAnalysis.name, nextAnalysis.files));
       setSnapshotDiff(compareAnalyses(analysis, nextAnalysis));
       setComparisonLabel(undefined);
       setAnalysis(nextAnalysis);
        setSelectedId(bestSelection(nextAnalysis));
        setSelectedSymbolId(null);
        setView('overview');
        completeOnboarding();
        setOnboardingComplete(true);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The repository could not be read.');
    } finally {
      setImporting(false);
    }
  };

  const handleLoadRecentRepository = (repository: RecentRepository) => {
    const nextAnalysis = analyzeRepository(repository.files, repository.name);
    saveSnapshot(analysis.name, analysis.files);
    setSnapshots(saveSnapshot(nextAnalysis.name, nextAnalysis.files));
    setSavedProjects(saveProject(nextAnalysis.name, nextAnalysis.files));
    setSnapshotDiff(compareAnalyses(analysis, nextAnalysis));
    setComparisonLabel(undefined);
    setAnalysis(nextAnalysis);
    setSelectedId(bestSelection(nextAnalysis));
    setSelectedSymbolId(null);
    setView('overview');
    completeOnboarding();
    setOnboardingComplete(true);
    setHistoryOpen(false);
  };

  const handleLoadSavedProject = async (project: SavedProject) => {
    setHistoryOpen(false);
    setImportError(null);
    setImporting(true);
    setImportMessage(`Opening ${project.name}…`);
    try {
      const nextAnalysis = await analyzeRepositoryAsync(project.files, project.name, setImportMessage);
      setSavedProjects(touchProject(project.id));
      setAnalysis(nextAnalysis);
      setSelectedId(bestSelection(nextAnalysis));
      setSelectedSymbolId(null);
      setSnapshotDiff(null);
      setView('overview');
      completeOnboarding();
      setOnboardingComplete(true);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The saved project could not be opened.');
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteProject = (id: string) => {
    setSavedProjects(deleteProject(id));
  };

  const handlePaletteSelect = (result: SearchResult) => {
    if (result.kind === 'symbol') {
      const symbol = analysis.symbols.find((candidate) => candidate.id === result.id);
      if (symbol) handleSelectSymbol(symbol);
      else setSelectedId(result.nodeId);
    } else {
      setSelectedId(result.nodeId);
      setSelectedSymbolId(null);
    }
    setView(result.kind === 'symbol' ? 'symbols' : result.kind === 'file' ? 'files' : 'architecture');
    setPaletteOpen(false);
    setPaletteQuery('');
    setPaletteFilter('all');
  };

  const dependencyReport = useMemo(() => reportTargetId ? buildDependencyReport(analysis, reportTargetId) ?? null : null, [analysis, reportTargetId]);

  const content = view === 'overview'
    ? <OverviewView analysis={analysis} diff={snapshotDiff} snapshots={snapshots} comparisonLabel={comparisonLabel} showOnboarding={!onboardingComplete} onNavigate={handleNavigate} onSelect={handleSelect} onInspectChanges={() => { setMapChangeFilter('changed'); handleNavigate('architecture'); }} onDismissDiff={() => setSnapshotDiff(null)} onSaveSnapshot={handleSaveSnapshot} onCompareSnapshots={handleCompareSnapshots} onSelectHealth={handleSelectHealth} onImport={openImport} onDismissOnboarding={handleDismissOnboarding} onExportReport={handleExportReport} />
    : view === 'architecture'
      ? <ArchitectureView analysis={analysis} selectedId={selectedId} onSelect={handleSelect} diff={snapshotDiff} changeFilter={mapChangeFilter} onChangeFilter={setMapChangeFilter} performanceMode={isLargeRepository(analysis)} annotations={annotations} />
      : view === 'files'
        ? <FilesView analysis={analysis} query={searchQuery} onQueryChange={setSearchQuery} onSelect={handleSelect} />
        : view === 'symbols'
          ? <SymbolsView analysis={analysis} query={searchQuery} onQueryChange={setSearchQuery} onSelectSymbol={handleSelectSymbol} />
          : <EntryPointsView analysis={analysis} onNavigate={handleNavigate} onSelect={handleSelect} />;

  return <div className={`app-shell ${isTauri() ? 'desktop-app' : 'web-app'}`}>
     <WindowChrome />
     <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className="topbar">
       <div className="brand-lockup"><BrandIcon className="brand-mark" /><span className="brand-name">RepoLens</span><span className="brand-divider">/</span><span className="brand-context">Repository map</span></div>
       <div className="topbar-center"><button className="project-pill" onClick={() => setHistoryOpen((value) => !value)}><span className="project-dot" />{analysis.name}<span className="chevron">⌄</span></button><button className="global-search-button" onClick={() => setPaletteOpen(true)}><span>⌕</span><span>Search files, symbols, or actions…</span><kbd>⌘ K</kbd></button>{historyOpen && <RecentRepositoryMenu repositories={recentRepositories} projects={savedProjects} onLoad={handleLoadRecentRepository} onLoadProject={handleLoadSavedProject} onSaveProject={handleSaveProject} onDeleteProject={handleDeleteProject} onClose={() => setHistoryOpen(false)} />}</div>
      <div className="topbar-actions"><button className="icon-button" aria-label="Toggle theme" title="Toggle light/dark theme" onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼' : '◐'}</button><button className="import-button" onClick={openImport}><span>＋</span> Import repository</button></div>
    </header>
     <div className="app-body">
        <aside className="sidebar"><div className="sidebar-scroll"><div className="sidebar-label">WORKSPACE</div><button className="workspace-card" onClick={() => handleNavigate('overview')}><span className="workspace-icon">⌂</span><span><strong>{analysis.name}</strong><small>{formatNumber(analysis.metrics.files)} files indexed</small></span><span className="workspace-menu">⋯</span></button><nav className="primary-nav" aria-label="Primary navigation">{NAV_ITEMS.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} aria-label={item.label} aria-current={view === item.id ? 'page' : undefined} onClick={() => handleNavigate(item.id)}><span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>{item.hint && <kbd aria-hidden="true">{item.hint}</kbd>}</button>)}</nav><div className="sidebar-label sidebar-label-spaced">TOOLS</div><button className="nav-item" aria-label="Search" onClick={() => setPaletteOpen(true)}><span className="nav-icon" aria-hidden="true">⌕</span><span>Search</span><kbd aria-hidden="true">⌘K</kbd></button><button className="nav-item" aria-label="Saved views" onClick={() => handleNavigate('architecture')}><span className="nav-icon" aria-hidden="true">☆</span><span>Saved views</span></button></div><div className="sidebar-footer"><div className="analysis-status" aria-live="polite"><span className="status-check" aria-hidden="true">✓</span><span><strong>Index ready</strong><small>Stored on this device · just now</small></span></div><button className="help-button" aria-haspopup="dialog" onClick={() => setHelpOpen(true)}><span aria-hidden="true">?</span> Keyboard shortcuts</button></div></aside>
        <main id="main-content" key={view} className="main-content" aria-label="RepoLens workspace">{content}</main>
         <Inspector analysis={analysis} selectedId={selectedId} selectedSymbolId={selectedSymbolId} annotations={annotations} onNavigate={handleNavigate} onSelect={handleSelect} onSelectSymbol={handleSelectSymbol} onOpenSource={handleOpenSource} onSaveAnnotation={handleSaveAnnotation} onDeleteAnnotation={handleDeleteAnnotation} onOpenReport={setReportTargetId} />
    </div>
    <input ref={fileInputRef} className="visually-hidden" type="file" multiple onChange={(event) => { void handleFileImport(event.target.files); event.target.value = ''; }} />
     <CommandPalette open={paletteOpen} query={paletteQuery} filter={paletteFilter} onFilterChange={setPaletteFilter} results={paletteResults} onQueryChange={setPaletteQuery} onClose={() => { setPaletteOpen(false); setPaletteQuery(''); setPaletteFilter('all'); }} onSelect={handlePaletteSelect} onImport={() => { setPaletteOpen(false); setPaletteQuery(''); setPaletteFilter('all'); openImport(); }} />
      <ImportOverlay importing={importing} message={importMessage} error={importError} onClose={() => setImportError(null)} onImport={openImport} />
      <SourceDialog analysis={analysis} target={sourceTarget} onClose={() => setSourceTarget(null)} />
      <DependencyReportDialog report={dependencyReport} onClose={() => setReportTargetId(null)} />
      {helpOpen && <KeyboardShortcutsDialog onClose={() => setHelpOpen(false)} />}
   </div>;
}
