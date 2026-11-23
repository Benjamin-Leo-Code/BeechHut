import { CheckCircle2, ChevronRight, Thermometer, Lightbulb, Download, Wifi, Server, Boxes, House, Network, Monitor, BatteryLow, Unplug, AlertTriangle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../api';
import { navigate } from '../router';
import { AppIcon, Bar, Card, Dot, ErrorNote, Loading, type Tone } from '../ui';
import { bitrate, kib, pct, since } from '../format';
import type { AttentionGroup, AttentionItem, Container, LinkGroup, Meta, Overview } from '../types';

const levelTone: Record<string, Tone> = { alert: 'bad', warning: 'warn', info: 'info' };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <p className="muted">
      {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })} · {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
    </p>
  );
}

type BarItem = { key: string; name: string; url: string; icon: string | null; first: boolean; down: boolean };

/**
 * One tap to open: every running container with a web UI and all your own links.
 * Favourite containers and pinned links come first; then the other containers, then the other links.
 */
function AppsBar({ unraid }: { unraid: boolean }) {
  const { data } = useApi<Container[]>(unraid ? '/containers' : null, 10000);
  const links = useApi<LinkGroup[]>('/links', 60000);
  const apps: BarItem[] = (data || [])
    .filter((c) => c.state === 'running' && c.url)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ key: c.id, name: c.name, url: c.url!, icon: c.icon, first: c.favourite, down: false }));
  const own: BarItem[] = (links.data || []).flatMap((g) => g.items)
    .map((l) => ({ key: l.url, name: l.name, url: l.url, icon: l.icon, first: l.pinned, down: Boolean(l.health && !l.health.up) }));
  const items = [...apps.filter((x) => x.first), ...own.filter((x) => x.first), ...apps.filter((x) => !x.first), ...own.filter((x) => !x.first)];
  if (!items.length) return null;
  return (
    <nav className="apps-bar" aria-label="Apps and links">
      {items.map((x) => (
        <a key={x.key} href={x.url} target="_blank" rel="noreferrer" title={x.down ? `${x.name} isn’t responding` : `Open ${x.name}`}>
          <span className="apps-icon">
            <AppIcon src={x.icon} name={x.name} size={40} />
            {x.down && <span className="apps-down" aria-label="Not responding" />}
          </span>
          <span>{x.name}</span>
        </a>
      ))}
    </nav>
  );
}

type View = 'all' | AttentionGroup;
const VIEWS: { key: View; label: string; icon: ReactNode; empty: string }[] = [
  { key: 'all', label: 'Needs attention', icon: <AlertTriangle size={22} />, empty: 'All clear – nothing needs you right now.' },
  { key: 'battery', label: 'Batteries', icon: <BatteryLow size={22} />, empty: 'No low batteries.' },
  { key: 'update', label: 'Updates', icon: <Download size={22} />, empty: 'Everything is up to date.' },
  { key: 'unavailable', label: 'Unavailable', icon: <Unplug size={22} />, empty: 'Nothing is unavailable.' },
];

/**
 * Needs attention: a row of buttons choosing what the list shows. One is always selected,
 * starting with "Needs attention" (everything not under Batteries, Updates or Unavailable).
 */
