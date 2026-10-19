// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { canvasLayoutKey, createCanvasLayout, createCanvasLayoutHistory, generatedCanvasPositions, loadCanvasLayout, recordCanvasLayout, redoCanvasLayout, reconcileCanvasLayout, saveCanvasLayout, undoCanvasLayout } from './canvasLayout';
import type { GraphNode } from './types';

const nodes: GraphNode[] = [
  { id: 'module:api', label: 'Api', kind: 'module', path: 'src/api', description: '', fileCount: 2, inbound: 1, outbound: 2, score: 4 },
  { id: 'module:data', label: 'Data', kind: 'module', path: 'src/data', description: '', fileCount: 2, inbound: 2, outbound: 1, score: 5 },
  { id: 'external:stripe', label: 'stripe', kind: 'external', path: 'stripe', description: '', fileCount: 0, inbound: 1, outbound: 0, score: 1 },
];

describe('canvas layout persistence', () => {
  it('generates stable positions for the same graph order', () => {
    expect(generatedCanvasPositions(nodes)).toEqual(generatedCanvasPositions(nodes));
  });

  it('uses a constellation layout instead of a row-and-column grid', () => {
    const positions = generatedCanvasPositions(nodes);

    expect(positions['module:api'].y).not.toBe(positions['module:data'].y);
    expect(positions['external:stripe'].y).not.toBe(positions['module:data'].y);
  });

  it('keeps selection out of ordinary layout identity', () => {
    expect(canvasLayoutKey('payments-api', 'module', ['module:api'], 'module:api'))
      .toBe(canvasLayoutKey('payments-api', 'module', ['module:api'], 'module:data'));
    expect(canvasLayoutKey('payments-api', 'sequence', ['file:a'], 'file:a'))
      .not.toBe(canvasLayoutKey('payments-api', 'sequence', ['file:a'], 'file:b'));
  });

  it('preserves curated positions and drops removed node locks', () => {
    const saved = createCanvasLayout(nodes, 'curated');
    saved.positions['module:api'] = { x: 777, y: 222 };
    saved.locked = ['module:api', 'removed'];

    const next = reconcileCanvasLayout(saved, nodes.slice(0, 2));

    expect(next.positions['module:api']).toEqual({ x: 777, y: 222 });
    expect(next.locked).toEqual(['module:api']);
    expect(next.mode).toBe('curated');
  });

  it('regenerates legacy generated layouts with the constellation style', () => {
    const generated = generatedCanvasPositions(nodes);
    const legacy = reconcileCanvasLayout({
      positions: { 'module:api': { x: 5, y: 5 } },
      locked: [],
      mode: 'generated',
    }, nodes);

    expect(legacy.positions['module:api']).toEqual(generated['module:api']);
    expect(legacy.layoutStyle).toBe('constellation');
  });

  it('round-trips a layout through local storage', () => {
    const layout = createCanvasLayout(nodes, 'curated');
    layout.positions['module:data'] = { x: 42, y: 84 };
    saveCanvasLayout('test-repository', layout);

    expect(loadCanvasLayout('test-repository', nodes).positions['module:data']).toEqual({ x: 42, y: 84 });
  });

  it('supports bounded undo and redo history', () => {
    const first = createCanvasLayout(nodes, 'curated');
    const second = { ...first, positions: { ...first.positions, 'module:api': { x: 100, y: 200 } } };
    const third = { ...second, positions: { ...second.positions, 'module:api': { x: 300, y: 400 } } };
    const recorded = recordCanvasLayout(recordCanvasLayout(createCanvasLayoutHistory(), first, second), second, third);
    const undone = undoCanvasLayout(recorded, third);
    const redone = redoCanvasLayout(undone.history, undone.layout ?? third);

    expect(undone.layout?.positions['module:api']).toEqual({ x: 100, y: 200 });
    expect(redone.layout?.positions['module:api']).toEqual({ x: 300, y: 400 });
    expect(redone.history.past).toHaveLength(2);
  });
});
