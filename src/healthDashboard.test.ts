import { describe, expect, it } from 'vitest';
import { analyzeRepository } from './analyzer';
import { buildHealthDashboard } from './healthDashboard';

describe('health dashboard', () => {
  it('summarizes warnings, score, and dependency depth', () => {
    const analysis = analyzeRepository([
      { path: 'src/a/index.ts', content: "import { b } from '../b'; export const a = b;", language: 'TypeScript', size: 0 },
      { path: 'src/b/index.ts', content: "import { c } from '../c'; export const b = c;", language: 'TypeScript', size: 0 },
      { path: 'src/c/index.ts', content: 'export const c = true;', language: 'TypeScript', size: 0 },
    ], 'health-fixture');
    const dashboard = buildHealthDashboard(analysis);

    expect(dashboard.score).toBeGreaterThanOrEqual(0);
    expect(dashboard.dependencyDepth).toBeGreaterThanOrEqual(2);
    expect(dashboard.topHotspots.length).toBeGreaterThan(0);
    expect(['Healthy', 'Review', 'At risk']).toContain(dashboard.status);
  });
});
