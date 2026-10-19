import { describe, expect, it } from 'vitest';
import { calculateImpact } from './impactAnalysis';
import type { GraphEdge } from './types';

const edge = (source: string, target: string): GraphEdge => ({
  id: `${source}->${target}`,
  source,
  target,
  type: 'imports',
  weight: 1,
  label: 'imports',
});

describe('impact analysis', () => {
  it('counts direct and transitive dependents without looping on cycles', () => {
    const impact = calculateImpact('module:data', [
      edge('module:api', 'module:data'),
      edge('module:server', 'module:api'),
      edge('module:worker', 'module:data'),
      edge('module:data', 'module:worker'),
    ]);

    expect(impact.directDependents).toBe(2);
    expect(impact.transitiveDependents).toBe(3);
    expect(impact.dependentIds).toEqual(expect.arrayContaining(['module:api', 'module:server', 'module:worker']));
  });

  it('returns an empty impact for an isolated node', () => {
    expect(calculateImpact('module:isolated', [edge('module:api', 'module:data')])).toEqual({
      directDependents: 0,
      transitiveDependents: 0,
      dependentIds: [],
    });
  });
});
