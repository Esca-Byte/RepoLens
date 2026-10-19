// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadRecentRepositories, rememberRepository } from './repositoryHistory';
import type { RepositoryFile } from './types';

const files: RepositoryFile[] = [{ path: 'src/index.ts', content: 'export {}', language: 'TypeScript', size: 10 }];

describe('repository history', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps the latest imported repository available locally', () => {
    rememberRepository('demo', files);
    expect(loadRecentRepositories()[0].name).toBe('demo');
    expect(loadRecentRepositories()[0].files[0].path).toBe('src/index.ts');
  });
});
