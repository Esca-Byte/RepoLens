import { describe, expect, it } from 'vitest';
import { analyzeGitMetadata } from './gitMetadata';

describe('git metadata', () => {
  it('reads branch, head, remote, and recent reflog commits', () => {
    const summary = analyzeGitMetadata([
      { path: '.git/HEAD', content: 'ref: refs/heads/main\n', language: 'Unknown', size: 0 },
      { path: '.git/refs/heads/main', content: 'abcdef1234567890\n', language: 'Unknown', size: 0 },
      { path: '.git/config', content: '[remote "origin"]\n\turl = https://example.test/codeatlas.git\n', language: 'Unknown', size: 0 },
      { path: '.git/logs/HEAD', content: '0000000 abcdef1234567890 Jane Doe <jane@example.test> 1700000000 +0000\tcommit: Add map\n', language: 'Unknown', size: 0 },
    ]);

    expect(summary).toMatchObject({ isRepository: true, branch: 'main', head: 'abcdef1234567890', remote: 'https://example.test/codeatlas.git' });
    expect(summary?.commits[0]).toMatchObject({ shortHash: 'abcdef12', subject: 'commit: Add map' });
  });

  it('finds metadata beneath an imported folder root', () => {
    const summary = analyzeGitMetadata([
      { path: 'codeatlas/.git/HEAD', content: 'ref: refs/heads/feature/map\n', language: 'Unknown', size: 0 },
      { path: 'codeatlas/.git/refs/heads/feature/map', content: '1234567890abcdef\n', language: 'Unknown', size: 0 },
      { path: 'codeatlas/.git/config', content: '[remote "origin"]\n\turl = https://example.test/feature.git', language: 'Unknown', size: 0 },
    ]);

    expect(summary).toMatchObject({ branch: 'feature/map', head: '1234567890abcdef', remote: 'https://example.test/feature.git' });
  });
});
