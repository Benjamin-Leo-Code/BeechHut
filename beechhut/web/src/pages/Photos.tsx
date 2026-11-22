import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Crop, Trash2, X, Tv, RefreshCw } from 'lucide-react';
import { api, useApi } from '../api';
import { Button, Card, Empty, ErrorNote, Loading, Modal, Segmented, confirm } from '../ui';
import { cropPhoto } from './crop';
import type { FrameTvPhoto, Meta } from '../types';

const FRAME_KEY = '/photos';
const TV_KEY = '/frametv';
const CLEAR_AFTER = 4000;
const MODE_KEY = 'beechhut.photos.destination';

type Dest = 'frame' | 'tv';
type Mode = Dest | 'both';
interface Target { dest: Dest; name: string; aspect: number; maxWidth: number; path: string }
type RowState = 'waiting' | 'working' | 'done' | 'skipped' | 'failed';
interface Row { id: number; name: string; preview: string; state: RowState; text: string }
interface Notice { text: string; tone?: 'ok' | 'bad' }

/** Relative, so it works under Home Assistant's ingress address. */
const framePhotoUrl = (name: string) => `api/photos/${encodeURIComponent(name)}`;
const tvThumbUrl = (id: string) => `api/frametv/${encodeURIComponent(id)}/thumbnail`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const readMode = (): Mode | null => { try { return localStorage.getItem(MODE_KEY) as Mode | null; } catch { return null; } };
const saveMode = (m: Mode) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* private browsing */ } };

