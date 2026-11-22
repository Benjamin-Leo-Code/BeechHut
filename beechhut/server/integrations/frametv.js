import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
// The ws library rather than undici's WebSocket, so the connection can be made without
// asking for compression, the same way the samsungtvws library connects.
import WebSocket from 'ws';

/*
 * Samsung The Frame: Art Mode over the TV's local WebSocket API (port 8002).
 * Samsung doesn't document this; it follows the protocol used by the open-source
 * samsungtvws library. Requests go out as "art_app_request" messages and answers
 * come back as "d2d_service_message" events. Image data travels over a separate
 * plain socket that the TV opens for each transfer.
 */

const MY_PHOTOS = 'MY-C0002';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const IDLE_CLOSE = 60_000;

const fail = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const offline = () => fail('The Frame TV isn’t answering. It needs to be on, or in Art Mode, and on the network.', 503);
const checkId = (id) => { if (!SAFE_ID.test(String(id))) throw fail('That isn’t a photo on the Frame TV', 400); return id; };
const idNumber = (id) => Number(String(id).match(/(\d+)$/)?.[1] ?? 0);

/** Send or receive one file over the TV's data socket. */
function transfer(info, { send, timeout = 60_000 }) {
  return new Promise((resolve, reject) => {
    const opts = { host: info.ip, port: Number(info.port) };
    const sock = info.secured ? tls.connect({ ...opts, rejectUnauthorized: false }) : net.connect(opts);
    const chunks = [];
    let size = 0;
    sock.setTimeout(timeout, () => sock.destroy(new Error('Timed out talking to the Frame TV')));
    sock.on('error', reject);
    sock.once(info.secured ? 'secureConnect' : 'connect', () => {
      if (!send) return;
      const header = Buffer.from(JSON.stringify({
        num: 0, total: 1, fileLength: send.length, fileName: 'beechhut', fileType: 'jpg', secKey: info.key, version: '0.0.1',
      }), 'ascii');
      const len = Buffer.alloc(4);
      len.writeUInt32BE(header.length);
      sock.write(Buffer.concat([len, header, send]), () => sock.end());
      resolve();
    });
    if (send) return;
    // Receiving: 4-byte header length, JSON header (with fileLength), then the file.
    sock.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      const all = Buffer.concat(chunks);
      if (all.length < 4) return;
      const hl = all.readUInt32BE(0);
      if (all.length < 4 + hl) return;
      const header = JSON.parse(all.subarray(4, 4 + hl).toString());
      const body = all.subarray(4 + hl);
      if (body.length >= header.fileLength) { sock.destroy(); resolve(body.subarray(0, header.fileLength)); }
    });
    sock.on('end', () => reject(new Error(`The Frame TV stopped sending after ${size} bytes`)));
  });
}

