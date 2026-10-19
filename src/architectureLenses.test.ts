import { describe, expect, it } from 'vitest';
import { analyzeRepository } from './analyzer';
import { createApiGraph, createDomainGraph, createFunctionGraph, createSequenceGraph, domainKeyForPath } from './architectureLenses';

describe('architecture lenses', () => {
  it('derives stable domain keys from source and package paths', () => {
    expect(domainKeyForPath('src/payments/checkout.ts')).toBe('payments');
    expect(domainKeyForPath('packages/core/nested/db.ts')).toBe('packages');
    expect(domainKeyForPath('root')).toBe('root');
  });

  it('collapses module relationships into domain boundaries', () => {
    const analysis = analyzeRepository([
      { path: 'apps/web/server.ts', content: "import { run } from '../../packages/core/runtime'; run();", language: 'TypeScript', size: 0 },
      { path: 'packages/core/runtime.ts', content: 'export function run() { return true; }', language: 'TypeScript', size: 0 },
      { path: 'packages/core/nested/format.ts', content: 'export function format() { return "ok"; }', language: 'TypeScript', size: 0 },
      { path: 'packages/core/runtime.test.ts', content: 'export const fixture = true;', language: 'TypeScript', size: 0 },
    ], 'lens-fixture');

    const graph = createDomainGraph(analysis);
    const domains = graph.nodes.filter((node) => node.id.startsWith('domain:'));

    expect(domains.map((node) => node.id)).toEqual(['domain:apps', 'domain:packages']);
    expect(domains.find((node) => node.id === 'domain:packages')?.fileCount).toBe(3);
    expect(graph.edges).toEqual([
      expect.objectContaining({ source: 'domain:apps', target: 'domain:packages', weight: 1 }),
    ]);
  });

  it('promotes exported symbols into an API surface graph', () => {
    const analysis = analyzeRepository([
      { path: 'src/server.ts', content: 'export function start() { return true; }', language: 'TypeScript', size: 0 },
      { path: 'src/config.ts', content: 'export const port = 3000;', language: 'TypeScript', size: 0 },
      { path: 'src/internal.ts', content: 'function hidden() { return false; }', language: 'TypeScript', size: 0 },
    ], 'api-fixture');

    const graph = createApiGraph(analysis);
    const apiNodes = graph.nodes.filter((node) => node.id.startsWith('api:'));

    expect(apiNodes.map((node) => node.label)).toEqual(['port', 'start']);
    expect(graph.edges.filter((edge) => edge.type === 'exports')).toHaveLength(2);
    expect(graph.nodes.some((node) => node.id === 'file:src/internal.ts')).toBe(false);
  });

  it('follows a bounded import sequence from the selected entry', () => {
    const analysis = analyzeRepository([
      { path: 'src/server.ts', content: "import { router } from './api/routes'; export function start() { return router(); }", language: 'TypeScript', size: 0 },
      { path: 'src/api/routes.ts', content: "import { load } from '../shared/config'; export function router() { return load(); }", language: 'TypeScript', size: 0 },
      { path: 'src/shared/config.ts', content: 'export function load() { return true; }', language: 'TypeScript', size: 0 },
      { path: 'src/unused.ts', content: 'export function unused() { return false; }', language: 'TypeScript', size: 0 },
    ], 'sequence-fixture');

    const graph = createSequenceGraph(analysis, 'file:src/server.ts');

    expect(graph.nodes.map((node) => node.path)).toEqual(['src/api/routes.ts', 'src/server.ts', 'src/shared/config.ts']);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.some((node) => node.path === 'src/unused.ts')).toBe(false);
  });

  it('keeps local and exported functions in the function lens', () => {
    const analysis = analyzeRepository([
      { path: 'src/feature.ts', content: 'export function visible() { return hidden(); }\nfunction hidden() { return true; }', language: 'TypeScript', size: 0 },
    ], 'function-fixture');

    const graph = createFunctionGraph(analysis);

    expect(graph.nodes.filter((node) => node.id.startsWith('function:')).map((node) => node.label)).toEqual(['visible', 'hidden']);
    expect(graph.edges.filter((edge) => edge.type === 'exports')).toHaveLength(2);
  });
});
