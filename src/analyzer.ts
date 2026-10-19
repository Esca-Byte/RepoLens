import type {
  EntryPoint,
  EntryPointConfidence,
  GraphEdge,
  GraphNode,
  Language,
  ModuleInfo,
  RepositoryAnalysis,
  RepositoryFile,
  SymbolReference,
  SymbolInfo,
} from './types';
import { languageForPath } from './sampleRepository';
import { analyzeGitMetadata } from './gitMetadata';

const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'vendor']);
const IMPORT_IGNORED_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', 'vendor']);
const SOURCE_LANGUAGES = new Set<Language>(['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C#', 'PHP', 'Kotlin', 'Swift', 'C', 'C++']);

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\//, '');
}

function hasIgnoredSegment(path: string, ignoredSegments: Set<string>): boolean {
  return normalizePath(path).split('/').some((segment) => ignoredSegments.has(segment));
}

export function isIgnoredImportPath(path: string): boolean {
  return hasIgnoredSegment(path, IMPORT_IGNORED_SEGMENTS);
}

function modulePath(path: string): string {
  const segments = normalizePath(path).split('/');
  if (segments.length === 1) return 'root';
  if (segments[0] === 'src' && segments.length > 2) return segments.slice(0, 2).join('/');
  return segments.slice(0, -1).join('/') || 'root';
}

