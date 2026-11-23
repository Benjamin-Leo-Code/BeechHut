import { request } from '../http.js';

const KEEP_ATTRS = [
  'brightness', 'current_temperature', 'temperature', 'target_temp_low', 'target_temp_high', 'hvac_action',
  'current_position', 'installed_version', 'latest_version', 'title', 'release_url', 'in_progress',
  'media_title', 'source', 'volume_level', 'battery_level',
];

const SAFE = /^[a-z0-9_]+$/;

export function createHomeAssistant(cfg) {
  const api = (path, opts = {}) =>
    request(`${cfg.url}/api${path}`, { headers: { authorization: `Bearer ${cfg.token}` }, insecure: cfg.insecure, ...opts });

  const hidden = (id) => cfg.hide.some((p) => (p.endsWith('*') ? id.startsWith(p.slice(0, -1)) : id === p));

  return {
    async info() {
      const c = await api('/config');
      return { version: c.version, name: c.location_name, state: c.state, safeMode: c.safe_mode };
    },
    async states() {
      const raw = await api('/states', { timeout: 15000 });
      return raw
        .filter((s) => !hidden(s.entity_id))
        .map((s) => {
          const a = s.attributes || {};
          const attrs = {};
          for (const k of KEEP_ATTRS) if (a[k] !== undefined) attrs[k] = a[k];
          return {
            id: s.entity_id,
            domain: s.entity_id.split('.')[0],
            name: a.friendly_name || s.entity_id,
            state: s.state,
            unit: a.unit_of_measurement || null,
            deviceClass: a.device_class || null,
            changed: s.last_changed,
            attrs,
          };
        });
    },
    async callService(domain, service, data = {}) {
      if (!SAFE.test(domain) || !SAFE.test(service)) throw Object.assign(new Error('Invalid service'), { statusCode: 400 });
      await api(`/services/${domain}/${service}`, { method: 'POST', body: data, timeout: 30000 });
      return { ok: true };
    },
    /** The device each unavailable entity belongs to, as { entity_id: device name }, via HA's template API. */
    async unavailableDevices() {
      const template = [
        '{%- set ns = namespace(out=[]) -%}',
        "{%- for s in states if s.state == 'unavailable' -%}",
        '{%- set d = device_id(s.entity_id) -%}',
        "{%- set ns.out = ns.out + [[s.entity_id, ((device_attr(d, 'name_by_user') or device_attr(d, 'name') or '') if d else '')]] -%}",
        '{%- endfor -%}',
        '{{ ns.out | tojson }}',
      ].join('');
      let pairs = await api('/template', { method: 'POST', body: { template }, timeout: 15000 });
      if (typeof pairs === 'string') pairs = JSON.parse(pairs);
      const map = {};
      for (const [id, name] of Array.isArray(pairs) ? pairs : []) if (id && name) map[id] = String(name);
      return map;
    },
    async checkConfig() {
      return api('/config/core/check_config', { method: 'POST', timeout: 60000 });
    },
  };
}
