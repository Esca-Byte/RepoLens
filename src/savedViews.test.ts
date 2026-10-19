// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteMapView, loadSavedMapViews, saveMapView } from './savedViews';

describe('saved map views', () => {
  beforeEach(() => window.localStorage.clear());

  it('saves, loads, and removes a view', () => {
    const views = saveMapView({ name: 'API map', granularity: 'api', focusMode: false, edgeFilter: 'all', selectedId: null });
    expect(loadSavedMapViews()[0].name).toBe('API map');
    expect(deleteMapView(views[0].id)).toEqual([]);
  });
});
