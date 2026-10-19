// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeRepository, repositoryFilesFromEntries } from './analyzer';
import { languageForPath, sampleFiles } from './sampleRepository';

describe('repository analysis', () => {
  it('builds a useful architecture model from the sample repository', () => {
    const analysis = analyzeRepository(sampleFiles, 'payments-api');

    expect(analysis.name).toBe('payments-api');
    expect(analysis.metrics.files).toBeGreaterThan(8);
    expect(analysis.metrics.modules).toBeGreaterThan(4);
    expect(analysis.symbols.some((symbol) => symbol.name === 'checkout')).toBe(true);
    const checkout = analysis.symbols.find((symbol) => symbol.name === 'checkout');
    expect(checkout).toBeDefined();
    expect(analysis.references.some((reference) => reference.symbolId === checkout?.id && reference.filePath === 'src/api/routes.ts')).toBe(true);
    expect(analysis.metrics.references).toBe(analysis.references.length);
    expect(analysis.entryPoints[0]).toMatchObject({ path: 'src/server.ts', confidence: 'High' });
    expect(analysis.entryPoints[0].reasons.join(' ')).toMatch(/package\.json|server|listener/i);
    expect(analysis.nodes.some((node) => node.kind === 'external' && node.label === 'stripe')).toBe(true);
    expect(analysis.nodes.some((node) => node.kind === 'external' && node.label === 'type')).toBe(false);
    expect(analysis.nodes.some((node) => node.kind === 'external' && node.label === 'Stripe')).toBe(false);
    expect(analysis.edges.some((edge) => edge.source.includes('api') && edge.target.includes('payments'))).toBe(true);
    expect(analysis.summary.startHere).toContain('src/server.ts');
  });

  it('detects a Python runtime entry point and preserves normalized paths', () => {
    const files = repositoryFilesFromEntries([
      { path: './app/main.py', content: 'def main():\\n    return True\\n\\nif __name__ == "__main__":\\n    main()\\n' },
      { path: 'app\\utils.py', content: 'from .main import main\\n' },
    ]);
    const analysis = analyzeRepository(files, 'python-app');

    expect(files[0].path).toBe('app/main.py');
    expect(files[1].path).toBe('app/utils.py');
    expect(analysis.entryPoints[0]).toMatchObject({ path: 'app/main.py', type: 'Runtime', confidence: 'High' });
    expect(analysis.symbols.some((symbol) => symbol.name === 'main' && symbol.type === 'function')).toBe(true);
  });

  it('filters generated dependency folders before retaining imported files', () => {
    const files = repositoryFilesFromEntries([
      { path: 'project/src/main.ts', content: 'export const main = true;' },
      { path: 'project/node_modules/large-package/index.js', content: 'export const ignored = true;' },
      { path: 'project/packages/app/node_modules/another-package/index.js', content: 'export const ignored = true;' },
      { path: 'project/.git/HEAD', content: 'ref: refs/heads/main\n' },
    ]);

    expect(files.map((file) => file.path)).toEqual(['project/src/main.ts', 'project/.git/HEAD']);
  });

  it('recognizes additional languages and lightweight declarations', () => {
    expect(languageForPath('src/App.java')).toBe('Java');
    expect(languageForPath('src/Program.cs')).toBe('C#');
    expect(languageForPath('src/main.swift')).toBe('Swift');
    const analysis = analyzeRepository([
      { path: 'src/App.java', content: 'public class App { public void run() {} }', language: 'Java', size: 0 },
      { path: 'src/Program.cs', content: 'public class Program { public void Run() {} }', language: 'C#', size: 0 },
      { path: 'src/main.swift', content: 'func start() {}', language: 'Swift', size: 0 },
    ], 'multi-language');
    expect(analysis.symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(['App', 'Program', 'start']));
  });
});