function displayName(path: string): string {
  if (path === 'root') return 'Root';
  const last = path.split('/').pop() ?? path;
  return last
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function fileId(path: string): string {
  return `file:${path}`;
}

function moduleId(path: string): string {
  return `module:${path}`;
}

function toLanguageCounts(files: RepositoryFile[]): { name: Language; count: number }[] {
  const counts = new Map<Language, number>();
  files.forEach((file) => counts.set(file.language, (counts.get(file.language) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

function parseSymbols(file: RepositoryFile): SymbolInfo[] {
  if (!SOURCE_LANGUAGES.has(file.language)) return [];
  const symbols: SymbolInfo[] = [];
  const lines = file.content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const exported = /^(?:export\s+|pub\s+|public\s+)/.test(trimmed);
    const declaration = trimmed.replace(/^(?:export\s+default\s+|export\s+|pub\s+|public\s+)/, '');
    const patterns: Array<{ regex: RegExp; type: SymbolInfo['type'] }> = [
      { regex: /^(?:async\s+)?function\s+([\w$]+)/, type: 'function' },
      { regex: /^class\s+([\w$]+)/, type: 'class' },
      { regex: /^(?:interface)\s+([\w$]+)/, type: 'interface' },
      { regex: /^(?:type)\s+([\w$]+)/, type: 'type' },
      { regex: /^(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=/, type: 'constant' },
      { regex: /^def\s+([\w$]+)/, type: 'function' },
      { regex: /^func\s+(?:\([^)]*\)\s+)?([\w$]+)/, type: 'function' },
      { regex: /^fn\s+([\w$]+)/, type: 'function' },
      { regex: /^struct\s+([\w$]+)/, type: 'class' },
      { regex: /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+)*(?:class|record|enum|struct)\s+([\w$]+)/, type: 'class' },
      { regex: /^(?:public\s+|private\s+|protected\s+|sealed\s+)*(?:interface|protocol)\s+([\w$]+)/, type: 'interface' },
      { regex: /^(?:public\s+|private\s+|protected\s+|static\s+|suspend\s+)*(?:async\s+)?(?:fun|func)\s+([\w$]+)/, type: 'function' },
      { regex: /^(?:public\s+|private\s+|protected\s+|static\s+)*(?:[\w<>\[\],?]+\s+)+([\w$]+)\s*\([^;]*\)\s*(?:\{|$)/, type: 'method' },
      { regex: /^(?:[\w:*&<>]+\s+)+([\w$]+)\s*\([^;]*\)\s*(?:\{|$)/, type: 'function' },
    ];
    const match = patterns.find(({ regex }) => regex.test(declaration));
    if (!match) return;
    const name = declaration.match(match.regex)?.[1];
    if (!name) return;
    symbols.push({
      id: `symbol:${file.path}:${index + 1}:${name}`,
      name,
      type: match.type,
      filePath: file.path,
      line: index + 1,
      exported,
      signature: trimmed.replace(/\s+/g, ' ').slice(0, 100),
    });
  });
  return symbols;
}

function importedSpecifiers(file: RepositoryFile): string[] {
  const sources: string[] = [];
  file.content.split(/\r?\n/).forEach((line) => {
    const jsMatch = line.match(/(?:from\s+|import\s*\(|require\s*\()(['"])([^'"]+)\1/);
    if (jsMatch?.[2]) sources.push(jsMatch[2]);
    if (file.language === 'Python') {
      const pythonMatch = line.match(/^\s*(?:from|import)\s+([\w./-]+)/);
      if (pythonMatch?.[1] && !sources.includes(pythonMatch[1])) sources.push(pythonMatch[1]);
    }
    if (file.language === 'Rust') {
      const rustMatch = line.match(/^\s*(?:use|mod)\s+([\w:]+)/);
      if (rustMatch?.[1] && !sources.includes(rustMatch[1])) sources.push(rustMatch[1]);
    }
    if (file.language === 'Java' || file.language === 'Kotlin') {
      const javaMatch = line.match(/^\s*import\s+([\w.]+)/);
      if (javaMatch?.[1]) sources.push(javaMatch[1]);
    }
    if (file.language === 'C#') {
      const usingMatch = line.match(/^\s*using\s+([\w.]+)/);
      if (usingMatch?.[1]) sources.push(usingMatch[1]);
    }
  });
  return sources;
}

function pathVariants(candidate: string, language: Language): string[] {
  const clean = candidate.replace(/\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|php|kts?|swift|c|h|cc|cpp|cxx|hpp)$/, '');
  const extensions = language === 'TypeScript'
    ? ['.ts', '.tsx', '.js', '.jsx']
    : language === 'Python'
      ? ['.py']
      : language === 'Go'
        ? ['.go']
        : language === 'Rust'
          ? ['.rs']
          : language === 'Java'
            ? ['.java']
            : language === 'C#'
              ? ['.cs']
              : language === 'PHP'
                ? ['.php']
                : language === 'Kotlin'
                  ? ['.kt', '.kts']
                  : language === 'Swift'
                    ? ['.swift']
                    : language === 'C'
                      ? ['.c', '.h']
                      : language === 'C++'
                        ? ['.cc', '.cpp', '.cxx', '.hpp']
                        : ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.php', '.kt', '.swift', '.c', '.h', '.cpp'];
  return [candidate, ...extensions.map((extension) => `${clean}${extension}`), ...extensions.map((extension) => `${clean}/index${extension}`)];
}

function resolveImport(source: string, fromPath: string, filePaths: Set<string>, language: Language): string | undefined {
  if (!source.startsWith('.') && !source.startsWith('/')) {
    const sourcePath = source.replace(/::/g, '/');
    for (const path of filePaths) {
      if (path === sourcePath || path.endsWith(`/${sourcePath}`)) return path;
    }
    return undefined;
  }
  const directory = normalizePath(fromPath).split('/').slice(0, -1);
  const parts = [...directory, ...source.split('/')];
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  for (const candidate of pathVariants(resolved.join('/'), language)) {
    if (filePaths.has(candidate)) return candidate;
  }
  return undefined;
}

interface ImportedBinding {
  importedName: string;
  resolvedPath?: string;
}

function importedBindings(file: RepositoryFile, filePaths: Set<string>): Map<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>();
  file.content.split(/\r?\n/).forEach((line) => {
    const importMatch = line.match(/^\s*import\s+(.+?)\s+from\s+['"]([^'"]+)['"]/);
    const exportMatch = line.match(/^\s*export\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);
    const match = importMatch ?? exportMatch;
    if (match) {
      const clause = match[1].trim();
      const resolvedPath = resolveImport(match[2], file.path, filePaths, file.language);
      if (clause.startsWith('{')) {
        clause.replace(/^\{|\}$/g, '').split(',').forEach((part) => {
          const [importedName, localName] = part.trim().split(/\s+as\s+/);
          if (importedName) bindings.set((localName ?? importedName).trim(), { importedName: importedName.trim(), resolvedPath });
        });
      } else if (clause.startsWith('* as ')) {
        bindings.set(clause.slice(5).trim(), { importedName: '*', resolvedPath });
      } else {
        const defaultName = clause.split(',')[0]?.trim();
        if (defaultName && /^[\w$]+$/.test(defaultName)) bindings.set(defaultName, { importedName: 'default', resolvedPath });
      }
    }
    const requireMatch = line.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) {
      bindings.set(requireMatch[1], {
        importedName: 'default',
        resolvedPath: resolveImport(requireMatch[2], file.path, filePaths, file.language),
      });
    }
  });
  return bindings;
}

function referenceRole(line: string, token: string, tokenEnd: number): SymbolReference['role'] {
  const trimmed = line.trim();
  if (/^(?:import|export)\b/.test(trimmed) || /\brequire\s*\(/.test(trimmed)) return 'import';
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(?:^|\\b)(?:type|interface|implements|extends|new)\\s+${escaped}\\b`).test(trimmed) || new RegExp(`:\\s*${escaped}\\b`).test(trimmed)) return 'type';
  return line.slice(tokenEnd).trimStart().startsWith('(') ? 'call' : 'read';
}

function parseReferences(files: RepositoryFile[], symbols: SymbolInfo[], filePaths: Set<string>): SymbolReference[] {
  const byName = new Map<string, SymbolInfo[]>();
  const byFileAndName = new Map<string, SymbolInfo>();
  symbols.forEach((symbol) => {
    const candidates = byName.get(symbol.name) ?? [];
    candidates.push(symbol);
    byName.set(symbol.name, candidates);
    byFileAndName.set(`${symbol.filePath}:${symbol.name}`, symbol);
  });
  const references: SymbolReference[] = [];
  const counts = new Map<string, number>();
  const maxReferences = Math.max(4000, symbols.length * 80);

  files.forEach((file) => {
    const bindings = importedBindings(file, filePaths);
    file.content.split(/\r?\n/).forEach((line, lineIndex) => {
      const trimmed = line.trim();
      if (!trimmed || /^(?:\/\/|#|\/\*|\*)/.test(trimmed) || references.length >= maxReferences) return;
      const lineNumber = lineIndex + 1;
      for (const match of line.matchAll(/\b[$A-Za-z_][$\w]*\b/g)) {
        const name = match[0];
        const candidates = byName.get(name);
        if (!candidates?.length) continue;
        const declaration = byFileAndName.get(`${file.path}:${name}`);
        if (declaration?.line === lineNumber) continue;
        const binding = bindings.get(name);
        let target = binding?.resolvedPath
          ? candidates.find((candidate) => candidate.filePath === binding.resolvedPath && (binding.importedName === '*' || binding.importedName === 'default' || candidate.name === binding.importedName))
          : undefined;
        target ??= candidates.find((candidate) => candidate.filePath === file.path);
        if (!target && candidates.length === 1) target = candidates[0];
        if (!target && candidates.filter((candidate) => candidate.exported).length === 1) target = candidates.find((candidate) => candidate.exported);
        if (!target || target.line === lineNumber && target.filePath === file.path) continue;
        const count = counts.get(target.id) ?? 0;
        if (count >= 200) continue;
        const tokenEnd = (match.index ?? 0) + name.length;
        references.push({
          id: `reference:${file.path}:${lineNumber}:${match.index ?? 0}:${name}:${target.id}`,
          symbolId: target.id,
          name: target.name,
          filePath: file.path,
          line: lineNumber,
          role: referenceRole(line, name, tokenEnd),
          context: trimmed.replace(/\s+/g, ' ').slice(0, 160),
        });
        counts.set(target.id, count + 1);
      }
    });
  });
  return references;
}

function externalLabel(source: string): string {
  const cleaned = source.replace(/^@([^/]+)\//, '@$1/').split('/');
  return cleaned.length > 1 && cleaned[0].startsWith('@') ? `${cleaned[0]}/${cleaned[1]}` : cleaned[0];
}

interface CandidateEntry {
  path: string;
  name: string;
  type: string;
  score: number;
  reasons: string[];
}

function detectEntryPoints(files: RepositoryFile[], filePaths: Set<string>): EntryPoint[] {
  const candidates = new Map<string, CandidateEntry>();
  const add = (path: string, name: string, type: string, score: number, reason: string) => {
    if (!filePaths.has(path)) return;
    const current = candidates.get(path) ?? { path, name, type, score: 0, reasons: [] };
    if (score >= current.score) {
      current.name = name;
      current.type = type;
    }
    current.score = Math.max(current.score, score);
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    candidates.set(path, current);
  };
  const packageFile = files.find((file) => file.path === 'package.json');
  if (packageFile) {
    try {
      const manifest = JSON.parse(packageFile.content) as { main?: string; bin?: string | Record<string, string>; scripts?: Record<string, string> };
      if (manifest.main) {
        const resolved = resolveImport(manifest.main, 'package.json', filePaths, 'TypeScript');
        if (resolved) add(resolved, `${displayName(resolved)} entry`, 'Package entry', 100, `Declared as main in package.json`);
      }
      if (typeof manifest.bin === 'string') {
        const resolved = resolveImport(manifest.bin, 'package.json', filePaths, 'TypeScript');
        if (resolved) add(resolved, 'CLI entry', 'CLI', 95, `Declared as bin in package.json`);
      } else if (manifest.bin) {
        Object.values(manifest.bin).forEach((path) => {
          const resolved = resolveImport(path, 'package.json', filePaths, 'TypeScript');
          if (resolved) add(resolved, 'CLI entry', 'CLI', 95, `Declared as bin in package.json`);
        });
      }
      Object.entries(manifest.scripts ?? {}).forEach(([script, command]) => {
        const pathMatch = command.match(/((?:src|app|server|bin|cmd)\/[^\s"']+)/);
        if (!pathMatch) return;
        const resolved = resolveImport(pathMatch[1], 'package.json', filePaths, 'TypeScript');
        if (resolved) add(resolved, `${script} script`, script === 'dev' || script === 'start' ? 'Runtime' : 'Script', 85, `Referenced by the ${script} script`);
      });
    } catch {
      // A malformed manifest should not prevent the rest of the repository from loading.
    }
  }
  files.forEach((file) => {
    if (!SOURCE_LANGUAGES.has(file.language) || /(^|\/)(test|tests|__tests__)(\/|\.)|\.test\.|\.spec\./i.test(file.path)) return;
    const lower = file.path.toLowerCase();
    const hasRuntimeCall = /\b(?:listen|createServer|serve)\s*\(/.test(file.content);
    const hasMainGuard = /if\s+__name__\s*==\s*["']__main__["']|func\s+main\s*\(|fn\s+main\s*\(/.test(file.content);
    if (hasRuntimeCall) add(file.path, 'Server bootstrap', 'HTTP server', 82, 'Starts a server or listener');
    if (hasMainGuard) add(file.path, 'Program main', 'Runtime', 90, 'Defines a language-level main function');
    if (/(^|\/)(server|app|bootstrap|worker|cli)\.[^.]+$/.test(lower)) add(file.path, displayName(file.path.split('/').pop() ?? file.path), 'Runtime', 68, 'Matches a conventional runtime filename');
    if (/(^|\/)index\.[^.]+$/.test(lower)) add(file.path, 'Index module', 'Module entry', 55, 'Matches a conventional index module');
  });
  const confidence = (score: number): EntryPointConfidence => score >= 90 ? 'High' : score >= 65 ? 'Likely' : 'Possible';
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 12)
    .map((candidate, index) => ({
      id: `entry:${candidate.path}`,
      name: candidate.name,
      path: candidate.path,
      type: candidate.type,
      confidence: confidence(candidate.score),
      score: candidate.score,
      reasons: candidate.reasons,
      nodeId: fileId(candidate.path),
    }))
    .map((entry, index) => index === 0 ? { ...entry, confidence: 'High' as const } : entry);
}

function describeModule(path: string, files: RepositoryFile[]): string {
  const names = files.map((file) => file.path.split('/').pop()?.split('.')[0]).filter(Boolean).slice(0, 3);
  return names.length ? `${names.join(', ')}${files.length > names.length ? ', and more' : ''}` : 'Repository root files';
}

export function analyzeRepository(inputFiles: RepositoryFile[], repositoryName = 'local-repository'): RepositoryAnalysis {
  const git = analyzeGitMetadata(inputFiles);
  const files = inputFiles
    .map((file) => ({ ...file, path: normalizePath(file.path), language: file.language ?? languageForPath(file.path), size: file.size || file.content.length }))
    .filter((file) => file.path && !hasIgnoredSegment(file.path, IGNORED_SEGMENTS))
    .sort((a, b) => a.path.localeCompare(b.path));
  const filePaths = new Set(files.map((file) => file.path));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const symbols = files.flatMap(parseSymbols);
  const references = parseReferences(files, symbols, filePaths);
  const moduleGroups = new Map<string, RepositoryFile[]>();
  files.forEach((file) => {
    const path = modulePath(file.path);
    const group = moduleGroups.get(path) ?? [];
    group.push(file);
    moduleGroups.set(path, group);
  });
  const modules: ModuleInfo[] = [...moduleGroups.entries()].map(([path, group]) => ({
    id: path,
    name: displayName(path),
    path,
    filePaths: group.map((file) => file.path),
    languages: [...new Set(group.map((file) => file.language))],
    description: describeModule(path, group),
    inbound: 0,
    outbound: 0,
  }));
  const moduleByPath = new Map(modules.map((module) => [module.path, module]));
  const moduleForFile = (path: string) => moduleByPath.get(modulePath(path));
  const fileNodes: GraphNode[] = files.map((file) => ({
    id: fileId(file.path),
    label: file.path.split('/').pop() ?? file.path,
    kind: 'file',
    path: file.path,
    moduleId: moduleForFile(file.path)?.id,
    language: file.language,
    description: `${file.language} source file`,
    fileCount: 1,
    inbound: 0,
    outbound: 0,
    score: 0,
  }));
  const fileNodeById = new Map(fileNodes.map((node) => [node.id, node]));
  const rawFileEdges: GraphEdge[] = [];
  const externalSources = new Set<string>();
  files.forEach((file) => {
    importedSpecifiers(file).forEach((source) => {
      const resolved = resolveImport(source, file.path, filePaths, file.language);
      const sourceNode = fileNodeById.get(fileId(file.path));
      if (!sourceNode) return;
      if (resolved) {
        const targetNode = fileNodeById.get(fileId(resolved));
        if (!targetNode || targetNode.id === sourceNode.id) return;
        sourceNode.outbound += 1;
        targetNode.inbound += 1;
        rawFileEdges.push({
          id: `edge:${file.path}->${resolved}`,
          source: sourceNode.id,
          target: targetNode.id,
          type: 'imports',
          weight: 1,
          label: 'imports',
          sourcePath: file.path,
          targetPath: resolved,
        });
      } else if (source && !source.startsWith('.')) {
        externalSources.add(externalLabel(source));
      }
    });
  });
  const externalNodes: GraphNode[] = [...externalSources].sort().map((name) => ({
    id: `external:${name}`,
    label: name,
    kind: 'external',
    path: name,
    description: 'External dependency',
    fileCount: 0,
    inbound: 0,
    outbound: 0,
    score: 0,
  }));
  const allFileNodes = [...fileNodes, ...externalNodes];
  const moduleEdges = new Map<string, GraphEdge>();
  files.forEach((file) => {
    const sourceModule = moduleForFile(file.path);
    importedSpecifiers(file).forEach((source) => {
      const resolved = resolveImport(source, file.path, filePaths, file.language);
      const targetModule = resolved ? moduleForFile(resolved) : undefined;
      const sourceId = sourceModule ? moduleId(sourceModule.id) : moduleId('root');
      const targetId = targetModule ? moduleId(targetModule.id) : `external:${externalLabel(source)}`;
      if (sourceId === targetId) return;
      const key = `${sourceId}->${targetId}`;
      const existing = moduleEdges.get(key);
      if (existing) existing.weight += 1;
      else moduleEdges.set(key, { id: `module-edge:${key}`, source: sourceId, target: targetId, type: 'imports', weight: 1, label: 'imports' });
    });
  });
  const moduleNodes: GraphNode[] = modules.map((module) => {
    const fileIds = new Set(module.filePaths.map(fileId));
    const inbound = rawFileEdges.filter((edge) => fileIds.has(edge.target)).length;
    const outbound = rawFileEdges.filter((edge) => fileIds.has(edge.source)).length;
    module.inbound = inbound;
    module.outbound = outbound;
    return {
      id: moduleId(module.id),
      label: module.name,
      kind: 'module' as const,
      path: module.path,
      language: module.languages[0],
      description: module.description,
      fileCount: module.filePaths.length,
      inbound,
      outbound,
      score: inbound * 2 + outbound,
    };
  });
  const moduleNodeById = new Map(moduleNodes.map((node) => [node.id, node]));
  const edges = [...moduleEdges.values()];
  edges.forEach((edge) => {
    const source = moduleNodeById.get(edge.source) ?? allFileNodes.find((node) => node.id === edge.source);
    const target = moduleNodeById.get(edge.target) ?? allFileNodes.find((node) => node.id === edge.target);
    if (source) source.outbound += edge.weight;
    if (target) target.inbound += edge.weight;
  });
  externalNodes.forEach((node) => {
    node.score = node.inbound + node.outbound;
  });
  const entryPoints = detectEntryPoints(files, filePaths);
  const languages = toLanguageCounts(files);
  const core = [...moduleNodes].sort((a, b) => b.score - a.score)[0];
  const topEntry = entryPoints[0];
  const boundaries = externalNodes.map((node) => node.label).slice(0, 4);
  const summary = {
    headline: topEntry ? `Start with ${topEntry.path}` : core ? `Start with ${core.path}` : 'Start with the repository overview',
    paragraphs: [
      topEntry
        ? `The strongest starting point is ${topEntry.path}, detected as a ${topEntry.type.toLowerCase()} with ${topEntry.reasons[0]?.toLowerCase() ?? 'runtime signals'}.`
        : 'No definitive runtime entry point was detected, so RepoLens ranked the most connected modules instead.',
      core
        ? `${core.label} is the most connected module in this snapshot, with ${core.inbound} inbound and ${core.outbound} outbound relationships.`
        : 'The repository does not contain enough source relationships to rank a core module yet.',
      boundaries.length
        ? `The codebase crosses ${boundaries.length} external boundar${boundaries.length === 1 ? 'y' : 'ies'}: ${boundaries.join(', ')}.`
        : 'No external package boundaries were detected in the indexed source.',
    ],
    startHere: entryPoints.slice(0, 3).map((entry) => entry.path),
    boundaries,
    hotspots: [...moduleNodes].sort((a, b) => b.score - a.score).slice(0, 3).map((node) => node.path),
  };
  return {
    name: repositoryName,
    files,
    symbols,
    references,
    git,
    modules,
    nodes: [...moduleNodes, ...externalNodes],
    fileNodes: allFileNodes,
    edges,
    fileEdges: rawFileEdges,
    entryPoints,
    languages,
    summary,
    metrics: {
      files: files.length,
      modules: modules.length,
      symbols: symbols.length,
      references: references.length,
      relationships: rawFileEdges.length + edges.length,
      externalDependencies: externalNodes.length,
    },
  };
}

export function repositoryFilesFromEntries(entries: Array<{ path: string; content: string }>): RepositoryFile[] {
  return entries
    .filter(({ path }) => !isIgnoredImportPath(path))
    .map(({ path, content }) => ({ path: normalizePath(path), content, language: languageForPath(path), size: content.length }));
}