function Attention({ items, meta }: { items: AttentionItem[]; meta: Meta }) {
  const [view, setView] = useState<View>('all');
  const views = VIEWS.filter((v) => v.key === 'all' || meta.integrations.homeassistant || (v.key === 'update' && meta.integrations.unifi));
  const inView = (k: View) => items.filter((a) => (k === 'all' ? !a.group : a.group === k));
  const shown = inView(view);
  const current = VIEWS.find((v) => v.key === view)!;
  return (
    <Card title={shown.length ? `${current.label} · ${shown.length}` : current.label} pad={false}>
      {views.length > 1 && (
        <div className="att-groups has-active" role="radiogroup" aria-label="Show">
          {views.map((v) => {
            const n = inView(v.key).length;
            return (
              <button key={v.key} type="button" role="radio" aria-checked={view === v.key} className={view === v.key ? 'active' : ''}
                onClick={() => setView(v.key)} title={`Show ${v.label.toLowerCase()}`}>
                <span className="att-group-icon">{v.icon}{n > 0 && <span className="att-count">{n}</span>}</span>
                <span>{v.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {shown.length === 0 ? (
        <div className="all-clear"><CheckCircle2 size={22} /> {current.empty}</div>
      ) : (
        view === 'unavailable' ? <ByDevice items={shown} /> : <AttentionList items={shown} keyPrefix={view} />
      )}
    </Card>
  );
}

function AttentionList({ items, keyPrefix }: { items: AttentionItem[]; keyPrefix: string }) {
  return (
    <ul className="attention">
      {items.map((a, i) => (
        <li key={`${keyPrefix}-${i}`}>
          <button onClick={() => a.page && navigate(a.page)} disabled={!a.page}>
            <Dot tone={levelTone[a.level]} />
            <span className="att-text"><strong>{a.title}</strong>{a.detail && <small>{a.detail}</small>}</span>
            <span className="att-source">{a.source}</span>
            {a.page && <ChevronRight size={16} className="muted" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

const NO_DEVICE = 'Not part of a device';

/** Unavailable entities grouped by device, each group collapsed until tapped. */
function ByDevice({ items }: { items: AttentionItem[] }) {
  const groups = new Map<string, AttentionItem[]>();
  for (const a of items) {
    const k = a.device || NO_DEVICE;
    groups.set(k, [...(groups.get(k) || []), a]);
  }
  const names = [...groups.keys()].sort((x, y) => (x === NO_DEVICE ? 1 : y === NO_DEVICE ? -1 : x.localeCompare(y)));
  return (
    <div className="att-devices">
      {names.map((name) => (
        <details key={name} className="att-device">
          <summary>
            <ChevronRight size={16} className="att-chevron" />
            <span className="att-device-name">{name}</span>
            <span className="att-device-count">{groups.get(name)!.length}</span>
          </summary>
          <AttentionList items={groups.get(name)!} keyPrefix={name} />
        </details>
      ))}
    </div>
  );
}

const isErr = (t: object): t is { error?: string; off?: boolean } => 'error' in t || 'off' in t;

export function OverviewPage({ meta }: { meta: Meta }) {
  const { data, error, loading } = useApi<Overview>('/overview', 15000);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{greeting()}</h1><Clock /></div>
      </div>
      <AppsBar unraid={meta.integrations.unraid} />
      <ErrorNote error={error} what="the overview" />
      {loading && <Loading rows={4} />}
      {data && (
        <>
          <div className="overview-grid">
          <Attention items={data.attention} meta={meta} />

          <div className="tiles">
            {meta.integrations.unraid && <ServerTile t={data.tiles.server} vms={data.tiles.vms} />}
            {meta.integrations.unraid && (
              <Tile title="Containers" icon={<Boxes size={18} />} page="containers" t={data.tiles.containers}>
                {(t) => (
                  <>
                    <div className="big">{t.running}<span>/{t.total} running</span></div>
                    <Bar value={pct(t.running, t.total)} tone={t.running === t.total ? 'ok' : 'warn'} />
                  </>
                )}
              </Tile>
            )}
            {meta.integrations.homeassistant && (
              <Tile title="Home" icon={<House size={18} />} page="home" t={data.tiles.home}>
                {(t) => (
                  <div className="tile-list">
                    {t.climate.map((c) => (
                      <div key={c.name}><Thermometer size={16} /><span>{c.name}</span><strong>{c.current}°C{c.target ? ` → ${c.target}°` : ''}</strong></div>
                    ))}
                    <div><Lightbulb size={16} /><span>Lights on</span><strong>{t.lightsOn} of {t.lights}</strong></div>
                    <div><Download size={16} /><span>Updates</span><strong>{t.updates || 'None'}</strong></div>
                  </div>
                )}
              </Tile>
            )}
            {meta.integrations.unifi && (
              <Tile title="Network" icon={<Network size={18} />} page="network" t={data.tiles.network}>
                {(t) => (
                  <div className="tile-list">
                    <div><Dot tone={t.devicesOnline === t.devices ? 'ok' : 'bad'} /><span>UniFi devices</span><strong>{t.devicesOnline}/{t.devices} online</strong></div>
                    <div><Wifi size={16} /><span>Clients</span><strong>{t.clients} ({t.wireless} Wi‑Fi)</strong></div>
                    {t.gateway && <div><Network size={16} /><span>WAN</span><strong>↓ {bitrate(t.gateway.rx)} · ↑ {bitrate(t.gateway.tx)}</strong></div>}
                  </div>
                )}
              </Tile>
            )}
          </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tile<T extends object>({ title, icon, page, t, children }: {
  title: string; icon: ReactNode; page: 'containers' | 'home' | 'network' | 'server'; t: T | { error?: string; off?: boolean }; children: (t: T) => ReactNode;
}) {
  return (
    <button className="card tile" onClick={() => navigate(page)}>
      <header className="card-head"><h2>{icon}{title}</h2><ChevronRight size={16} className="muted" /></header>
      <div className="card-body">
        {isErr(t) ? <p className="muted">{t.off ? 'Not configured' : `Unavailable – ${t.error}`}</p> : children(t as T)}
      </div>
    </button>
  );
}

function ServerTile({ t, vms }: { t: Overview['tiles']['server']; vms: Overview['tiles']['vms'] }) {
  return (
    <Tile title={isErr(t) ? 'Server' : t.hostname || 'Server'} icon={<Server size={18} />} page="server" t={t}>
      {(s) => (
        <div className="tile-list">
          {s.cpuPercent !== null && <div className="with-bar"><span>CPU</span><Bar value={s.cpuPercent} /><strong>{s.cpuPercent}%</strong></div>}
          {s.memory && <div className="with-bar"><span>RAM</span><Bar value={s.memory.percent} /><strong>{s.memory.percent}%</strong></div>}
          {s.array && <div className="with-bar"><span>Array</span><Bar value={pct(s.array.used, s.array.total)} /><strong>{kib(s.array.free, 0)} free</strong></div>}
          {vms?.map((v) => <div key={v.id}><Monitor size={16} /><span>{v.name}</span><strong className="state"><Dot tone={v.state === 'running' ? 'ok' : 'off'} />{v.state}</strong></div>)}
          <div className="muted small">Up {since(s.bootedAt)}{s.version ? ` · Unraid ${s.version}` : ''}</div>
        </div>
      )}
    </Tile>
  );
}