export function createFrameTv({ host, dataDir, matte = 'none', name = 'BeechHut', log = (m) => console.log(`[Frame TV] ${m}`) }) {
  const tokenFile = path.join(dataDir, 'frame-tv.json');
  let ws = null, opening = null, idle = null;
  let waiters = [];            // { event, resolve, reject, timer }
  let chain = Promise.resolve(); // one request at a time, so answers can't get mixed up
  const thumbs = new Map();

  // What worked last time: the permission token (if the TV gave one) and the port.
  const readSaved = async () => { try { return JSON.parse(await fs.readFile(tokenFile, 'utf8')); } catch { return {}; } };
  const save = async (saved) => { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(tokenFile, JSON.stringify(saved)); };

  function close() {
    clearTimeout(idle);
    try { ws?.close(); } catch { /* already closed */ }
    ws = null;
    opening = null;
    for (const w of waiters) { clearTimeout(w.timer); w.reject(offline()); }
    waiters = [];
  }

  function onMessage(raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.event !== 'd2d_service_message') return;
    let data;
    try { data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data; } catch { return; }
    if (!data?.event) return;
    if (data.event === 'error') {
      log(`TV reported error ${data.error_code ?? 'unknown'} for ${data.request ?? 'a request'}`);
      const err = fail(`The Frame TV said no (error ${data.error_code ?? 'unknown'})`);
      for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.reject(err); }
      return;
    }
    const i = waiters.findIndex((w) => w.event === data.event);
    if (i < 0) return;
    const [w] = waiters.splice(i, 1);
    clearTimeout(w.timer);
    w.resolve(data);
  }

  /**
   * Open one of the TV's channels and wait until it's ready.
   * Resolves with the socket and any token the TV handed out.
   */
  function channel(path, token, limit, port) {
    // 8002 is the encrypted port; 8001 the older plain one, which some Frames still answer on.
    const scheme = port === 8001 ? 'ws' : 'wss';
    const url = `${scheme}://${host}:${port}/api/v2/channels/${path}?name=${Buffer.from(name).toString('base64')}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    const label = `${path.split('.').pop()} channel (port ${port})`;
    log(`connecting to ${label}${token ? ' with saved permission' : ''}`);
    return new Promise((resolve, reject) => {
      const sock = new WebSocket(url, { perMessageDeflate: false, rejectUnauthorized: false, handshakeTimeout: 10_000 });
      let opened = false, connected = false, settled = false, got = null;
      const timer = setTimeout(() => {
        log(`${label}: no answer after ${limit / 1000} s (connection ${opened ? 'open' : 'never opened'})`);
        done(opened ? fail(token
          ? 'The Frame TV connected but didn’t reply. Turn it on (or to Art Mode) and try again.'
          : 'The Frame TV didn’t ask for permission in time. Check its screen for a message asking to allow BeechHut, choose Allow and try again.', 504) : offline());
      }, limit);
      function done(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { try { sock.close(); } catch { /* */ } reject(err); } else resolve({ sock, token: got });
      }
      sock.onopen = () => { opened = true; log(`${label}: connection open, waiting for the TV`); };
      sock.onmessage = (e) => {
        if (settled) return;
        let msg;
        const text = String(e.data);
        // Show exactly what the TV said (without the token), to help with odd models.
        log(`${label}: received ${text.replace(/"token"\s*:\s*"[^"]*"/g, '"token":"…"').slice(0, 300)}`);
        try { msg = JSON.parse(text); } catch { return; }
        if (msg.event === 'ms.channel.connect') {
          connected = true;
          got = msg.data?.token || null;
          // Art Mode follows up with ms.channel.ready on most Frames; some never do.
          if (path === 'samsung.remote.control') done(); else setTimeout(() => done(), 1500);
        } else if (msg.event === 'ms.channel.ready') done();
        else if (msg.event === 'ms.channel.unauthorized') done(fail('The Frame TV didn’t allow BeechHut. On the TV, go to Settings → General → External Device Manager → Device Connection Manager → Device List, allow BeechHut (or delete it from the list) and try again.', 403));
        else if (msg.event === 'ms.channel.timeOut') done(fail('The Frame TV’s permission message timed out. Try again and choose Allow on the TV.', 504));
      };
      sock.onerror = (e) => { if (!connected) { log(`${label}: connection failed (${e?.error?.message || e?.message || 'no details'})`); done(offline()); } };
      sock.onclose = (e) => { if (!settled) { log(`${label}: closed by the TV (code ${e.code})`); done(offline()); } };
    });
  }

  /** The TV's own description of itself (no login needed), written to the log to help with problems. */
  async function describeTv() {
    try {
      const res = await fetch(`http://${host}:8001/api/v2/`, { signal: AbortSignal.timeout(5000) });
      const info = await res.json();
      const d = info.device || {};
      let support = {};
      try { support = typeof info.isSupport === 'string' ? JSON.parse(info.isSupport) : info.isSupport || {}; } catch { /* */ }
      log(`TV says: model ${d.modelName ?? '?'}, Frame ${d.FrameTVSupport ?? '?'}, power ${d.PowerState ?? '?'}, `
        + `token sign-in ${d.TokenAuthSupport ?? '?'}, remote control ${support.remote_available ?? '?'}, `
        + `version ${info.version ?? '?'}, network ${d.networkType ?? '?'}`);
    } catch (e) {
      log(`couldn’t read the TV’s information page on port 8001 (${e.cause?.code || e.name || e.message})`);
    }
  }

  function open() {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (opening) return opening;
    opening = (async () => {
      const saved = await readSaved();
      let { token = '', port } = saved;
      if (!port) {
        await describeTv();
        // First time: the TV asks "Allow BeechHut?" for a remote-control connection, and the
        // permission it gives there then works for Art Mode too. Try the encrypted port, then
        // the older plain one, which some Frames answer on instead.
        let lastErr;
        for (const p of [8002, 8001]) {
          try {
            const pair = await channel('samsung.remote.control', '', 30_000, p);
            try { pair.sock.close(); } catch { /* */ }
            token = pair.token || '';
            port = p;
            await save({ token, port });
            log(`permission granted on port ${p}${token ? ' and saved' : ' (the TV didn’t need a token)'}`);
            break;
          } catch (e) {
            lastErr = e;
            if (e.statusCode === 403) throw e; // the TV said no; don't try another way round
          }
        }
        if (!port) throw lastErr;
      }
      let art;
      try { art = await channel('com.samsung.art-app', token, 15_000, port); } catch (e) {
        // Connected but silent with saved settings: they may no longer be valid, so start afresh next time.
        if (e.statusCode === 504) { await fs.rm(tokenFile, { force: true }); log('forgot the saved permission; the next try will ask the TV again'); }
        throw e;
      }
      if (art.token && art.token !== token) await save({ token: art.token, port });
      ws = art.sock;
      ws.onmessage = (e) => onMessage(e.data);
      ws.onclose = () => { log('Art Mode connection closed'); if (ws === art.sock) close(); };
      ws.onerror = () => {};
    })().finally(() => { opening = null; });
    return opening;
  }

  function waitFor(event, timeout = 20_000) {
    let w;
    const p = new Promise((resolve, reject) => {
      w = { event, resolve, reject, timer: setTimeout(() => { waiters = waiters.filter((x) => x !== w); reject(fail('The Frame TV took too long to answer', 504)); }, timeout) };
    });
    waiters.push(w);
    p.catch(() => {}); // handled by whoever awaits it
    return p;
  }

  function send(request) {
    const id = crypto.randomUUID();
    ws.send(JSON.stringify({
      method: 'ms.channel.emit',
      params: { event: 'art_app_request', to: 'host', data: JSON.stringify({ ...request, id, request_id: id }) },
    }));
  }

  /** Run fn with an open connection, one at a time; the connection closes after a minute idle. */
  function session(fn) {
    const run = chain.then(async () => {
      clearTimeout(idle);
      try {
        await open();
        return await fn();
      } catch (e) {
        if (e.statusCode !== 400) close(); // start afresh next time
        throw e;
      } finally {
        clearTimeout(idle);
        idle = setTimeout(close, IDLE_CLOSE);
      }
    });
    chain = run.catch(() => {});
    return run;
  }

  const ask = async (request, event, timeout) => {
    const answer = waitFor(event, timeout);
    send(request);
    return answer;
  };
  const connInfo = () => ({ d2d_mode: 'socket', connection_id: crypto.randomInt(2 ** 31), id: crypto.randomUUID() });
  const parseInfo = (r) => (typeof r.conn_info === 'string' ? JSON.parse(r.conn_info) : r.conn_info);

  return {
    /** Your own photos on the TV (My Photos), newest first, and which one is showing. */
    list: () => session(async () => {
      const r = await ask({ request: 'get_content_list', category: MY_PHOTOS }, 'content_list');
      const items = (typeof r.content_list === 'string' ? JSON.parse(r.content_list) : r.content_list || [])
        .filter((c) => c.category_id === MY_PHOTOS && SAFE_ID.test(c.content_id));
      let current = null;
      try { current = (await ask({ request: 'get_current_artwork' }, 'current_artwork', 8000)).content_id ?? null; } catch { /* older firmware */ }
      return items
        .map((c) => ({ id: c.content_id, showing: c.content_id === current }))
        .sort((a, b) => idNumber(b.id) - idNumber(a.id));
    }),
    add: (jpeg) => session(async () => {
      const now = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const r = await ask({
        request: 'send_image', file_type: 'jpg', conn_info: connInfo(),
        image_date: `${now.getFullYear()}:${p(now.getMonth() + 1)}:${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`,
        matte_id: matte, portrait_matte_id: matte, file_size: jpeg.length,
      }, 'ready_to_use');
      const added = waitFor('image_added', 90_000);
      await transfer(parseInfo(r), { send: jpeg });
      return { id: (await added).content_id };
    }),
    remove: (id) => session(async () => {
      checkId(id);
      await ask({ request: 'delete_image_list', content_id_list: [{ content_id: id }] }, 'image_deleted');
      thumbs.delete(id);
    }),
    show: (id) => session(async () => {
      checkId(id);
      const selected = waitFor('image_selected', 5000);
      send({ request: 'select_image', content_id: id, category_id: null, show: true });
      await selected.catch(() => {}); // not every Frame confirms
    }),
    /** Switch the TV to Art Mode (does nothing if it's already there). */
    artMode: () => session(async () => {
      log('switching to Art Mode');
      const answer = waitFor('artmode_status', 5000);
      send({ request: 'set_artmode_status', value: 'on' });
      await answer.catch(() => {}); // not every Frame confirms
    }),
    thumbnail: async (id) => {
      checkId(id);
      if (thumbs.has(id)) return thumbs.get(id);
      const body = await session(async () => {
        const r = await ask({ request: 'get_thumbnail', content_id: id, conn_info: connInfo() }, 'ready_to_use');
        return transfer(parseInfo(r), {});
      });
      const thumb = { type: body[0] === 0x89 ? 'image/png' : 'image/jpeg', body };
      thumbs.set(id, thumb);
      if (thumbs.size > 300) thumbs.delete(thumbs.keys().next().value);
      return thumb;
    },
  };
}

