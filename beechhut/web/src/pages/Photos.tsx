import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Crop, Trash2, X } from 'lucide-react';
import { api, useApi } from '../api';
import { Button, Card, Empty, ErrorNote, Loading, Modal, confirm } from '../ui';
import { cropPhoto } from './crop';
import type { Meta } from '../types';

const KEY = '/photos';
const CLEAR_AFTER = 4000;

type RowState = 'waiting' | 'cropping' | 'sending' | 'added' | 'skipped' | 'failed';
interface Row { id: number; name: string; preview: string; state: RowState; message?: string }
interface Notice { text: string; tone?: 'ok' | 'bad' }

const LABEL: Record<RowState, string> = {
  waiting: 'Waiting…', cropping: 'Cropping…', sending: 'Sending…', added: 'Added', skipped: 'Not added', failed: '',
};

/** Relative, so it works under Home Assistant's ingress address. */
const photoUrl = (name: string) => `api/photos/${encodeURIComponent(name)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function upload(blob: Blob) {
  const res = await fetch('api/photos', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Couldn’t send it (HTTP ${res.status})`);
  return data as { name: string };
}
const removePhoto = (name: string) => api(`/photos/${encodeURIComponent(name)}`, { method: 'DELETE' });

/** Add photos to the photo frame, cropped to its shape on the phone, and manage the ones already there. */
export function PhotosPage({ meta }: { meta: Meta }) {
  const aspect = meta.photoFrame?.aspect ?? 238 / 162;
  const { data, error, loading, refresh } = useApi<string[]>(KEY, 60_000);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [queue, setQueue] = useState<Row[]>([]);
  const [working, setWorking] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
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

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const rows: Row[] = files.map((f) => {
      const preview = URL.createObjectURL(f);
      previews.current.add(preview);
      return { id: ++nextId.current, name: f.name, preview, state: 'waiting' };
    });
    setQueue((q) => [...q, ...rows]);
    setWorking(true);
    setNotice(null);
    let added = 0, failed = 0;
    // One at a time: crop, send, then the next.
    for (const [i, row] of rows.entries()) {
      update(row.id, { state: 'cropping' });
      try {
        const title = files.length > 1 ? `Crop photo ${i + 1} of ${files.length}` : 'Crop the photo';
        const blob = await cropPhoto(files[i], { aspect, title, done: 'Add' });
        if (!blob) { update(row.id, { state: 'skipped' }); continue; }
        update(row.id, { state: 'sending' });
        await upload(blob);
        update(row.id, { state: 'added' });
        added++;
      } catch (e) {
        update(row.id, { state: 'failed', message: (e as Error).message });
        failed++;
      }
    }
    setWorking(false);
    refresh();
    if (failed) setNotice({ text: `${added ? `${plural(added, 'photo')} added, but ` : ''}${plural(failed, 'photo')} couldn’t be added: see below.`, tone: 'bad' });
    else if (added) setNotice({ text: `${plural(added, 'photo')} added: on the frame within a couple of minutes.`, tone: 'ok' });
    else setNotice({ text: 'No photos added.' });
    // Tidy away the finished rows; failed ones stay so you can see why.
    setTimeout(() => setQueue((q) => q.filter((r) => {
      if (!rows.some((x) => x.id === r.id) || r.state === 'failed') return true;
      URL.revokeObjectURL(r.preview);
      previews.current.delete(r.preview);
      return false;
    })), CLEAR_AFTER);
  }

  async function remove(name: string) {
    const ok = await confirm({ title: 'Delete this photo?', body: 'It goes from the frame and from Home Assistant.', action: 'Delete', danger: true });
    if (!ok) return;
    setViewing(null);
    try {
      await removePhoto(name);
      setNotice({ text: 'Photo deleted.', tone: 'ok' });
    } catch (e) {
      setNotice({ text: `Couldn’t delete it: ${(e as Error).message}`, tone: 'bad' });
    }
    refresh();
  }

  /** Crop a photo that's already in the frame: add the new one, then delete the original. */
  async function recrop(name: string) {
    setViewing(null);
    setWorking(true);
    try {
      const blob = await cropPhoto(photoUrl(name), { aspect, title: 'Crop the photo', done: 'Save' });
      if (!blob) return;
      setNotice({ text: 'Saving…' });
      await upload(blob);
      await removePhoto(name);
      setNotice({ text: 'Photo re-cropped: on the frame within a couple of minutes.', tone: 'ok' });
    } catch (e) {
      setNotice({ text: `Couldn’t re-crop it: ${(e as Error).message}`, tone: 'bad' });
    } finally {
      setWorking(false);
      refresh();
    }
  }

  return (
    <div className="page photos-page">
      <div className="page-head">
        <div>
          <h1>Photo uploader</h1>
          <p className="muted">Photos added here go in the photo frame, one at a time. They show up there within a couple of minutes.</p>
        </div>
      </div>

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
                  <div className="row-title"><strong className="clip">{r.name}</strong></div>
                  <div className={`row-sub ${r.state === 'failed' ? 'text-bad' : r.state === 'added' ? 'photo-added' : ''}`}>
                    {r.state === 'failed' ? r.message : LABEL[r.state]}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ErrorNote error={error} what="the photos in the frame" />
      {loading && <Loading rows={2} />}
      {data && (
        <Card title={`In the frame (${data.length})`}>
          {data.length === 0 ? <Empty>No photos yet: add some above.</Empty> : (
            <div className="photo-grid" style={{ ['--photo-aspect' as string]: String(aspect) }}>
              {data.map((name) => (
                <div key={name} className="photo-tile">
                  <button type="button" className="photo-thumb" onClick={() => setViewing(name)} aria-label="Open photo">
                    <img src={photoUrl(name)} alt="" loading="lazy" />
                  </button>
                  <button type="button" className="photo-delete" onClick={() => remove(name)} title="Delete" aria-label="Delete photo">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {viewing && (
        <Modal title="Photo" wide onClose={() => setViewing(null)}>
          <img className="photo-large" src={photoUrl(viewing)} alt="" />
          <div className="modal-buttons">
            <Button icon={<Crop size={16} />} onClick={() => recrop(viewing)} disabled={working}>Crop</Button>
            <Button icon={<Trash2 size={16} />} variant="danger" onClick={() => remove(viewing)}>Delete</Button>
            <Button variant="ghost" onClick={() => setViewing(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
