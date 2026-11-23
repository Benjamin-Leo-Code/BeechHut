import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ExternalLink, Power, RotateCw, ToggleLeft, Play, Monitor } from 'lucide-react';
import { api, refresh, useApi } from './api';
import { navigate } from './router';
import { NAV } from './App';
import { AppIcon, toast } from './ui';
import { matches } from './format';
import type { Container, Entity, LinkGroup, Meta, Vm } from './types';

interface Item { id: string; title: string; hint: string; icon: ReactNode; run: () => void | Promise<unknown>; keywords?: string }

const TOGGLE = new Set(['light', 'switch', 'fan', 'input_boolean', 'automation']);

export function CommandPalette({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const containers = useApi<Container[]>(meta.integrations.unraid ? '/containers' : null);
  const entities = useApi<Entity[]>(meta.integrations.homeassistant ? '/ha/states' : null);
  const vms = useApi<Vm[]>(meta.integrations.unraid ? '/unraid/vms' : null);
  const links = useApi<LinkGroup[]>('/links');

  const items = useMemo<Item[]>(() => {
    const out: Item[] = NAV.map((n) => ({ id: `page:${n.page}`, title: n.label, hint: 'Go to page', icon: n.icon, run: () => navigate(n.page) }));
    for (const [key, label] of [['unraid', 'Unraid'], ['unifi', 'UniFi']] as const) {
      const url = meta.webUrls[key];
      if (url) out.push({ id: `web:${key}`, title: `Open ${label}`, hint: url, icon: <ExternalLink size={18} />, run: () => void open(url, '_blank') });
    }
    for (const g of links.data || []) for (const l of g.items) {
      out.push({ id: `link:${l.url}`, title: l.name, hint: l.url, icon: <AppIcon src={l.icon} name={l.name} size={20} />, run: () => void open(l.url, '_blank') });
    }
    for (const c of containers.data || []) {
      if (c.url) out.push({ id: `ct-open:${c.id}`, title: `Open ${c.name}`, hint: c.url, icon: <AppIcon src={c.icon} name={c.name} size={20} />, run: () => void open(c.url!, '_blank'), keywords: 'container app' });
      const act = c.state === 'running' ? 'restart' : 'start';
      out.push({
        id: `ct-${act}:${c.id}`, title: `${act === 'restart' ? 'Restart' : 'Start'} ${c.name}`, hint: `Container · ${c.state}`,
        icon: act === 'restart' ? <RotateCw size={18} /> : <Play size={18} />, keywords: 'docker container',
        run: async () => { await api(`/containers/${encodeURIComponent(c.id)}/${act}`, { method: 'POST' }); refresh('/containers'); toast(`${c.name} ${act === 'restart' ? 'restarted' : 'started'}`); },
      });
    }
    for (const v of vms.data || []) {
      const act = v.state === 'running' ? 'reboot' : 'start';
      out.push({
        id: `vm:${v.id}`, title: `${act === 'reboot' ? 'Reboot' : 'Start'} ${v.name} VM`, hint: `VM · ${v.state}`, icon: <Monitor size={18} />, keywords: 'virtual machine',
        run: async () => { await api(`/unraid/vms/${encodeURIComponent(v.id)}/${act}`, { method: 'POST' }); refresh('/unraid/vms'); toast(`${v.name}: ${act} sent`); },
      });
    }
    for (const e of entities.data || []) {
      if (TOGGLE.has(e.domain)) {
        out.push({
          id: `ha:${e.id}`, title: `Toggle ${e.name}`, hint: `${e.domain} · currently ${e.state}`, icon: <ToggleLeft size={18} />, keywords: e.id,
          run: async () => { await api('/ha/service', { body: { domain: e.domain === 'automation' ? 'automation' : 'homeassistant', service: 'toggle', data: { entity_id: e.id } } }); refresh('/ha/states'); toast(`${e.name} toggled`); },
        });
      } else if (e.domain === 'scene' || e.domain === 'script') {
        out.push({
          id: `ha:${e.id}`, title: `${e.domain === 'scene' ? 'Activate' : 'Run'} ${e.name}`, hint: e.domain, icon: <Power size={18} />, keywords: e.id,
          run: async () => { await api('/ha/service', { body: { domain: e.domain, service: 'turn_on', data: { entity_id: e.id } } }); toast(`${e.name} ✓`); },
        });
      }
    }
    return out;
  }, [meta, containers.data, entities.data, vms.data, links.data]);

  const results = useMemo(() => (q ? items.filter((i) => matches(q, i.title, i.hint, i.keywords)) : items.slice(0, 12 + 3)).slice(0, 50), [q, items]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  async function choose(item?: Item) {
    if (!item) return;
    onClose();
    try { await item.run(); } catch (e) { toast((e as Error).message, 'bad'); }
  }

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search pages, apps, containers, lights…"
          autoCorrect="off" autoCapitalize="off" spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === 'Enter') choose(results[sel]);
          }}
        />
        <ul ref={listRef}>
          {results.map((r, i) => (
            <li key={r.id} className={i === sel ? 'sel' : ''} onMouseMove={() => setSel(i)} onClick={() => choose(r)}>
              <span className="p-icon">{r.icon}</span>
              <span className="p-text"><strong>{r.title}</strong><small>{r.hint}</small></span>
              <ArrowRight size={16} className="p-go" />
            </li>
          ))}
          {!results.length && <li className="p-empty">Nothing matches “{q}”</li>}
        </ul>
      </div>
    </div>
  );
}