/** Demo mode: a pretend Frame TV with three pieces in My Photos. */
export function createDemoFrameTv() {
  const scenes = [['#1f3b4d', '#d9a441', 'Harbour'], ['#3d5a40', '#e8d8b0', 'Meadow'], ['#5b3a52', '#f0c9a8', 'Dusk']];
  const svg = ([bg, fg, label]) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<rect width="640" height="360" fill="${bg}"/><rect x="40" y="40" width="560" height="280" fill="none" stroke="${fg}" stroke-width="6"/>
<circle cx="320" cy="160" r="60" fill="${fg}"/><text x="320" y="285" font-family="Georgia, serif" font-size="30" fill="${fg}" text-anchor="middle">${label}</text></svg>`);
  const store = new Map(scenes.map((s, i) => [`MY_F000${i + 1}`, { type: 'image/svg+xml', body: svg(s) }]));
  let next = 4, showing = 'MY_F0003';
  const pause = () => new Promise((r) => setTimeout(r, 800));
  return {
    async list() { return [...store.keys()].sort((a, b) => idNumber(b) - idNumber(a)).map((id) => ({ id, showing: id === showing })); },
    async add(jpeg) { await pause(); const id = `MY_F${String(next++).padStart(4, '0')}`; store.set(id, { type: 'image/jpeg', body: jpeg }); return { id }; },
    async remove(id) { store.delete(id); },
    async show(id) { checkId(id); showing = id; },
    async artMode() { await pause(); },
    async thumbnail(id) { const t = store.get(id); if (!t) throw fail('That isn’t a photo on the Frame TV', 404); return t; },
  };
}
