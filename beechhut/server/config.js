import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

/** Running as a Home Assistant add-on – the Supervisor injects this token. */
export const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);

const OPTIONS_PATH = process.env.BEECHHUT_OPTIONS || '/data/options.json';
// Optional advanced config: /addon_configs/<slug>/config.yaml on the HA host (mounted at /config).
const CONFIG_PATH = path.resolve(process.env.BEECHHUT_CONFIG || (ADDON ? '/config/config.yaml' : 'config.yaml'));
// Home Assistant's own config folder (mapped in as homeassistant_config).
const HA_CONFIG_DIR = path.resolve(process.env.BEECHHUT_HA_CONFIG || (ADDON ? '/homeassistant' : 'ha-config'));
export const DATA_DIR = path.resolve(process.env.BEECHHUT_DATA || (ADDON ? '/data' : 'data'));

/** Replace ${VAR} and ${VAR:-default} with environment values, recursively. */
function interpolate(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z0-9_]+)(?::-([^}]*))?\}/g, (_, name, fallback) => process.env[name] ?? fallback ?? '');
  }
  if (Array.isArray(value)) return value.map(interpolate);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v)]));
  }
  return value;
}

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; } };
const readYaml = (p) => { try { return YAML.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { return {}; } };
const trimSlash = (u) => (u ? String(u).replace(/\/+$/, '') : u);
const blank = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
/** First non-blank value. */
const pick = (...vals) => vals.find((v) => !blank(v));

/**
 * The photo frame folder, written the way Home Assistant users see it:
 * /config/www/photo-frame, www/photo-frame or /local/photo-frame all mean the same folder.
 * It has to be inside Home Assistant's config folder.
 */
function photoFrameDir(value) {
  let v = String(value || '').trim().replace(/\\/g, '/');
  if (!v) return null;
  v = v.replace(/^\/(config|homeassistant)(\/|$)/, '').replace(/^\/local(\/|$)/, 'www/').replace(/^\/+/, '');
  const dir = path.resolve(HA_CONFIG_DIR, v);
  if (dir !== HA_CONFIG_DIR && !dir.startsWith(HA_CONFIG_DIR + path.sep)) return null;
  return dir === HA_CONFIG_DIR ? null : dir;
}

/** Frame shape as width:height (e.g. 238:162 or 3:2) or a single ratio (1.47). */
function aspectOf(value, fallback = 238 / 162) {
  const m = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*(?:[:x×/]\s*(\d+(?:\.\d+)?))?$/i);
  const r = m ? Number(m[1]) / (m[2] ? Number(m[2]) : 1) : NaN;
  return r > 0.2 && r < 5 ? r : fallback;
}

/** Flat add-on `links` option (each with an optional group) → grouped links. */
function groupLinks(flat = []) {
  const groups = new Map();
  for (const { group, ...l } of flat) {
    const g = group || 'Links';
    groups.set(g, [...(groups.get(g) || []), l]);
  }
  return [...groups].map(([name, items]) => ({ name, items }));
}

export function loadConfig() {
  const o = readJson(OPTIONS_PATH);          // add-on options page
  const y = interpolate(readYaml(CONFIG_PATH)); // optional config.yaml
  const unraidUrl = trimSlash(pick(o.unraid_url, y.unraid?.url));
  const unifiUrl = trimSlash(pick(o.unifi_url, y.unifi?.url));

  // Inside HA we talk to Core through the Supervisor proxy with the injected token.
  const haUrl = ADDON ? 'http://supervisor/core' : trimSlash(y.homeassistant?.url);
  const haToken = ADDON ? process.env.SUPERVISOR_TOKEN : y.homeassistant?.token;

  return {
    addon: ADDON,
    title: pick(o.title, y.title) || 'BeechHut',
    subtitle: pick(o.subtitle, y.subtitle) || '',
    port: Number(process.env.PORT || (ADDON ? 8099 : 8484)),
    demo: process.env.BEECHHUT_DEMO === '1',
    unraid: unraidUrl ? {
      url: unraidUrl,
      webUrl: trimSlash(pick(o.unraid_web_url, y.unraid?.webUrl, unraidUrl)),
      apiKey: pick(o.unraid_api_key, y.unraid?.apiKey) || '',
      insecure: y.unraid?.insecure !== false,
      // Address used to turn Unraid "WebUI" templates into links
      hostAddress: pick(o.unraid_host_address, y.unraid?.hostAddress) || new URL(unraidUrl).hostname,
      favourites: pick(o.favourite_containers, y.unraid?.favourites) || [],
      hide: pick(o.hidden_containers, y.unraid?.hide) || [],
      urls: y.unraid?.urls || {},
    } : null,
    homeassistant: haUrl && haToken ? {
      url: haUrl,
      wsUrl: process.env.BEECHHUT_HA_WS || `${haUrl.replace(/^http/, 'ws')}${ADDON ? '/websocket' : '/api/websocket'}`,
      token: haToken,
      vmName: pick(o.ha_vm_name, y.homeassistant?.vmName) || 'Home Assistant',
      lowBattery: Number(pick(o.low_battery, y.homeassistant?.lowBattery) ?? 20),
      hide: pick(o.hidden_entities, y.homeassistant?.hide) || [],
      insecure: true,
    } : null,
    unifi: unifiUrl ? {
      url: unifiUrl,
      webUrl: trimSlash(pick(y.unifi?.webUrl, unifiUrl)),
      apiKey: pick(o.unifi_api_key, y.unifi?.apiKey) || '',
      site: pick(o.unifi_site, y.unifi?.site) || 'default',
      apiBase: trimSlash(pick(o.unifi_api_base, y.unifi?.apiBase) || '/proxy/network/integration/v1'),
      insecure: y.unifi?.insecure !== false,
    } : null,
    // Where the house plan folder (plan.json + scans) is served, e.g. /local/<folder>/house-plan/.
    // The browser loads it directly, so a path on Home Assistant needs no extra set-up.
    housePlanUrl: (() => {
      const url = String(process.env.BEECHHUT_HOUSE_PLAN_URL || pick(o.house_plan_url, y.house_plan?.url) || '').trim();
      return url ? url.replace(/\/*$/, '/') : '';
    })(),
    // Photos for the photo frame: a folder in Home Assistant's config folder (usually under www).
    photoFrame: {
      dir: photoFrameDir(process.env.BEECHHUT_PHOTO_FRAME_FOLDER || pick(o.photo_frame_folder, y.photo_frame?.folder)),
      aspect: aspectOf(pick(o.photo_frame_shape, y.photo_frame?.shape)),
    },
    // Samsung The Frame: its address on the network (an IP address is best) and the mat for uploads.
    frameTv: (() => {
      const host = String(process.env.BEECHHUT_FRAME_TV || pick(o.frame_tv_address, y.frame_tv?.address) || '')
        .trim().replace(/^[a-z]+:\/\//i, '').replace(/[:/].*$/, '');
      return host ? {
        host,
        matte: String(pick(o.frame_tv_matte, y.frame_tv?.matte) || 'none').trim(),
        // Make an input_button in Home Assistant that switches the TV to Art Mode.
        haButton: pick(o.frame_tv_art_mode_button, y.frame_tv?.artModeButton) !== false,
      } : null;
    })(),
    links: !blank(o.links) ? groupLinks(o.links) : Array.isArray(y.links) ? y.links : [],
  };
}
