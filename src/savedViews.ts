import type { ArchitectureGranularity } from './architectureLenses';
import type { EdgeFilter } from './mapFilters';

export interface SavedMapView {
  id: string;
  name: string;
  granularity: ArchitectureGranularity;
  focusMode: boolean;
  edgeFilter: EdgeFilter;
  selectedId: string | null;
  createdAt: number;
}

const STORAGE_KEY = 'repolens:saved-map-views';

function readViews(): SavedMapView[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as SavedMapView[];
    return Array.isArray(parsed) ? parsed.filter((view) => view && typeof view.name === 'string') : [];
  } catch {
    return [];
  }
}

function writeViews(views: SavedMapView[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views.slice(0, 12)));
  } catch {
    // Local storage can be disabled; the current session still works.
  }
}

export function loadSavedMapViews(): SavedMapView[] {
  return readViews();
}

export function saveMapView(view: Omit<SavedMapView, 'id' | 'createdAt'>): SavedMapView[] {
  const next = [{ ...view, id: `view:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now() }, ...readViews()];
  writeViews(next);
  return next;
}

export function deleteMapView(id: string): SavedMapView[] {
  const next = readViews().filter((view) => view.id !== id);
  writeViews(next);
  return next;
}
