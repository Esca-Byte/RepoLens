import { beforeEach, describe, expect, it } from 'vitest';
import { deleteProject, loadSavedProjects, saveProject, touchProject } from './projects';

const files = [{ path: 'src/main.ts', content: 'export const main = true;', language: 'TypeScript' as const, size: 25 }];

describe('saved projects', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves and updates a project by name', () => {
    saveProject('demo', files);
    saveProject('demo', [{ ...files[0], content: 'export const main = false;' }]);

    expect(loadSavedProjects()).toHaveLength(1);
    expect(loadSavedProjects()[0].files[0].content).toContain('false');
  });

  it('touches and deletes projects', () => {
    const saved = saveProject('demo', files);
    expect(touchProject(saved[0].id)[0].lastOpenedAt).toBeGreaterThanOrEqual(saved[0].lastOpenedAt);
    expect(deleteProject(saved[0].id)).toEqual([]);
  });
});
