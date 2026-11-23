import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import {
  LayoutGrid, Boxes, Server, House, Network, NotebookPen, Search, MoreHorizontal, Command, Box, Images, LogOut,
} from 'lucide-react';
import { markSigningOut, useApi } from './api';
import { navigate, useRoute } from './router';
import { ConfirmHost, Toaster, Button, Loading } from './ui';
import { CommandPalette } from './CommandPalette';
import type { Meta, Page } from './types';
import { OverviewPage } from './pages/Overview';
import { ContainersPage } from './pages/Containers';
import { ServerPage } from './pages/Server';
import { HomePage } from './pages/Home';
import { NetworkPage } from './pages/Network';
import { NotesPage } from './pages/Notes';
import { PhotosPage } from './pages/Photos';

// The 3D viewer pulls in three.js, so it's only downloaded when you open the page.
const HousePlanPage = lazy(() => import('./pages/HousePlan'));

export const NAV: { page: Page; label: string; icon: ReactNode; mobile?: boolean }[] = [
  { page: 'overview', label: 'Overview', icon: <LayoutGrid size={20} />, mobile: true },
  { page: 'containers', label: 'Containers', icon: <Boxes size={20} />, mobile: true },
  { page: 'server', label: 'Server', icon: <Server size={20} /> },
  { page: 'home', label: 'Home', icon: <House size={20} />, mobile: true },
  { page: 'network', label: 'Network', icon: <Network size={20} />, mobile: true },
  { page: 'plan', label: 'House Plan', icon: <Box size={20} /> },
  { page: 'photos', label: 'Photo uploader', icon: <Images size={20} /> },
  { page: 'notes', label: 'Notes', icon: <NotebookPen size={20} /> },
];

const PAGES: Record<Page, (p: { meta: Meta }) => ReactNode> = {
  overview: OverviewPage, containers: ContainersPage, server: ServerPage, home: HomePage,
  network: NetworkPage, plan: HousePlanPage, photos: PhotosPage, notes: NotesPage,
};

export function App() {
  const page = useRoute();
  const { data: meta } = useApi<Meta>('/meta');
  const [palette, setPalette] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); }
      else if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea')) { e.preventDefault(); setPalette(true); }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const label = NAV.find((n) => n.page === page)?.label;
    document.title = meta ? `${label} · ${meta.title}` : 'BeechHut';
    setMore(false);
    window.scrollTo({ top: 0 });
  }, [page, meta]);

  if (!meta) return null;
  const Current = PAGES[page];
  const enabled = (p: Page) =>
    !(['containers', 'server'].includes(p) && !meta.integrations.unraid) &&
    !(p === 'home' && !meta.integrations.homeassistant) && !(p === 'network' && !meta.integrations.unifi) &&
    !(p === 'photos' && !meta.photoFrame);
  const nav = NAV.filter((n) => enabled(n.page));
  const mobileNav = nav.filter((n) => n.mobile);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/overview">
          <img src="hut.svg" alt="" width={30} height={30} />
          <div><strong>{meta.title}</strong>{meta.subtitle && <small>{meta.subtitle}</small>}</div>
        </a>
        <button className="palette-trigger" onClick={() => setPalette(true)}>
          <Search size={16} /><span>Search or run…</span><kbd>{isMac ? <><Command size={11} />K</> : 'Ctrl K'}</kbd>
        </button>
        <nav>
          {nav.map((n) => (
            <a key={n.page} href={`#/${n.page}`} className={page === n.page ? 'active' : ''} aria-current={page === n.page ? 'page' : undefined}>
              {n.icon}<span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          {meta.demo && <span className="badge badge-info">Demo data</span>}
          {meta.user && <span className="muted small signed-in">{meta.user} · <a href="/auth/logout" onClick={markSigningOut}>Sign out</a></span>}
        </div>
      </aside>

      <header className="topbar">
        <a className="brand" href="#/overview"><img src="hut.svg" alt="" width={26} height={26} /><strong>{meta.title}</strong></a>
        <Button variant="ghost" icon={<Search size={20} />} title="Search" onClick={() => setPalette(true)} />
      </header>

      <main className="main">
        {meta.demo && <div className="demo-banner">Demo mode – showing sample data, nothing is connected.</div>}
        <Suspense fallback={<div className="page"><Loading rows={3} /></div>}><Current meta={meta} /></Suspense>
      </main>

      <nav className="tabbar">
        {mobileNav.map((n) => (
          <a key={n.page} href={`#/${n.page}`} className={page === n.page ? 'active' : ''}>{n.icon}<span>{n.label}</span></a>
        ))}
        <button className={more || !mobileNav.some((n) => n.page === page) ? 'active' : ''} onClick={() => setMore((m) => !m)}>
          <MoreHorizontal size={20} /><span>More</span>
        </button>
      </nav>
      {more && (
        <div className="more-sheet" onClick={() => setMore(false)}>
          <div className="more-panel" onClick={(e) => e.stopPropagation()}>
            {nav.filter((n) => !n.mobile).map((n) => (
              <button key={n.page} onClick={() => navigate(n.page)} className={page === n.page ? 'active' : ''}>{n.icon}<span>{n.label}</span></button>
            ))}
            {meta.user && <button onClick={() => { markSigningOut(); location.href = '/auth/logout'; }}><LogOut size={20} /><span>Sign out ({meta.user})</span></button>}
          </div>
        </div>
      )}

      {palette && <CommandPalette meta={meta} onClose={() => setPalette(false)} />}
      <ConfirmHost />
      <Toaster />
    </div>
  );
}
