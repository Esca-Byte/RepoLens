import type { RepositoryFile } from './types';

export interface RecentRepository {
  name: string;
  files: RepositoryFile[];
  importedAt: number;
}

const STORAGE_KEY = 'repolens:recent-repositories';
const MAX_REPOSITORIES = 5;
const MAX_FILES_PER_REPOSITORY = 600;

function readHistory(): RecentRepository[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as RecentRepository[];
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.name === 'string' && Array.isArray(entry.files)) : [];
  } catch {
    return [];
  }
}

function writeHistory(history: RecentRepository[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_REPOSITORIES)));
  } catch {
    // Large repositories may exceed storage; importing still works for this session.
  }
}

export function loadRecentRepositories(): RecentRepository[] {
  return readHistory();
}

export function rememberRepository(name: string, files: RepositoryFile[]): RecentRepository[] {
  const entry: RecentRepository = { name, files: files.slice(0, MAX_FILES_PER_REPOSITORY), importedAt: Date.now() };
  const next = [entry, ...readHistory().filter((item) => item.name !== name)];
  writeHistory(next);
  return next.slice(0, MAX_REPOSITORIES);
}
