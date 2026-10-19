import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import BrandIcon from './BrandIcon';

function WindowChrome() {
  const desktop = isTauri();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;

    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const syncMaximized = async () => {
      try {
        const next = await appWindow.isMaximized();
        if (!disposed) setMaximized(next);
      } catch {
        // The browser build never reaches this branch; a closing native window can.
      }
    };

    void syncMaximized();
    void appWindow.onResized(() => { void syncMaximized(); }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop]);

  if (!desktop) return null;

  const toggleMaximize = async () => {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      setMaximized(await appWindow.isMaximized());
    } catch {
      // Keep the custom frame usable if the native window is already closing.
    }
  };

  const runWindowAction = (action: () => Promise<void>) => {
    void action().catch(() => {
      // Native window commands can be rejected while the app is closing.
    });
  };

  return (
    <header className="window-chrome" aria-label="RepoLens window bar">
      <div className="window-chrome-drag" data-tauri-drag-region onDoubleClick={() => { void toggleMaximize(); }}>
        <BrandIcon className="window-chrome-mark" />
        <strong>RepoLens</strong>
        <span className="window-chrome-divider" aria-hidden="true">/</span>
        <span className="window-chrome-caption">LOCAL ARCHITECTURE WORKSPACE</span>
      </div>
      <div className="window-chrome-status"><span className="window-chrome-status-dot" />Private by default</div>
      <div className="window-chrome-controls" aria-label="Window controls">
        <button type="button" className="window-control" aria-label="Minimize window" onClick={() => runWindowAction(() => getCurrentWindow().minimize())}>−</button>
        <button type="button" className="window-control" aria-label={maximized ? 'Restore window' : 'Maximize window'} onClick={() => { void toggleMaximize(); }}>{maximized ? '❐' : '□'}</button>
        <button type="button" className="window-control window-control-close" aria-label="Close window" onClick={() => runWindowAction(() => getCurrentWindow().close())}>×</button>
      </div>
    </header>
  );
}

export default WindowChrome;
