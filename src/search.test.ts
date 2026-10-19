import { describe, expect, it } from 'vitest';
import { analyzeRepository } from './analyzer';
import { buildSearchResults } from './search';

describe('search ranking', () => {
  it('ranks exact symbols and filters by result kind', () => {
    const analysis = analyzeRepository([{ path: 'src/main.ts', content: 'export function checkout() { return true; }', language: 'TypeScript', size: 0 }], 'search-fixture');
    const symbols = buildSearchResults(analysis, 'checkout', 'symbol');

    expect(symbols[0]).toMatchObject({ kind: 'symbol', title: 'checkout' });
    expect(buildSearchResults(analysis, 'checkout', 'file')).toEqual([]);
  });
});
