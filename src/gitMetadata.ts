import type { GitCommitSummary, GitSummary, RepositoryFile } from './types';

function normalize(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function fileMap(files: RepositoryFile[], repositoryPrefix: string): Map<string, RepositoryFile> {
  return new Map(files.map((file) => {
    const path = normalize(file.path);
    const relativePath = repositoryPrefix && path.startsWith(`${repositoryPrefix}/`) ? path.slice(repositoryPrefix.length + 1) : path;
    return [relativePath, file];
  }));
}

function parseLog(content: string): GitCommitSummary[] {
  return content.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([0-9a-f]{7,40})\s+([0-9a-f]{7,40})\s+(.+?)\s+<([^>]+)>\s+(\d+)\s+[+-]\d+\t(.+)$/i);
    if (!match) return [];
    return [{
      hash: match[2],
      shortHash: match[2].slice(0, 8),
      author: match[3],
      email: match[4],
      timestamp: Number(match[5]) * 1000,
      subject: match[6].trim(),
    }];
  }).reverse();
}

export function analyzeGitMetadata(files: RepositoryFile[]): GitSummary | undefined {
  const headPath = files.map((file) => normalize(file.path)).find((path) => path === '.git/HEAD' || path.endsWith('/.git/HEAD'));
  if (!headPath) return undefined;
  const markerIndex = headPath.lastIndexOf('/.git/HEAD');
  const repositoryPrefix = markerIndex >= 0 ? headPath.slice(0, markerIndex) : '';
  const map = fileMap(files, repositoryPrefix);
  const headFile = map.get('.git/HEAD');
  if (!headFile) return undefined;
  const headContent = headFile.content.trim();
  const refMatch = headContent.match(/^ref:\s+refs\/heads\/(.+)$/);
  const branch = refMatch?.[1];
  const refPath = branch ? `.git/refs/heads/${branch}` : undefined;
  const head = (refPath ? map.get(refPath)?.content.trim() : headContent) || undefined;
  const config = map.get('.git/config')?.content ?? '';
  const remoteSection = config.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\s*\[|$)/)?.[1] ?? '';
  const remote = remoteSection.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
  const commits = parseLog(map.get('.git/logs/HEAD')?.content ?? '').slice(-12).reverse();
  return { isRepository: true, branch, head, remote, commits };
}
