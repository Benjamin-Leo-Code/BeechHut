import { useMemo, useState } from 'react';
import { ExternalLink, Play, RotateCw, Square, Star } from 'lucide-react';
import { api, mutate, refresh, useApi } from '../api';
import { AppIcon, Button, Card, Empty, ErrorNote, Loading, SearchInput, Segmented, confirm, useAction, type Tone } from '../ui';
import { matches } from '../format';
import type { Container, Meta } from '../types';

const KEY = '/containers';
const tone = (s: string): Tone => (s === 'running' ? 'ok' : s === 'paused' || s === 'restarting' ? 'warn' : s === 'dead' ? 'bad' : 'off');
const label = (s: string) => (s === 'exited' ? 'stopped' : s);

export function ContainersPage({ meta }: { meta: Meta }) {
  const { data, error, loading } = useApi<Container[]>(KEY, 5000);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const { busy, run } = useAction();

  const list = useMemo(() => (data || []).filter((c) =>
    (filter === 'all' || (filter === 'running' ? c.state === 'running' : c.state !== 'running')) && matches(q, c.name, c.image)), [data, q, filter]);
  const running = data?.filter((c) => c.state === 'running').length ?? 0;

  async function act(c: Container, action: 'start' | 'stop' | 'restart') {
    if (action !== 'start' && !(await confirm({
      title: `${action === 'stop' ? 'Stop' : 'Restart'} ${c.name}?`,
      action: action === 'stop' ? 'Stop' : 'Restart', danger: action === 'stop',
    }))) return;
    const ok = await run(`${c.id}:${action}`, () => api(`${KEY}/${encodeURIComponent(c.id)}/${action}`, { method: 'POST' }), `${c.name} ${action === 'stop' ? 'stopped' : action === 'start' ? 'started' : 'restarted'}`);
    if (ok) mutate<Container[]>(KEY, (cs) => cs.map((x) => (x.id === c.id ? { ...x, state: action === 'stop' ? 'exited' : 'running' } : x)));
    refresh(KEY);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Containers</h1><p className="muted">{data ? `${running} of ${data.length} running` : 'Docker on Unraid'}</p></div>
        {meta.webUrls.unraid && <Button icon={<ExternalLink size={16} />} href={`${meta.webUrls.unraid}/Docker`}>Unraid Docker</Button>}
      </div>
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Filter containers" />
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: data?.length }, { value: 'running', label: 'Running', count: running },
          { value: 'stopped', label: 'Stopped', count: data ? data.length - running : undefined },
        ]} />
      </div>
      <ErrorNote error={error} what="containers" />
      {loading && <Loading rows={6} />}
      {data && (
        <Card pad={false}>
          {list.length === 0 ? <Empty>No containers match.</Empty> : (
            <ul className="rows ctr-rows">
              {list.map((c) => {
                const ports = [...new Set(c.ports.map((p) => p.public).filter(Boolean))];
                const on = c.state === 'running';
                return (
                  <li key={c.id} className={`row ctr-row ctr-${tone(c.state)}`} title={label(c.state)}>
                    <AppIcon src={c.icon} name={c.name} size={36} />
                    <div className="row-main">
                      <div className="row-title">
                        <strong className="ctr-name">{c.name}</strong>
                        {c.favourite && <Star size={13} className="fav" />}
                        {!on && c.autoStart && <span className="badge badge-warn">autostart</span>}
                        <span className="visually-hidden">{label(c.state)}</span>
                      </div>
                      <div className="row-sub">
                        <span title={c.image} className="hide-sm">{c.image.replace(/^(ghcr\.io|lscr\.io|docker\.io)\//, '')}</span>
                        <span className="show-sm">{c.status}</span>
                        {ports.length > 0 && <span className="show-sm">Port <span className="ctr-ports-sm">{ports.join(', ')}</span></span>}
                      </div>
                    </div>
                    <div className="ctr-uptime hide-sm">{c.status}</div>
                    <div className="ctr-ports hide-sm">{ports.join(', ')}</div>
                    <div className="ctr-slot">
                      {on && <Button icon={<RotateCw size={16} />} title="Restart" busy={busy === `${c.id}:restart`} onClick={() => act(c, 'restart')} />}
                    </div>
                    <div className="ctr-slot">
                      {on
                        ? <Button icon={<Square size={15} />} title="Stop" busy={busy === `${c.id}:stop`} onClick={() => act(c, 'stop')} />
                        : <Button icon={<Play size={16} />} title="Start" variant="primary" busy={busy === `${c.id}:start`} onClick={() => act(c, 'start')} />}
                    </div>
                    <div className="ctr-slot">
                      {c.url && <Button icon={<ExternalLink size={16} />} title={`Open ${c.name}`} href={c.url} disabled={!on} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
