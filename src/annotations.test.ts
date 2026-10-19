import { beforeEach, describe, expect, it } from 'vitest';
import { deleteAnnotation, loadAnnotations, saveAnnotation } from './annotations';

describe('map annotations', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves one editable annotation per node', () => {
    const first = saveAnnotation({ nodeId: 'module:src', text: 'Review this boundary', color: 'amber' });
    const updated = saveAnnotation({ nodeId: 'module:src', text: 'Reviewed boundary', color: 'green' });

    expect(first).toHaveLength(1);
    expect(updated).toHaveLength(1);
    expect(loadAnnotations()[0].text).toBe('Reviewed boundary');
    expect(deleteAnnotation(updated[0].id)).toEqual([]);
  });
});
