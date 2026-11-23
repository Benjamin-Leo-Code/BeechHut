import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import http from 'node:http';
import { loadConfig, DATA_DIR } from './config.js';
import { cached, HttpError, request } from './http.js';
import { createDirectAuth } from './directauth.js';
import { createUnraid } from './integrations/unraid.js';
import { createHomeAssistant } from './integrations/homeassistant.js';
import { createUnifi } from './integrations/unifi.js';
import { createLinks } from './integrations/links.js';
import { createNotes } from './integrations/notes.js';
import { createPhotos, createDemoPhotos } from './integrations/photos.js';
import { demo, demoLinks } from './demo.js';
import { buildOverview } from './overview.js';

const config = loadConfig();
const here = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'warn' } });

// ── Integrations ────────────────────────────────────────────────────────────
const i = config.demo
  ? { ...demo, links: config.links.length ? createLinks(config.links) : demoLinkStore() }
  : {
      unraid: config.unraid?.apiKey ? createUnraid(config.unraid) : null,
      homeassistant: config.homeassistant ? createHomeAssistant(config.homeassistant) : null,
      unifi: config.unifi?.apiKey ? createUnifi(config.unifi) : null,
      links: createLinks(config.links),
    };
const notes = createNotes(DATA_DIR);
const photos = config.demo ? createDemoPhotos(config.photoFrame.aspect)
  : config.photoFrame.dir ? createPhotos(config.photoFrame.dir) : null;
function demoLinkStore() {
  const store = createLinks(demoLinks.map((g) => ({ ...g, items: g.items.map((l) => ({ ...l, check: false })) })));
  return {
    async list() {
      const groups = await store.list();
      for (const l of groups.flatMap((g) => g.items)) {
        l.health = l.name.startsWith('Router') ? { up: false, status: 0, ms: null, error: 'ETIMEDOUT' } : { up: true, status: 200, ms: 4 + Math.round(Math.random() * 30) };
      }
      return groups;
    },
  };
}

// Short caches keep things snappy with several devices open, without going stale.
const c = {
  containers: i.unraid && cached(3000, () => i.unraid.containers()),
  system: i.unraid && cached(5000, () => i.unraid.system()),
  array: i.unraid && cached(15000, () => i.unraid.array()),
  vms: i.unraid && cached(3000, () => i.unraid.vms()),
  unraidNotifications: i.unraid && cached(30000, () => i.unraid.notifications()),
  haInfo: i.homeassistant && cached(60000, () => i.homeassistant.info()),
  haStates: i.homeassistant && cached(2000, () => i.homeassistant.states()),
  haContext: i.homeassistant && cached(60000, () => i.homeassistant.entityContext()),
  unifi: i.unifi && cached(10000, () => i.unifi.summary()),
  links: cached(30000, () => i.links.list()),
};

const need = (fn, name) => {
  if (!fn) throw Object.assign(new Error(`${name} isn't set up – add it on the add-on's Configuration tab`), { statusCode: 503 });
  return fn;
};

// ── Access control ──────────────────────────────────────────────────────────
// Two ways in, as an add-on:
//  • the HA sidebar/app (ingress, port 8099): HA has already signed the user in, so refuse
//    anything that didn't come via the Supervisor;
//  • direct access (port 8098, off unless mapped on the add-on's Network tab): users sign in
//    with their Home Assistant account, administrators only.
const INGRESS_PROXY = '172.30.32.2';
const DIRECT_PORT = Number(process.env.BEECHHUT_DIRECT_PORT || 8098);
const isDirect = (req) => config.addon && req.socket.localPort === DIRECT_PORT;
await app.register(fastifyCookie);

