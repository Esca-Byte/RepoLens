export interface MapAnnotation {
  id: string;
  nodeId: string;
  text: string;
  color: 'blue' | 'amber' | 'green' | 'purple';
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'repolens:map-annotations';

function readAnnotations(): MapAnnotation[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as MapAnnotation[];
    return Array.isArray(parsed) ? parsed.filter((annotation) => annotation && typeof annotation.id === 'string' && typeof annotation.nodeId === 'string' && typeof annotation.text === 'string') : [];
  } catch {
    return [];
  }
}

function writeAnnotations(annotations: MapAnnotation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
  } catch {
    // The map remains usable if local storage is unavailable.
  }
}

export function loadAnnotations(): MapAnnotation[] {
  return readAnnotations();
}

export function saveAnnotation(annotation: Omit<MapAnnotation, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): MapAnnotation[] {
  const now = Date.now();
  const current = readAnnotations();
  const existing = annotation.id ? current.find((candidate) => candidate.id === annotation.id) : current.find((candidate) => candidate.nodeId === annotation.nodeId);
  const nextAnnotation: MapAnnotation = {
    id: existing?.id ?? annotation.id ?? `annotation:${now}:${Math.random().toString(36).slice(2, 8)}`,
    nodeId: annotation.nodeId,
    text: annotation.text.trim(),
    color: annotation.color,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = [nextAnnotation, ...current.filter((candidate) => candidate.id !== nextAnnotation.id && candidate.nodeId !== nextAnnotation.nodeId)];
  writeAnnotations(next);
  return next;
}

export function deleteAnnotation(id: string): MapAnnotation[] {
  const next = readAnnotations().filter((annotation) => annotation.id !== id);
  writeAnnotations(next);
  return next;
}
