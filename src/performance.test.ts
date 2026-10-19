import { describe, expect, it } from 'vitest';
import { isLargeRepositoryFiles, repositoryBytes } from './performance';
import type { RepositoryFile } from './types';

const file = (path: string, content: string): RepositoryFile => ({ path, content, language: 'TypeScript', size: content.length });

describe('large repository mode', () => {
  it('detects large repositories by file count or source size', () => {
    expect(isLargeRepositoryFiles(Array.from({ length: 120 }, (_, index) => file(`src/${index}.ts`, 'x')))).toBe(true);
    expect(isLargeRepositoryFiles([file('src/large.ts', 'x'.repeat(1_500_000))])).toBe(true);
    expect(isLargeRepositoryFiles([file('src/small.ts', 'x')])).toBe(false);
  });

  it('sums source bytes deterministically', () => {
    expect(repositoryBytes([file('a.ts', '123'), file('b.ts', '12345')])).toBe(8);
  });
});