// How BeechHut's server reaches Home Assistant (for swapping sign-in codes for tokens):
// on the add-on network, at the port and scheme the Supervisor reports.
let haInternal = null;
async function haInternalUrl() {
  if (process.env.BEECHHUT_HA_DIRECT) return process.env.BEECHHUT_HA_DIRECT;
  if (!haInternal) {
    try {
      const r = await request('http://supervisor/core/info', { headers: { authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } });
      const ssl = Boolean(r.data?.ssl);
      const port = Number(r.data?.port);
      haInternal = `${ssl ? 'https' : 'http'}://homeassistant${port && port !== (ssl ? 443 : 80) ? `:${port}` : ''}`;
    } catch (e) {
      console.log(`[Direct access] couldn’t ask the Supervisor how to reach Home Assistant (${e.message})`);
      return 'http://homeassistant';
    }
  }
  return haInternal;
}

// Where the browser goes to sign in: the setting, else Home Assistant's own local network
// address, else the plain address of the machine the browser reached BeechHut on (port 80).
let haInternalBrowser;
async function haBrowserUrl(req) {
  if (config.homeAssistantUrl) return config.homeAssistantUrl;
  if (haInternalBrowser === undefined) {
    try { haInternalBrowser = (await request(`${config.homeassistant.url}/api/config`, { headers: { authorization: `Bearer ${config.homeassistant.token}` } })).internal_url || null; } catch { haInternalBrowser = null; }
  }
  if (haInternalBrowser) return haInternalBrowser.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/:\d+$/, '');
  return `http://${host}`;
}
const directAuth = config.addon ? createDirectAuth({ dataDir: DATA_DIR, haInternalUrl, haBrowserUrl, log: (m) => console.log(`[Direct access] ${m}`) }) : null;

if (config.addon) {
  app.addHook('onRequest', async (req, reply) => {
    if (isDirect(req)) {
      const url = req.url.split('?')[0];
      if (url.startsWith('/auth/') || url === '/icon.svg') return; // sign-in pages and their icon
      const user = await directAuth.check(req);
      if (user) { req.user = user; return; }
      // Only a page being opened goes to sign-in; anything else (API calls, images) just gets 401,
      // so background requests can never start a sign-in by themselves.
      const opening = req.method === 'GET' && (req.headers['sec-fetch-mode'] === 'navigate' || String(req.headers.accept || '').includes('text/html'));
      if (!opening) return reply.code(401).send({ error: 'Please sign in again', signIn: true });
      return reply.redirect('/auth/login');
    }
    const ip = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (ip !== INGRESS_PROXY && ip !== '127.0.0.1') return reply.code(403).send({ error: 'Open BeechHut from the Home Assistant sidebar' });
  });
}

// Sign-in pages, for direct access only.
const directOnly = (fn) => async (req, reply) => (isDirect(req) ? fn(req, reply) : reply.code(404).send({ error: 'Not found' }));
app.get('/auth/login', directOnly((req, reply) => directAuth.login(req, reply)));
app.get('/auth/callback', directOnly((req, reply) => directAuth.callback(req, reply)));
app.get('/auth/logout', directOnly((req, reply) => directAuth.logout(req, reply)));

app.setErrorHandler((err, _req, reply) => {
  // Our own errors (and Fastify's) carry statusCode. Anything from an upstream system is a 502/504.
  const status = err.statusCode ?? (err instanceof HttpError ? (err.status === 504 ? 504 : 502) : 500);
  app.log.warn(err);
  reply.code(status).send({ error: err.message || 'Something went wrong' });
});

// ── API ─────────────────────────────────────────────────────────────────────
app.get('/api/meta', async (req) => ({
  user: req.user?.name ?? null,
  title: config.title,
  subtitle: config.subtitle,
  demo: config.demo,
  addon: config.addon,
  integrations: { unraid: Boolean(i.unraid), homeassistant: Boolean(i.homeassistant), unifi: Boolean(i.unifi) },
  webUrls: {
    unraid: config.unraid?.webUrl || (config.demo ? 'http://192.168.1.10' : null),
    unifi: config.unifi?.webUrl || (config.demo ? 'https://192.168.1.1' : null),
  },
  haVmName: config.homeassistant?.vmName || 'Home Assistant',
  housePlanUrl: config.housePlanUrl,
  photoFrame: photos ? { aspect: config.photoFrame.aspect } : null,
}));

