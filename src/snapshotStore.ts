import type { RepositoryFile } from './types';

export interface RepositorySnapshot {
  id: string;
  name: string;
  files: RepositoryFile[];
  createdAt: number;
}

const STORAGE_KEY = 'repolens:snapshots';
const MAX_SNAPSHOTS = 6;
const MAX_FILES_PER_SNAPSHOT = 1200;

function readSnapshots(): RepositorySnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as RepositorySnapshot[];
    return Array.isArray(parsed)
      ? parsed.filter((snapshot) => snapshot && typeof snapshot.id === 'string' && typeof snapshot.name === 'string' && Array.isArray(snapshot.files))
      : [];
  } catch {
    return [];
  }
}

function writeSnapshots(snapshots: RepositorySnapshot[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots.slice(0, MAX_SNAPSHOTS)));
  } catch {
    // Snapshot persistence is best effort; the active session still has the data.
  }
}

function snapshotId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `snapshot:${Date.now()}:${random}`;
}

export function loadSnapshots(): RepositorySnapshot[] {
  return readSnapshots();
}

export function saveSnapshot(name: string, files: RepositoryFile[], id = snapshotId()): RepositorySnapshot[] {
  const snapshot: RepositorySnapshot = {
    id,
    name: name.trim() || 'local-repository',
    files: files.slice(0, MAX_FILES_PER_SNAPSHOT),
    createdAt: Date.now(),
  };
  const next = [snapshot, ...readSnapshots().filter((candidate) => candidate.id !== id)];
  writeSnapshots(next);
  return next.slice(0, MAX_SNAPSHOTS);
}

export function deleteSnapshot(id: string): RepositorySnapshot[] {
  const next = readSnapshots().filter((snapshot) => snapshot.id !== id);
  writeSnapshots(next);
  return next;
}

export function snapshotLabel(snapshot: RepositorySnapshot): string {
  return `${snapshot.name} · ${new Date(snapshot.createdAt).toLocaleString()}`;
}
