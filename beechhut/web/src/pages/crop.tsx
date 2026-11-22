import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '../ui';

const MAX_ZOOM = 5;
const MAX_WIDTH = 1920;
const MIN_WIDTH = 800;
const QUALITY = 0.88;
const UNREADABLE = 'That doesn’t look like a photo this phone can read.';

interface CropOptions {
  /** The frame's width ÷ height. */
  aspect: number;
  title?: string;
  /** Label for the confirm button: Add, or Save when re-cropping. */
  done?: string;
}

/**
 * Let the user frame a photo to the photo frame's exact shape.
 * Resolves with a JPEG of the framed part, or null if they cancel.
 */
export function cropPhoto(src: Blob | string, { aspect, title = 'Crop the photo', done = 'Add' }: CropOptions): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    let finished = false;
    const finish = (settle: () => void) => {
      if (finished) return;
      finished = true;
      settle();
      // Unmount after React has finished the event that got us here.
      setTimeout(() => {
        root.unmount();
        host.remove();
        if (typeof src !== 'string') URL.revokeObjectURL(url);
      });
    };
    root.render(
      <CropDialog url={url} aspect={aspect} title={title} done={done}
        onDone={(blob) => finish(() => resolve(blob))} onError={(err) => finish(() => reject(err))} />,
    );
  });
}

interface View {
  iw: number; ih: number;          // the photo's real size
  zoom: number;                    // 1 = just covers the window
  cx: number; cy: number;          // the photo point at the window's centre
  wx: number; wy: number; ww: number; wh: number; // the window, in stage pixels
  base: number;                    // scale at zoom 1
}