app.get('/api/overview', async () => buildOverview({ c, config }));

// Unraid: containers, system, array, VMs
app.get('/api/containers', async () => need(c.containers, 'Unraid')());
app.post('/api/containers/:id/:action', async (req) => {
  const r = await need(i.unraid, 'Unraid').containerAction(req.params.id, req.params.action);
  c.containers.invalidate();
  return r;
});
app.get('/api/unraid/system', async () => need(c.system, 'Unraid')());
app.get('/api/unraid/array', async () => need(c.array, 'Unraid')());
app.get('/api/unraid/vms', async () => need(c.vms, 'Unraid')());
app.get('/api/unraid/notifications', async () => need(c.unraidNotifications, 'Unraid')());
app.post('/api/unraid/vms/:id/:action', async (req) => {
  const r = await need(i.unraid, 'Unraid').vmAction(req.params.id, req.params.action);
  c.vms.invalidate();
  return r;
});

// Home Assistant
app.get('/api/ha/info', async () => need(c.haInfo, 'Home Assistant')());
app.get('/api/ha/states', async () => need(c.haStates, 'Home Assistant')());
app.post('/api/ha/service', async (req) => {
  const { domain, service, data } = req.body || {};
  const r = await need(i.homeassistant, 'Home Assistant').callService(domain, service, data);
  c.haStates.invalidate();
  return r;
});
app.post('/api/ha/check-config', async () => need(i.homeassistant, 'Home Assistant').checkConfig());

// UniFi
app.get('/api/unifi', async () => need(c.unifi, 'UniFi')());
app.post('/api/unifi/devices/:id/restart', async (req) => need(i.unifi, 'UniFi').restartDevice(req.params.id));

// Links & notes
app.get('/api/links', async () => c.links());
app.get('/api/notes', async () => notes.list());
app.post('/api/notes', async (req) => notes.save(req.body || {}));
app.delete('/api/notes/:id', async (req) => notes.remove(req.params.id));

// Photo frame. Photos arrive already cropped on the phone, as JPEG bodies.
app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 }, (_req, body, done) => done(null, body));
app.get('/api/photos', async () => need(photos, 'The photo frame').list());
app.post('/api/photos', { bodyLimit: 25 * 1024 * 1024 }, async (req) => {
  if (!Buffer.isBuffer(req.body)) throw Object.assign(new Error('Send the photo as image/jpeg'), { statusCode: 415 });
  return { name: await need(photos, 'The photo frame').add(req.body) };
});
app.delete('/api/photos/:name', async (req) => {
  await need(photos, 'The photo frame').remove(req.params.name);
  return { ok: true };
});
app.get('/api/photos/:name', async (req, reply) => {
  const p = await need(photos, 'The photo frame').read(req.params.name);
  // Names are unique and never reused, so the browser can keep them.
  return reply.header('cache-control', 'private, max-age=31536000, immutable').type(p.type).send(p.body);
});

// ── Front end ───────────────────────────────────────────────────────────────
const dist = path.resolve(here, '../web/dist');
if (fs.existsSync(dist)) {
  await app.register(fastifyStatic, {
    root: dist,
    setHeaders: (reply, file) => {
      // Hashed build assets never change; everything else should revalidate.
      reply.header('cache-control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
// Direct access: the same app on a second port. It's only reachable if the port is mapped
// on the add-on's Network tab.
if (config.addon) http.createServer((req, res) => app.routing(req, res)).listen(DIRECT_PORT, '0.0.0.0');
console.log(`BeechHut listening on :${config.port}${config.demo ? ' (demo mode)' : ''}${config.addon ? ' (Home Assistant add-on)' : ''}`);
