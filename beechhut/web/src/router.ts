import { useSyncExternalStore } from 'react';
import type { Page } from './types';

const PAGES: Page[] = ['overview', 'containers', 'server', 'home', 'network', 'plan', 'photos', 'links', 'notes'];

const read = (): Page => {
  const p = location.hash.replace(/^#\/?/, '').split('?')[0] as Page;
  return PAGES.includes(p) ? p : 'overview';
};
const subscribe = (cb: () => void) => { addEventListener('hashchange', cb); return () => removeEventListener('hashchange', cb); };

export const useRoute = () => useSyncExternalStore(subscribe, read);
export const navigate = (page: Page) => { location.hash = `/${page}`; };