async function upload(path: string, blob: Blob) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Couldn’t send it (HTTP ${res.status})`);
  return data;
}

/** Add photos to the photo frame and/or the Frame TV, cropped to fit on the phone, and manage the ones already there. */
export function PhotosPage({ meta }: { meta: Meta }) {
  const targets: Record<Dest, Target | null> = {
    frame: meta.photoFrame ? { dest: 'frame', name: 'the photo frame', aspect: meta.photoFrame.aspect, maxWidth: 1920, path: 'api/photos' } : null,
    tv: meta.frameTv ? { dest: 'tv', name: 'the Frame TV', aspect: meta.frameTv.aspect, maxWidth: 3840, path: 'api/frametv' } : null,
  };
  const both = Boolean(targets.frame && targets.tv);
  const [mode, setMode] = useState<Mode>(() => {
    const saved = readMode();
    if (both) return saved || 'both';
    return targets.frame ? 'frame' : 'tv';
  });
  const chosen = (mode === 'both' ? [targets.frame, targets.tv] : [targets[mode]]).filter(Boolean) as Target[];

  const frame = useApi<string[]>(targets.frame ? FRAME_KEY : null, 60_000);
  const tv = useApi<FrameTvPhoto[]>(targets.tv ? TV_KEY : null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [queue, setQueue] = useState<Row[]>([]);
  const [working, setWorking] = useState(false);
  const [viewing, setViewing] = useState<{ dest: Dest; id: string } | null>(null);
  const nextId = useRef(0);

  // Never fail silently.
  useEffect(() => {
    const show = (reason: unknown) => setNotice({ text: `Something went wrong: ${reason instanceof Error ? reason.message : String(reason)}`, tone: 'bad' });
    const onRejection = (e: PromiseRejectionEvent) => show(e.reason);
    const onError = (e: ErrorEvent) => show(e.error ?? e.message);
    addEventListener('unhandledrejection', onRejection);
    addEventListener('error', onError);
    return () => { removeEventListener('unhandledrejection', onRejection); removeEventListener('error', onError); };
  }, []);

  // Let go of previews when leaving the page.
  const previews = useRef(new Set<string>());
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = (id: number, change: Partial<Row>) => setQueue((q) => q.map((r) => (r.id === id ? { ...r, ...change } : r)));
  const refreshAll = (dests: Dest[]) => { if (dests.includes('frame')) frame.refresh(); if (dests.includes('tv')) tv.refresh(); };

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const to = chosen;
    const rows: Row[] = files.map((f) => {
      const preview = URL.createObjectURL(f);
      previews.current.add(preview);
      return { id: ++nextId.current, name: f.name, preview, state: 'waiting', text: 'Waiting…' };
    });
    setQueue((q) => [...q, ...rows]);
    setWorking(true);
    setNotice(null);
    let added = 0, failed = 0;
    // One photo at a time: crop and send it to each destination, then the next.
    for (const [i, row] of rows.entries()) {
      const done: Target[] = [], errors: string[] = [];
      for (const t of to) {
        const where = to.length > 1 ? ` for ${t.name}` : '';
        update(row.id, { state: 'working', text: `Cropping${where}…` });
        try {
          const count = files.length > 1 ? ` ${i + 1} of ${files.length}` : '';
          const title = `Crop ${count ? `photo${count}` : 'the photo'}${where}`;
          const blob = await cropPhoto(files[i], { aspect: t.aspect, maxWidth: t.maxWidth, title, done: 'Add' });
          if (!blob) continue;
          update(row.id, { text: `Sending to ${t.name}…` });
          await upload(t.path, blob);
          done.push(t);
        } catch (e) {
          errors.push(to.length > 1 ? `${t.name}: ${(e as Error).message}` : (e as Error).message);
        }
      }
      if (done.length) added++;
      if (errors.length) failed++;
      const text = errors.length ? (done.length ? `Added to ${done[0].name} only. ` : '') + errors.join(' ')
        : done.length === 0 ? 'Not added'
        : done.length < to.length ? `Added to ${done[0].name} only`
        : to.length > 1 ? 'Added to both' : 'Added';
      update(row.id, { state: errors.length ? 'failed' : done.length ? 'done' : 'skipped', text });
    }
    setWorking(false);
    refreshAll(to.map((t) => t.dest));
    const where = to.length > 1 ? ' to the photo frame and the Frame TV.' : to[0].dest === 'tv' ? ': in the Frame TV’s Art Mode, under My Photos.' : ': on the frame within a couple of minutes.';
    if (failed) setNotice({ text: `${added ? `${plural(added, 'photo')} added, but ` : ''}${plural(failed, 'photo')} had a problem: see below.`, tone: 'bad' });
    else if (added) setNotice({ text: `${plural(added, 'photo')} added${where || '.'}`, tone: 'ok' });
    else setNotice({ text: 'No photos added.' });
    // Tidy away the finished rows; ones with a problem stay so you can see why.
    setTimeout(() => setQueue((q) => q.filter((r) => {
      if (!rows.some((x) => x.id === r.id) || r.state === 'failed') return true;
      URL.revokeObjectURL(r.preview);
      previews.current.delete(r.preview);
      return false;
    })), CLEAR_AFTER);
  }

  async function remove(dest: Dest, id: string) {
    const ok = await confirm(dest === 'tv'
      ? { title: 'Delete this photo?', body: 'It’s removed from the Frame TV’s My Photos.', action: 'Delete', danger: true }
      : { title: 'Delete this photo?', body: 'It goes from the frame and from Home Assistant.', action: 'Delete', danger: true });
    if (!ok) return;
    setViewing(null);
    try {
      await api(`${dest === 'tv' ? TV_KEY : FRAME_KEY}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setNotice({ text: 'Photo deleted.', tone: 'ok' });
    } catch (e) {
      setNotice({ text: `Couldn’t delete it: ${(e as Error).message}`, tone: 'bad' });
    }
    refreshAll([dest]);
  }

  /** Crop a photo that's already in the frame: add the new one, then delete the original. */
  async function recrop(name: string) {
    const t = targets.frame!;
    setViewing(null);
    setWorking(true);
    try {
      const blob = await cropPhoto(framePhotoUrl(name), { aspect: t.aspect, maxWidth: t.maxWidth, title: 'Crop the photo', done: 'Save' });
      if (!blob) return;
      setNotice({ text: 'Saving…' });
      await upload(t.path, blob);
      await api(`${FRAME_KEY}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setNotice({ text: 'Photo re-cropped: on the frame within a couple of minutes.', tone: 'ok' });
    } catch (e) {
      setNotice({ text: `Couldn’t re-crop it: ${(e as Error).message}`, tone: 'bad' });
    } finally {
      setWorking(false);
      frame.refresh();
    }
  }

  async function showOnTv(id: string) {
    setViewing(null);
    try {
      await api(`${TV_KEY}/${encodeURIComponent(id)}/show`, { method: 'POST' });
      setNotice({ text: 'Showing on the Frame TV when it’s in Art Mode.', tone: 'ok' });
    } catch (e) {
      setNotice({ text: `Couldn’t show it: ${(e as Error).message}`, tone: 'bad' });
    }
    tv.refresh();
  }

  const intro = both ? 'Photos added here go in the photo frame, the Frame TV’s Art Mode, or both. Each one is cropped to fit first.'
    : targets.tv ? 'Photos added here go in the Frame TV’s Art Mode, under My Photos. Each one is cropped to fit first.'
    : 'Photos added here go in the photo frame, one at a time. They show up there within a couple of minutes.';

  return (
    <div className="page photos-page">
      <div className="page-head">
        <div><h1>Photo uploader</h1><p className="muted">{intro}</p></div>
      </div>

      {both && (
        <div className="photo-dest">
          <span className="muted small">Add to</span>
          <Segmented<Mode> value={mode} onChange={(m) => { setMode(m); saveMode(m); }} options={[
            { value: 'frame', label: 'Photo frame' }, { value: 'tv', label: 'Frame TV' }, { value: 'both', label: 'Both' },
          ]} />
        </div>
      )}

      <label className={`btn btn-primary photo-add ${working ? 'disabled' : ''}`} aria-disabled={working}>
        <ImagePlus size={20} /><span>Add photos</span>
        <input type="file" accept="image/*" multiple disabled={working}
          onChange={(e) => { const files = [...(e.target.files || [])]; e.target.value = ''; addFiles(files); }} />
      </label>

      <div role="status" aria-live="polite" className={notice ? `photo-notice ${notice.tone ? `photo-notice-${notice.tone}` : ''}` : 'photo-notice-empty'}>
        {notice?.text}
      </div>

      {queue.length > 0 && (
        <Card pad={false}>
          <ul className="rows photo-queue">
            {queue.map((r) => (
              <li key={r.id} className="row">
                <img src={r.preview} alt="" />
                <div className="row-main">
                  <div className="row-title"><strong>{r.name}</strong></div>
                  <div className={`row-sub ${r.state === 'failed' ? 'text-bad' : r.state === 'done' ? 'photo-added' : ''}`}>{r.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {targets.frame && (
        <>
          <ErrorNote error={frame.error} what="the photos in the frame" />
          {frame.loading && !frame.error && <Loading rows={2} />}
          {frame.data && (
            <Card title={`In the photo frame (${frame.data.length})`}>
              {frame.data.length === 0 ? <Empty>No photos yet: add some above.</Empty> : (
                <div className="photo-grid" style={{ ['--photo-aspect' as string]: String(targets.frame.aspect) }}>
                  {frame.data.map((name) => (
                    <Tile key={name} src={framePhotoUrl(name)} onOpen={() => setViewing({ dest: 'frame', id: name })} onDelete={() => remove('frame', name)} />
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {targets.tv && (
        <>
          {tv.error && (
            <div className="photo-tv-error">
              <ErrorNote error={tv.error} what="the Frame TV’s photos" />
              <Button small icon={<RefreshCw size={14} />} onClick={() => tv.refresh()}>Try again</Button>
            </div>
          )}
          {tv.loading && !tv.error && <Loading rows={2} />}
          {tv.data && (
            <Card title={`On the Frame TV (${tv.data.length})`} icon={<Tv size={16} />}
              actions={<Button small variant="ghost" icon={<RefreshCw size={14} />} title="Refresh" onClick={() => tv.refresh()} />}>
              {tv.data.length === 0 ? <Empty>None of your own photos are on the TV yet: add some above.</Empty> : (
                <div className="photo-grid" style={{ ['--photo-aspect' as string]: String(targets.tv.aspect) }}>
                  {tv.data.map((p) => (
                    <Tile key={p.id} src={tvThumbUrl(p.id)} badge={p.showing ? 'Showing' : undefined}
                      onOpen={() => setViewing({ dest: 'tv', id: p.id })} onDelete={() => remove('tv', p.id)} />
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {viewing && (
        <Modal title={viewing.dest === 'tv' ? 'On the Frame TV' : 'In the photo frame'} wide onClose={() => setViewing(null)}>
          <img className="photo-large" src={viewing.dest === 'tv' ? tvThumbUrl(viewing.id) : framePhotoUrl(viewing.id)} alt="" />
          <div className="modal-buttons">
            {viewing.dest === 'frame'
              ? <Button icon={<Crop size={16} />} onClick={() => recrop(viewing.id)} disabled={working}>Crop</Button>
              : <Button icon={<Tv size={16} />} onClick={() => showOnTv(viewing.id)}>Show now</Button>}
            <Button icon={<Trash2 size={16} />} variant="danger" onClick={() => remove(viewing.dest, viewing.id)}>Delete</Button>
            <Button variant="ghost" onClick={() => setViewing(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Tile({ src, badge, onOpen, onDelete }: { src: string; badge?: string; onOpen: () => void; onDelete: () => void }) {
  return (
    <div className="photo-tile">
      <button type="button" className="photo-thumb" onClick={onOpen} aria-label="Open photo">
        <img src={src} alt="" loading="lazy" />
      </button>
      {badge && <span className="photo-badge">{badge}</span>}
      <button type="button" className="photo-delete" onClick={onDelete} title="Delete" aria-label="Delete photo"><X size={14} /></button>
    </div>
  );
}
