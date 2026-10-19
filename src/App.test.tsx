import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AppComponent from './App';
import { analyzeRepository } from './analyzer';
import { canvasLayoutKey, createCanvasLayout, saveCanvasLayout } from './canvasLayout';
import { sampleFiles } from './sampleRepository';

const fixtureAnalysis = analyzeRepository(sampleFiles, 'payments-api');
function App() {
  return <AppComponent initialAnalysis={fixtureAnalysis} />;
}

describe('RepoLens shell', () => {
  it('opens without a bundled repository in the default app', () => {
    render(<AppComponent />);

    expect(screen.getByRole('heading', { name: /open your repository/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open repository/i })).toBeInTheDocument();
    expect(screen.queryByText(/payments-api/i)).not.toBeInTheDocument();
  });

  it('skips node_modules files before reading a folder import', async () => {
    const ignoredText = vi.fn(async () => 'export const ignored = true;');
    const sourceText = vi.fn(async () => 'export const main = true;');
    const ignored = new File(['ignored'], 'index.js', { type: 'text/plain' });
    const source = new File(['source'], 'main.ts', { type: 'text/plain' });
    Object.defineProperties(ignored, { webkitRelativePath: { value: 'project/node_modules/pkg/index.js' }, text: { value: ignoredText } });
    Object.defineProperties(source, { webkitRelativePath: { value: 'project/src/main.ts' }, text: { value: sourceText } });
    const { container } = render(<AppComponent />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Import input was not rendered');

    fireEvent.change(input, { target: { files: [ignored, source] } });

    await waitFor(() => expect(screen.getByRole('button', { name: /project.*1 files indexed/i })).toBeInTheDocument());
    expect(ignoredText).not.toHaveBeenCalled();
    expect(sourceText).toHaveBeenCalledTimes(1);
  });

  it('renders the overview with repository summary data', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /explore payments-api/i })).toBeInTheDocument();
    expect(screen.getAllByText('Files').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/strongest starting point is src\/server\.ts/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /architecture health dashboard/i })).toHaveTextContent(/architecture health/i);
    expect(screen.getByRole('region', { name: /git activity/i })).toHaveTextContent(/not detected/i);
    expect(screen.getByRole('region', { name: /repolens onboarding guide/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export report/i })).toBeInTheDocument();
  });

  it('dismisses onboarding and opens the keyboard shortcuts dialog', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /dismiss onboarding guide/i }));
    expect(screen.queryByRole('region', { name: /repolens onboarding guide/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('button', { name: /overview/i })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: /keyboard shortcuts/i }));
    expect(screen.getByRole('dialog', { name: /Move through RepoLens faster/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close keyboard shortcuts/i }));
    expect(screen.queryByRole('dialog', { name: /Move through RepoLens faster/i })).not.toBeInTheDocument();
  });

  it('opens the architecture map from a health dashboard hotspot', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /hotspots/i }));

    expect(screen.getByRole('heading', { name: /explore the architecture/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /module interactive dependency map/i })).toBeInTheDocument();
  });

  it('moves from the overview into the architecture map', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));

    expect(screen.getByRole('heading', { name: /explore the architecture/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /module interactive dependency map/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show selected area/i })).toBeInTheDocument();
    expect(screen.getByText('Change impact')).toBeInTheDocument();
    const mapNodes = document.querySelectorAll('.react-flow__node');
    expect(mapNodes).not.toHaveLength(0);
    expect(document.querySelector('.atlas-flow-node')?.querySelectorAll('.atlas-handle')).toHaveLength(8);
    expect([...mapNodes].every((node) => node.getAttribute('style')?.includes('visibility: visible'))).toBe(true);
    expect(getComputedStyle(screen.getByRole('region', { name: /module interactive dependency map/i })).height).toBe('572px');
    const minimapSvg = document.querySelector('.react-flow__minimap-svg');
    expect(minimapSvg).toBeInTheDocument();
    expect(getComputedStyle(minimapSvg as SVGElement).minHeight).not.toBe('620px');
  });

  it('switches the architecture map to the domain lens', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    await user.click(screen.getByRole('button', { name: 'Domains' }));

    expect(screen.getByRole('region', { name: /domain interactive dependency map/i })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ domains$/i)).toBeInTheDocument();
  });

  it('switches the architecture map to the exported API lens', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    await user.click(screen.getByRole('button', { name: 'API' }));

    expect(screen.getByRole('region', { name: /api interactive dependency map/i })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ exports$/i)).toBeInTheDocument();
  });

  it('switches the architecture map to the selected import sequence', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    await user.click(screen.getByRole('button', { name: 'Sequence' }));

    expect(screen.getByRole('region', { name: /sequence interactive dependency map/i })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ steps$/i)).toBeInTheDocument();
  });

  it('switches the architecture map to the function lens', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    await user.click(screen.getByRole('button', { name: 'Functions' }));

    expect(screen.getByRole('region', { name: /function interactive dependency map/i })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ functions$/i)).toBeInTheDocument();
  });

  it('shows relationship filters and a fit-map action', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));

    expect(screen.getByRole('combobox', { name: /filter relationships/i })).toHaveValue('all');
    expect(screen.getByRole('button', { name: /fit map/i })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /filter relationships/i }), 'calls');
    expect(screen.getByRole('combobox', { name: /filter relationships/i })).toHaveValue('calls');
  });

  it('opens the map in full screen and can leave it with Escape', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    await user.click(screen.getByRole('button', { name: /full screen map/i }));

    expect(document.querySelector('.map-fullscreen-page')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit full screen/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(document.querySelector('.map-fullscreen-page')).not.toBeInTheDocument();
  });

  it('focuses the selected node and toggles the minimap', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    expect(screen.getByRole('button', { name: /focus selected/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /hide minimap/i }));
    expect(document.querySelector('.react-flow__minimap-svg')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show minimap/i }));
    expect(document.querySelector('.react-flow__minimap-svg')).toBeInTheDocument();
  });

  it('undoes and redoes map layout changes', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    const undo = screen.getByRole('button', { name: /undo layout change/i });
    const redo = screen.getByRole('button', { name: /redo layout change/i });
    expect(undo).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /lock selected/i }));
    expect(undo).not.toBeDisabled();
    await user.click(undo);
    expect(redo).not.toBeDisabled();
    await user.click(redo);
    expect(undo).not.toBeDisabled();
  });

  it('shows map search, path, group, saved-view, and export controls', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));

    expect(screen.getByRole('textbox', { name: /search map/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /group map nodes/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /saved view name/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export json/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export svg/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export png/i })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /saved view name/i }), 'Main map');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('combobox', { name: /load saved view/i })).toHaveTextContent('Main map');
  });

  it('opens source around the selected file line', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    await user.click(screen.getByRole('button', { name: /TS src\/server\.ts/i }));
    await user.click(screen.getByRole('button', { name: /^open source$/i }));

    expect(screen.getByRole('dialog', { name: /server\.ts/i })).toBeInTheDocument();
    expect(screen.getByText(/line 1 of/i)).toBeInTheDocument();
  });

  it('adds an annotation and opens a dependency report for a selected file', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    await user.click(screen.getByRole('button', { name: /TS src\/server\.ts/i }));
    await user.type(screen.getByRole('textbox', { name: /map annotation text/i }), 'Review this boundary');
    await user.click(screen.getByRole('button', { name: /add note/i }));

    expect(screen.getByRole('button', { name: /update note/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /dependency report/i }));
    expect(screen.getByRole('dialog', { name: /dependency report/i })).toHaveTextContent(/direct dependencies/i);
  });

  it('saves and deletes the current project from the project menu', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /payments-api.*⌄/i }));
    const menu = screen.getByRole('dialog', { name: /recent repositories/i });
    await user.click(within(menu).getByRole('button', { name: /save current project/i }));

    const savedProject = within(menu).getByRole('button', { name: /payments-api.*saved locally/i });
    expect(savedProject).toBeInTheDocument();
    await user.click(within(menu).getByRole('button', { name: /delete saved project payments-api/i }));
    expect(within(menu).queryByRole('button', { name: /payments-api.*saved locally/i })).not.toBeInTheDocument();
  });

  it('jumps from a symbol to its definition and indexed references', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(screen.getByRole('navigation', { name: /primary navigation/i })).getByRole('button', { name: /symbols/i }));
    await user.click(screen.getByRole('button', { name: /checkout.*exported/i }));

    expect(screen.getByText('Definition')).toBeInTheDocument();
    expect(screen.getByText(/References/)).toBeInTheDocument();
    expect(screen.getAllByText(/src\/api\/routes\.ts:2/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /jump to definition/i }));
    expect(screen.getByRole('dialog', { name: /checkout\.ts/i })).toBeInTheDocument();
    expect(screen.getByText(/line 5 of/i)).toBeInTheDocument();
  });

  it('keeps the first node position when selecting a second node', async () => {
    const user = userEvent.setup();
    const analysis = analyzeRepository(sampleFiles, 'payments-api');
    const layout = createCanvasLayout(analysis.nodes);
    layout.positions['module:src'] = { x: 123, y: 321 };
    saveCanvasLayout(canvasLayoutKey('payments-api', 'module', analysis.nodes.map((node) => node.id)), layout);
    render(<App />);

    await user.click(screen.getByRole('button', { name: /open architecture map/i }));
    const region = screen.getByRole('region', { name: /module interactive dependency map/i });
    const nodes = [...region.querySelectorAll<HTMLElement>('.react-flow__node')];
    const firstNode = nodes.find((node) => node.textContent?.includes('Src'));
    const secondNode = nodes.find((node) => node.textContent?.includes('Data'));
    if (!firstNode || !secondNode) throw new Error('Expected module nodes were not rendered');

    expect(firstNode.style.transform).toContain('translate(123px,321px)');
    fireEvent.click(secondNode);
    expect(firstNode.style.transform).toContain('translate(123px,321px)');
  });

  it('shows a structural diff after replacing the indexed repository', async () => {
    const { container } = render(<App />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Import input was not rendered');

    const file = new File(['export function fresh() { return true; }'], 'fresh.ts', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => 'export function fresh() { return true; }' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByRole('region', { name: /structural snapshot diff/i })).toBeInTheDocument());
    expect(screen.getByText(/changes since the previous index/i)).toBeInTheDocument();
  });

  it('searches symbols from the command palette and opens the symbol view', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /search files, symbols, or actions/i }));
    const paletteInput = screen.getByRole('textbox', { name: /search files, symbols, or actions/i });
    await user.type(paletteInput, 'checkout');
    await user.click(within(screen.getByRole('dialog', { name: /search repolens/i })).getByRole('button', { name: /^Symbols$/i }));
    expect(screen.getByRole('button', { name: /checkout.*function/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /checkout.*function/i }));

    expect(screen.getByRole('heading', { name: /search the ideas inside the files/i })).toBeInTheDocument();
  });

  it('closes the search panel cleanly and resets its query', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /search files, symbols, or actions/i }));
    const paletteInput = screen.getByRole('textbox', { name: /search files, symbols, or actions/i });
    await user.type(paletteInput, 'checkout');
    await user.click(screen.getByRole('button', { name: /close search/i }));

    expect(screen.queryByRole('dialog', { name: /search repolens/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /search files, symbols, or actions/i }));
    expect(screen.getByRole('textbox', { name: /search files, symbols, or actions/i })).toHaveValue('');
  });

  it('compares saved repository snapshots and opens the changed-only map', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Import input was not rendered');

    const first = new File(['export const before = true;'], 'first.ts', { type: 'text/plain' });
    Object.defineProperty(first, 'text', { value: async () => 'export const before = true;' });
    fireEvent.change(input, { target: { files: [first] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /first\.ts.*files indexed/i })).toBeInTheDocument());

    const second = new File(['export const after = true;'], 'second.ts', { type: 'text/plain' });
    Object.defineProperty(second, 'text', { value: async () => 'export const after = true;' });
    fireEvent.change(input, { target: { files: [second] } });
    await waitFor(() => expect(screen.getByRole('button', { name: /second\.ts.*files indexed/i })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/changes since the previous index/i)).toBeInTheDocument());

    const baseline = screen.getByRole('combobox', { name: /baseline snapshot/i });
    const comparison = screen.getByRole('combobox', { name: /comparison snapshot/i });
    const baselineOption = [...baseline.querySelectorAll('option')].find((option) => option.textContent?.startsWith('first.ts'));
    const comparisonOption = [...comparison.querySelectorAll('option')].find((option) => option.textContent?.startsWith('second.ts'));
    if (!baselineOption || !comparisonOption) throw new Error('Saved snapshot options were not rendered');
    await user.selectOptions(baseline, baselineOption.value);
    await user.selectOptions(comparison, comparisonOption.value);
    await user.click(screen.getByRole('button', { name: /^compare$/i }));
    expect(screen.getByText(/changes between first\.ts.*second\.ts/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /inspect changed structure/i }));
    expect(screen.getByRole('combobox', { name: /map change scope/i })).toHaveValue('changed');
  });

  it('enables large repository mode and progressively renders map nodes', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Import input was not rendered');
    const files = Array.from({ length: 125 }, (_, index) => {
      const file = new File([`export const value${index} = ${index};`], `index-${index}.ts`, { type: 'text/plain' });
      Object.defineProperty(file, 'webkitRelativePath', { value: `large-repo/module-${index}/index.ts` });
      Object.defineProperty(file, 'text', { value: async () => `export const value${index} = ${index};` });
      return file;
    });
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(screen.getByRole('button', { name: /large-repo.*files indexed/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /open architecture map/i }));

    expect(screen.getByRole('region', { name: /large repository performance mode/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show 120 more/i })).toBeInTheDocument();
  });
});