function CropDialog({ url, aspect, title, done, onDone, onError }: CropOptions & {
  url: string; onDone: (blob: Blob | null) => void; onError: (err: Error) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const view = useRef<View>({ iw: 0, ih: 0, zoom: 1, cx: 0, cy: 0, wx: 0, wy: 0, ww: 0, wh: 0, base: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Keep the photo covering the window, then draw. */
  const apply = () => {
    const v = view.current;
    if (!v.iw) return;
    v.zoom = Math.min(Math.max(v.zoom, 1), MAX_ZOOM);
    const scale = v.base * v.zoom;
    const hw = v.ww / 2 / scale, hh = v.wh / 2 / scale;
    v.cx = Math.min(Math.max(v.cx, hw), v.iw - hw);
    v.cy = Math.min(Math.max(v.cy, hh), v.ih - hh);
    const x = v.wx + v.ww / 2 - v.cx * scale, y = v.wy + v.wh / 2 - v.cy * scale;
    if (img.current) img.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    if (frame.current) Object.assign(frame.current.style, { left: `${v.wx}px`, top: `${v.wy}px`, width: `${v.ww}px`, height: `${v.wh}px` });
    if (slider.current) slider.current.value = String(v.zoom);
  };

  /** Fit the window to the stage, as large as it goes with a margin. */
  const layout = () => {
    const v = view.current, el = stage.current;
    if (!el || !v.iw) return;
    const W = el.clientWidth, H = el.clientHeight, m = Math.min(20, W * 0.04);
    v.ww = Math.max(40, Math.min(W - 2 * m, (H - 2 * m) * aspect));
    v.wh = v.ww / aspect;
    v.wx = (W - v.ww) / 2;
    v.wy = (H - v.wh) / 2;
    v.base = Math.max(v.ww / v.iw, v.wh / v.ih);
    apply();
  };

  /** Zoom by factor, keeping the photo point under (px, py) where it is. */
  const zoomAbout = (px: number, py: number, factor: number) => {
    const v = view.current;
    const s1 = v.base * v.zoom;
    const ix = (px - (v.wx + v.ww / 2 - v.cx * s1)) / s1, iy = (py - (v.wy + v.wh / 2 - v.cy * s1)) / s1;
    v.zoom = Math.min(Math.max(v.zoom * factor, 1), MAX_ZOOM);
    const s2 = v.base * v.zoom;
    v.cx = (v.wx + v.ww / 2 - (px - ix * s2)) / s2;
    v.cy = (v.wy + v.wh / 2 - (py - iy * s2)) / s2;
  };
  const pan = (dx: number, dy: number) => {
    const v = view.current, scale = v.base * v.zoom;
    v.cx -= dx / scale;
    v.cy -= dy / scale;
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  useEffect(() => {
    const d = dialog.current!, el = stage.current!, im = img.current!;
    d.showModal();
    let alive = true;
    im.src = url;
    im.decode().then(() => {
      if (!alive) return;
      if (!im.naturalWidth || !im.naturalHeight) throw new Error(UNREADABLE);
      Object.assign(view.current, { iw: im.naturalWidth, ih: im.naturalHeight, cx: im.naturalWidth / 2, cy: im.naturalHeight / 2, zoom: 1 });
      im.style.width = `${im.naturalWidth}px`;
      im.style.height = `${im.naturalHeight}px`;
      layout();
      setReady(true);
    }).catch(() => alive && onError(new Error(UNREADABLE)));

    const ro = new ResizeObserver(layout);
    ro.observe(el);
    // A computer's mouse wheel zooms; this has to be a non-passive listener to stop the page scrolling.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAbout(p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)));
      apply();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      alive = false;
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      if (d.open) d.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: PointerEvent) => {
    if (!ready) return;
    stage.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  };
  const onPointerMove = (e: PointerEvent) => {
    const map = pointers.current, prev = map.get(e.pointerId);
    if (!prev) return;
    const cur = local(e);
    if (map.size === 1) {
      pan(cur.x - prev.x, cur.y - prev.y);
    } else {
      // Pinch: zoom about the midpoint, and move with it.
      const other = [...map].find(([id]) => id !== e.pointerId)![1];
      const d1 = Math.hypot(prev.x - other.x, prev.y - other.y), d2 = Math.hypot(cur.x - other.x, cur.y - other.y);
      const m1 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 }, m2 = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
      if (d1 > 0) zoomAbout(m1.x, m1.y, d2 / d1);
      pan(m2.x - m1.x, m2.y - m1.y);
    }
    map.set(e.pointerId, cur);
    apply();
  };
  const onPointerUp = (e: PointerEvent) => { pointers.current.delete(e.pointerId); };

  const onSlider = (e: FormEvent<HTMLInputElement>) => {
    const v = view.current;
    zoomAbout(v.wx + v.ww / 2, v.wy + v.wh / 2, Number(e.currentTarget.value) / v.zoom);
    apply();
  };
  const reset = () => {
    const v = view.current;
    Object.assign(v, { zoom: 1, cx: v.iw / 2, cy: v.ih / 2 });
    apply();
  };

  const save = () => {
    const v = view.current, scale = v.base * v.zoom;
    const sw = v.ww / scale, sh = v.wh / scale; // the framed part, in photo pixels
    const width = Math.round(Math.min(MAX_WIDTH, Math.max(sw, Math.min(MIN_WIDTH, v.iw))));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(width / aspect);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#fff'; // under any transparency (PNGs), since JPEG has none
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img.current!, v.cx - sw / 2, v.cy - sh / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    setBusy(true);
    canvas.toBlob((blob) => (blob ? onDone(blob) : onError(new Error('Couldn’t make the cropped photo – try again'))), 'image/jpeg', QUALITY);
  };

  return (
    <dialog ref={dialog} className="crop-dialog" aria-label={title} onCancel={(e) => { e.preventDefault(); onDone(null); }}>
      <header><h2>{title}</h2><p className="muted small">Drag to move, pinch or use the slider to zoom.</p></header>
      <div ref={stage} className="crop-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <img ref={img} alt="" draggable={false} style={{ visibility: ready ? 'visible' : 'hidden' }} />
        <div ref={frame} className="crop-window" hidden={!ready} />
        {!ready && <div className="crop-loading"><Loader2 className="spin" size={28} /></div>}
      </div>
      <div className="crop-zoom">
        <ZoomOut size={18} aria-hidden />
        <input ref={slider} type="range" min={1} max={MAX_ZOOM} step={0.01} defaultValue={1} onInput={onSlider} disabled={!ready} aria-label="Zoom" />
        <ZoomIn size={18} aria-hidden />
      </div>
      <footer>
        <Button variant="ghost" onClick={() => onDone(null)} disabled={busy}>Cancel</Button>
        <Button onClick={reset} disabled={!ready || busy}>Reset</Button>
        <Button variant="primary" onClick={save} disabled={!ready} busy={busy}>{done}</Button>
      </footer>
    </dialog>
  );
}
