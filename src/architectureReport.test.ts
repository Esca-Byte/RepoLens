import { describe, expect, it } from 'vitest';
import { analyzeRepository } from './analyzer';
import { buildArchitectureReport, buildArchitectureReportJson } from './architectureReport';

describe('architecture reports', () => {
  it('exports readable Markdown and structured JSON', () => {
    const analysis = analyzeRepository([
      { path: 'src/main.ts', content: "import { helper } from '../shared/helper'; export const main = helper;", language: 'TypeScript', size: 0 },
      { path: 'shared/helper.ts', content: 'export const helper = true;', language: 'TypeScript', size: 0 },
    ], 'report-fixture');

    const markdown = buildArchitectureReport(analysis);
    const json = JSON.parse(buildArchitectureReportJson(analysis)) as { repository: string; metrics: { files: number }; edges: unknown[] };
    expect(markdown).toContain('# RepoLens architecture report: report-fixture');
    expect(markdown).toContain('## Health');
    expect(markdown).toContain('## Entry points');
    expect(json).toMatchObject({ repository: 'report-fixture', metrics: { files: 2 } });
    expect(json.edges.length).toBeGreaterThan(0);
  });
});
