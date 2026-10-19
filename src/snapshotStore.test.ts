import { beforeEach, describe, expect, it } from 'vitest';
import { deleteSnapshot, loadSnapshots, saveSnapshot } from './snapshotStore';
import type { RepositoryFile } from './types';

const files: RepositoryFile[] = [{ path: 'src/main.ts', content: 'export const main = true;', language: 'TypeScript', size: 25 }];

describe('snapshot store', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves snapshots and loads them back in newest-first order', () => {
    saveSnapshot('before', files, 'before-id');
    saveSnapshot('after', [{ ...files[0], content: 'export const main = false;' }], 'after-id');

    expect(loadSnapshots().map((snapshot) => snapshot.id)).toEqual(['after-id', 'before-id']);
    expect(loadSnapshots()[1].files[0].content).toContain('true');
  });

  it('deletes a selected snapshot', () => {
    saveSnapshot('before', files, 'before-id');
    saveSnapshot('after', files, 'after-id');

    expect(deleteSnapshot('before-id').map((snapshot) => snapshot.id)).toEqual(['after-id']);
  });
});
