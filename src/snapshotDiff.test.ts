import { describe, expect, it } from 'vitest';
import { analyzeRepository } from './analyzer';
import { compareAnalyses } from './snapshotDiff';

describe('snapshot diffs', () => {
  it('reports added, removed, changed, and relationship changes', () => {
    const previous = analyzeRepository([
      { path: 'src/server.ts', content: "import { route } from './routes';\nimport { legacy } from './legacy';\nexport function start() { return legacy(route()); }", language: 'TypeScript', size: 0 },
      { path: 'src/routes.ts', content: 'export function route() { return true; }', language: 'TypeScript', size: 0 },
      { path: 'src/legacy.ts', content: 'export const legacy = true;', language: 'TypeScript', size: 0 },
    ], 'diff-fixture');
    const current = analyzeRepository([
      { path: 'src/server.ts', content: "import { route } from './routes';\nimport { database } from './db';\nexport function start() { return database(route()); }", language: 'TypeScript', size: 0 },
      { path: 'src/routes.ts', content: 'export function route() { return false; }', language: 'TypeScript', size: 0 },
      { path: 'src/db.ts', content: 'export function database(value: unknown) { return value; }', language: 'TypeScript', size: 0 },
    ], 'diff-fixture');

    const diff = compareAnalyses(previous, current);

    expect(diff.addedFiles.map((change) => change.label)).toContain('src/db.ts');
    expect(diff.removedFiles.map((change) => change.label)).toContain('src/legacy.ts');
    expect(diff.changedFiles.map((change) => change.label)).toContain('src/server.ts');
    expect(diff.changedFiles.map((change) => change.label)).toContain('src/routes.ts');
    expect(diff.addedEdges.length).toBeGreaterThan(0);
    expect(diff.removedEdges.length).toBeGreaterThan(0);
    expect(diff.hasChanges).toBe(true);
    expect(diff.total).toBeGreaterThan(5);
  });

  it('returns a clean result for equivalent analysis snapshots', () => {
    const files = [{ path: 'src/one.ts', content: 'export const one = 1;', language: 'TypeScript' as const, size: 0 }];
    const analysis = analyzeRepository(files, 'same');

    expect(compareAnalyses(analysis, analyzeRepository(files, 'same'))).toMatchObject({ total: 0, hasChanges: false });
  });
});
