import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { refreshAccount, refreshConfig, toast, useStore } from './store.ts';
import { openInitial } from './projects.ts';
import { useShortcuts } from './shortcuts.ts';
import { runSelected } from './run.ts';
import { Canvas } from './Canvas.tsx';
import { TopBar } from './ui/TopBar.tsx';
import { Dock, SelTool } from './ui/Dock.tsx';
import { Menu } from './ui/Menu.tsx';
import { Dialogs, Toast } from './ui/Dialogs.tsx';
import { Modals } from './ui/Modals.tsx';
import { DragImage } from './ui/DragImage.tsx';
import { ChunksPanel } from './ui/ChunksPanel.tsx';
import { QueuePanel } from './ui/QueuePanel.tsx';
import { GalleryOverlay } from './ui/Gallery.tsx';
import { Search } from './ui/Search.tsx';
import { Onboarding } from './ui/Onboarding.tsx';
import { applyPrefs } from './prefs.ts';
import { loadChunks } from './chunks.ts';
import { loadPresets, refreshArtistSnapshots } from './presets.ts';

applyPrefs();

async function load() {
  try { const w = localStorage.getItem('nai-wheel'); if (w === 'pan' || w === 'zoom') useStore.setState({ wheel: w }); } catch { /* 忽略 */ }
  const [config] = await Promise.all([
    refreshConfig().catch(() => null),
    openInitial().catch(e => toast(`读取画布失败：${(e as Error).message}`, { err: true })),
    loadChunks(),
    loadPresets(),
  ]);
  refreshArtistSnapshots();
  if (config && !config.mock && !config.hasToken) useStore.setState({ dialog: 'settings' });
  else refreshAccount();
}

let started = false;
export function App() {
  useEffect(() => { if (!started) { started = true; load(); } }, []);
  useShortcuts();
  const busy = useStore(s => s.busy), wiring = useStore(s => !!s.wiring);
  return (
    <ReactFlowProvider>
      <div className={`app ${busy ? 'is-busy' : ''} ${wiring ? 'is-wiring' : ''}`}>
        <Canvas />
        <TopBar />
        <SelTool onRun={runSelected} />
        <ChunksPanel />
        <QueuePanel />
        <GalleryOverlay />
        <Search />
        <Onboarding />
        <Dock />
        <Menu />
        <DragImage />
        <Toast />
        <Dialogs />
        <Modals />
      </div>
    </ReactFlowProvider>
  );
}
