import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const IMAGE = /\.(jpe?g|png|webp|gif)$/i;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
// A bare file name: no folders, no hidden files.
const SAFE_NAME = /^[\w][\w .()+-]*\.(jpe?g|png|webp|gif)$/i;

const bad = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD-HHMMSS-<12 random hex>.jpg – sorts newest first, and can't be guessed. */
export function photoName(now = new Date()) {
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${d}-${t}-${crypto.randomBytes(6).toString('hex')}.jpg`;
}

const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
const typeOf = (name) => TYPES[name.split('.').pop().toLowerCase()] || 'application/octet-stream';
const checkName = (name) => { if (!SAFE_NAME.test(name)) throw bad('That isn’t a photo in the frame'); return name; };

/** Photos for the photo frame, kept as plain files in a folder (Home Assistant's www folder). */
export function createPhotos(dir) {
  const file = (name) => path.join(dir, checkName(name));
  return {
    async list() {
      let names;
      try { names = await fs.readdir(dir); } catch (e) {
        if (e.code === 'ENOENT') throw bad(`The photo frame folder ${dir} doesn’t exist – create it, or check the Photo frame folder setting`, 503);
        throw e;
      }
      return names.filter((n) => IMAGE.test(n) && SAFE_NAME.test(n)).sort().reverse();
    },
    async add(buf) {
      if (!isJpeg(buf)) throw bad('Only JPEG photos can be added');
      const name = photoName();
      await fs.writeFile(path.join(dir, name), buf, { flag: 'wx' });
      return name;
    },
    async remove(name) {
      try { await fs.unlink(file(name)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    },
    async read(name) {
      try { return { type: typeOf(name), body: await fs.readFile(file(name)) }; } catch (e) {
        if (e.code === 'ENOENT') throw bad('That photo isn’t in the frame any more', 404);
        throw e;
      }
    },
  };
}

/** Demo mode: four made-up coloured "photos" in memory. */
export function createDemoPhotos(aspect) {
  const w = 1200, h = Math.round(w / aspect);
  const scenes = [
    ['#f2b880', '#c4572f', 'Sunset'], ['#a8d5e2', '#3d7ea6', 'Seaside'],
    ['#c9e4ca', '#55828b', 'Woodland'], ['#f6e7cb', '#a77e58', 'Fields'],
  ];
  const svg = ([sky, ground, label], i) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * (0.25 + i * 0.15)}" cy="${h * 0.3}" r="${h * 0.12}" fill="#fff8e1" opacity="0.9"/>
<path d="M0 ${h * 0.7} Q ${w * 0.3} ${h * 0.55} ${w * 0.6} ${h * 0.68} T ${w} ${h * 0.62} V ${h} H 0 Z" fill="${ground}"/>
<text x="${w / 2}" y="${h * 0.9}" font-family="Georgia, serif" font-size="${h * 0.08}" fill="#fff" text-anchor="middle">${label}</text></svg>`);
  const store = new Map(scenes.map((s, i) => [`2026-0${i + 1}-1${i}-120000-demo${i}0000000.svg`, { type: TYPES.svg, body: svg(s, i) }]));
  const pause = () => new Promise((r) => setTimeout(r, 600));
  return {
    async list() { return [...store.keys()].sort().reverse(); },
    async add(buf) {
      if (!isJpeg(buf)) throw bad('Only JPEG photos can be added');
      await pause();
      const name = photoName();
      store.set(name, { type: TYPES.jpg, body: buf });
      while (store.size > 40) store.delete([...store.keys()].sort()[0]);
      return name;
    },
    async remove(name) { store.delete(name); },
    async read(name) {
      const p = store.get(name);
      if (!p) throw bad('That photo isn’t in the frame any more', 404);
      return p;
    },
  };
}
