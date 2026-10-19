import type { RepositoryFile } from './types';

export interface SavedProject {
  id: string;
  name: string;
  files: RepositoryFile[];
  createdAt: number;
  lastOpenedAt: number;
}

const STORAGE_KEY = 'repolens:saved-projects';
const MAX_PROJECTS = 8;
const MAX_FILES_PER_PROJECT = 1200;

function readProjects(): SavedProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as SavedProject[];
    return Array.isArray(parsed) ? parsed.filter((project) => project && typeof project.id === 'string' && typeof project.name === 'string' && Array.isArray(project.files)) : [];
  } catch {
    return [];
  }
}

function writeProjects(projects: SavedProject[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.slice(0, MAX_PROJECTS)));
  } catch {
    // Persistence is best effort for large local repositories.
  }
}

function projectId(): string {
  return `project:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export function loadSavedProjects(): SavedProject[] {
  return readProjects();
}

export function saveProject(name: string, files: RepositoryFile[], existingId?: string): SavedProject[] {
  const now = Date.now();
  const previous = readProjects().find((project) => project.id === existingId || project.name === name.trim());
  const project: SavedProject = {
    id: previous?.id ?? projectId(),
    name: name.trim() || 'local-repository',
    files: files.slice(0, MAX_FILES_PER_PROJECT),
    createdAt: previous?.createdAt ?? now,
    lastOpenedAt: now,
  };
  const next = [project, ...readProjects().filter((candidate) => candidate.id !== project.id && candidate.name !== project.name)];
  writeProjects(next);
  return next.slice(0, MAX_PROJECTS);
}

export function touchProject(id: string): SavedProject[] {
  const projects = readProjects();
  const project = projects.find((candidate) => candidate.id === id);
  if (!project) return projects;
  return saveProject(project.name, project.files, id);
}

export function deleteProject(id: string): SavedProject[] {
  const next = readProjects().filter((project) => project.id !== id);
  writeProjects(next);
  return next;
}
