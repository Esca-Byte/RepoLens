import { describe, expect, it } from 'vitest';
import { analyzeRepository } from './analyzer';
import { buildDependencyReport } from './dependencyReport';

describe('dependency reports', () => {
  it('reports dependencies, dependents, and markdown', () => {
    const analysis = analyzeRepository([
      { path: 'src/a.ts', content: "import { b } from './b'; export const a = b;", language: 'TypeScript', size: 0 },
      { path: 'src/b.ts', content: 'export const b = true;', language: 'TypeScript', size: 0 },
    ], 'report-fixture');
    const report = buildDependencyReport(analysis, 'file:src/b.ts');

    expect(report?.directDependents.map((node) => node.id)).toContain('file:src/a.ts');
    expect(report?.markdown).toContain('# Dependency report');
  });

  it('reports module dependents for an external package node', () => {
    const analysis = analyzeRepository([
      { path: 'src/main.ts', content: "import client from 'client-sdk'; export const main = client;", language: 'TypeScript', size: 0 },
    ], 'external-report-fixture');
    const report = buildDependencyReport(analysis, 'external:client-sdk');

    expect(report?.directDependents.map((node) => node.id)).toContain('module:src');
  });
});
