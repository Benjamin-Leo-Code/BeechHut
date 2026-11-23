/**
 * In-memory stand-ins for every integration so the console can be previewed
 * (BEECHHUT_DEMO=1) without access to the real house. Actions mutate state.
 */
const now = Date.now();
const mins = (m) => now - m * 60000;
const KiB = (tb) => Math.round(tb * 1024 ** 3 * 1000 / 1024); // decimal TB → KiB-ish, good enough for demo

const icon = (n) => `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${n}.svg`;
const containers = [
  ['plex', 'plexinc/pms-docker', 'running', 32400, 'plex', '/web'],
  ['sonarr', 'linuxserver/sonarr', 'running', 8989, 'sonarr'],
  ['radarr', 'linuxserver/radarr', 'running', 7878, 'radarr'],
  ['prowlarr', 'linuxserver/prowlarr', 'running', 9696, 'prowlarr'],
  ['qbittorrent', 'linuxserver/qbittorrent', 'running', 8085, 'qbittorrent'],
  ['immich', 'ghcr.io/imagegenius/immich', 'running', 8081, 'immich'],
  ['paperless-ngx', 'ghcr.io/paperless-ngx/paperless-ngx', 'running', 8000, 'paperless-ngx'],
  ['vaultwarden', 'vaultwarden/server', 'running', 4743, 'vaultwarden'],
  ['nginx-proxy-manager', 'jc21/nginx-proxy-manager', 'running', 81, 'nginx-proxy-manager'],
  ['mariadb', 'linuxserver/mariadb', 'running', null, 'mariadb'],
  ['redis', 'redis:7', 'running', null, 'redis'],
  ['tailscale', 'tailscale/tailscale', 'running', null, 'tailscale'],
  ['nextcloud', 'linuxserver/nextcloud', 'exited', 4443, 'nextcloud'],
  ['tautulli', 'linuxserver/tautulli', 'exited', 8181, 'tautulli'],
].map(([name, image, state, port, ic, path = '']) => ({
  id: `${name}-${'0123456789abcdef'.repeat(4)}`.slice(0, 64),
  name, image, state,
  status: state === 'running' ? `Up ${Math.floor(Math.random() * 20) + 2} days` : 'Exited (0) 3 days ago',
  created: mins(60 * 24 * 40),
  ports: port ? [{ private: port, public: port, type: 'tcp' }] : [],
  network: name === 'plex' ? 'host' : 'bridge',
  icon: ic ? icon(ic) : null,
  url: port ? `http://192.168.1.10:${port}${path}` : null,
  favourite: ['plex', 'immich', 'paperless-ngx', 'vaultwarden'].includes(name),
  autoStart: name !== 'tautulli',
}));

const vms = [
  { id: 'vm-ha', name: 'Home Assistant', state: 'running' },
  { id: 'vm-win', name: 'Windows 11', state: 'shutoff' },
];

const sensor = (id, name, state, unit, deviceClass, attrs = {}) => ({ id, domain: id.split('.')[0], name, state: String(state), unit, deviceClass, changed: new Date(mins(Math.random() * 300)).toISOString(), attrs });
const entities = [
  sensor('light.kitchen', 'Kitchen', 'on', null, null, { brightness: 200 }),
  sensor('light.living_room_lamp', 'Living room lamp', 'off', null, null),
  sensor('light.hallway', 'Hallway', 'off', null, null),
  sensor('light.garden', 'Garden lights', 'off', null, null),
  sensor('light.bedroom', 'Bedroom', 'on', null, null, { brightness: 90 }),
  sensor('switch.dehumidifier', 'Dehumidifier', 'on', null, 'outlet'),
  sensor('switch.office_heater', 'Office heater', 'off', null, 'outlet'),
  sensor('switch.christmas_tree', 'Christmas tree', 'off', null, 'outlet'),
  sensor('climate.hive_heating', 'Heating', 'heat', null, null, { current_temperature: 19.4, temperature: 20, hvac_action: 'heating' }),
  sensor('climate.hive_hot_water', 'Hot water', 'off', null, null),
  sensor('cover.garage_door', 'Garage door', 'closed', null, 'garage'),
  sensor('lock.front_door', 'Front door', 'locked', null, null),
  sensor('sensor.living_room_temperature', 'Living room temperature', 20.6, '°C', 'temperature'),
  sensor('sensor.outside_temperature', 'Outside temperature', 6.2, '°C', 'temperature'),
  sensor('sensor.living_room_humidity', 'Living room humidity', 54, '%', 'humidity'),
  sensor('sensor.house_power', 'House power', 412, 'W', 'power'),
  sensor('sensor.energy_today', 'Energy today', 8.7, 'kWh', 'energy'),
  sensor('sensor.front_door_battery', 'Front door lock battery', 14, '%', 'battery'),
  sensor('sensor.garden_motion_battery', 'Garden motion battery', 63, '%', 'battery'),
  sensor('sensor.hallway_motion_battery', 'Hallway motion battery', 9, '%', 'battery'),
  sensor('binary_sensor.back_door', 'Back door', 'off', null, 'door'),
  sensor('binary_sensor.garden_motion', 'Garden motion', 'off', null, 'motion'),
  sensor('binary_sensor.washing_machine', 'Washing machine running', 'on', null, 'running'),
  sensor('sensor.bin_day', 'Next bin collection', 'Recycling – Thursday', null, null),
  sensor('person.ben', 'Ben', 'home', null, null),
  sensor('automation.morning_heating', 'Morning heating boost', 'on', null, null),
  sensor('automation.garden_lights_at_sunset', 'Garden lights at sunset', 'on', null, null),
  sensor('automation.away_mode', 'Away mode', 'off', null, null),
  sensor('scene.movie_night', 'Movie night', 'scening', null, null),
  sensor('scene.all_off', 'Everything off', 'scening', null, null),
  sensor('script.goodnight', 'Goodnight', 'off', null, null),
  sensor('update.home_assistant_core_update', 'Home Assistant Core update', 'on', null, 'firmware', { installed_version: '2026.10.4', latest_version: '2026.11.1', title: 'Home Assistant Core' }),
  sensor('update.hacs_update', 'HACS update', 'off', null, null, { installed_version: '2.1.0', latest_version: '2.1.0', title: 'HACS' }),
  sensor('update.zigbee2mqtt_update', 'Zigbee2MQTT update', 'on', null, null, { installed_version: '2.6.1', latest_version: '2.7.0', title: 'Zigbee2MQTT' }),
  sensor('sensor.boiler_pressure', 'Boiler pressure', 'unavailable', 'bar', 'pressure'),
  sensor('sensor.shed_temperature', 'Shed temperature', 'unavailable', '°C', 'temperature'),
  sensor('switch.garden_lights', 'Garden lights', 'unavailable', null, null),
  sensor('binary_sensor.smoke_alarm_battery', 'Smoke alarm battery', 'on', null, 'battery'),
];

const uDevices = [
  { id: 'd1', name: 'Cloud Gateway Ultra', model: 'UCG-Ultra', mac: '9c:05:d6:00:00:01', ip: '192.168.1.1', state: 'ONLINE', features: ['gateway'], uptime: 1820000, cpu: 18, memory: 61, tx: 2_400_000, rx: 38_000_000, firmware: '4.3.6', firmwareUpdatable: false },
  { id: 'd2', name: 'Office switch', model: 'USW-Lite-8-PoE', mac: '9c:05:d6:00:00:02', ip: '192.168.1.2', state: 'ONLINE', features: ['switching'], uptime: 1820000, cpu: 6, memory: 40, tx: 900_000, rx: 12_000_000, firmware: '7.1.26', firmwareUpdatable: true },
  { id: 'd3', name: 'Lounge AP', model: 'U7-Pro', mac: '9c:05:d6:00:00:03', ip: '192.168.1.3', state: 'ONLINE', features: ['accessPoint'], uptime: 640000, cpu: 9, memory: 52, tx: 300_000, rx: 8_000_000, firmware: '8.0.15', firmwareUpdatable: false },
  { id: 'd4', name: 'Garden AP', model: 'U6-Mesh', mac: '9c:05:d6:00:00:04', ip: '192.168.1.4', state: 'OFFLINE', features: ['accessPoint'], uptime: null, cpu: null, memory: null, tx: null, rx: null, firmware: '6.6.77', firmwareUpdatable: false },
];
const clientNames = ['Ben’s iPhone', 'Ben’s MacBook Pro', 'Living room TV', 'Kitchen speaker', 'Unraid (Tower)', 'Home Assistant', 'Hue bridge', 'Ring doorbell', 'Printer', 'Office iPad', 'Nest Protect', 'PS5', 'Apple TV', 'Garden camera', 'Zigbee coordinator', 'Washing machine', 'Guest phone'];
const uClients = clientNames.map((name, i) => ({
  id: `c${i}`, name,
  type: ['Unraid (Tower)', 'Home Assistant', 'Hue bridge', 'Printer', 'PS5', 'Zigbee coordinator'].includes(name) ? 'WIRED' : 'WIRELESS',
  ip: `192.168.1.${20 + i}`, mac: `aa:bb:cc:00:00:${String(i).padStart(2, '0')}`,
  connectedAt: mins(30 + i * 97), uplink: null, guest: name === 'Guest phone',
}));
for (const c of uClients) c.uplink = c.type === 'WIRED' ? 'Office switch' : 'Lounge AP';

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));

export const demo = {
  unraid: {
    async system() {
      return { hostname: 'Tower', version: '7.2.0', cpu: 'Intel Core i5-12400 (6C/12T)', bootedAt: now - 23 * 86400000, cpuPercent: 14 + Math.round(Math.random() * 10), memory: { total: 32 * 1024 ** 3, used: 19.4 * 1024 ** 3, percent: 61 } };
    },
    async array() {
      const d = (name, tb, usedPct, temp, extra = {}) => ({ name, size: KiB(tb), temp, status: 'DISK_OK', fsSize: KiB(tb), fsUsed: Math.round(KiB(tb) * usedPct), fsFree: Math.round(KiB(tb) * (1 - usedPct)), errors: 0, spinning: temp !== null, ...extra });
      const disks = [d('disk1', 12, 0.82, 34), d('disk2', 12, 0.64, null), d('disk3', 8, 0.91, 36, { errors: 3 })];
      return {
        state: 'STARTED',
        capacity: { total: KiB(32), used: Math.round(KiB(32) * 0.79), free: Math.round(KiB(32) * 0.21) },
        parities: [d('parity', 12, 0, 33, { fsSize: null, fsUsed: null, fsFree: null })],
        disks,
        caches: [d('cache', 1, 0.47, 41)],
      };
    },
    async vms() { return structuredClone(vms); },
    async vmAction(id, action) {
      await wait(1200);
      const v = vms.find((x) => x.id === id);
      if (v) v.state = ['stop', 'forceStop'].includes(action) ? 'shutoff' : action === 'pause' ? 'paused' : 'running';
      return { ok: true };
    },
    async notifications() { return { info: 4, warning: 1, alert: 0, total: 5 }; },
    async containers() { return structuredClone(containers); },
    async containerAction(id, action) {
      await wait(900);
      const c = containers.find((x) => x.id === id);
      if (!c) throw Object.assign(new Error('No such container'), { statusCode: 404 });
      c.state = action === 'stop' ? 'exited' : 'running';
      c.status = action === 'stop' ? 'Exited (0) just now' : 'Up 1 second';
      return { ok: true };
    },
  },
  homeassistant: {
    async info() { return { version: '2026.10.4', name: 'Beech', state: 'RUNNING', safeMode: false }; },
    async states() { return structuredClone(entities); },
    async callService(domain, service, data = {}) {
      await wait(250);
      const ids = [].concat(data.entity_id || []);
      for (const id of ids) {
        const e = entities.find((x) => x.id === id);
        if (!e) continue;
        if (service === 'toggle') e.state = e.state === 'on' ? 'off' : 'on';
        else if (service === 'turn_on') e.state = 'on';
        else if (service === 'turn_off') e.state = 'off';
        else if (service === 'lock') e.state = 'locked';
        else if (service === 'unlock') e.state = 'unlocked';
        else if (service === 'open_cover') e.state = 'open';
        else if (service === 'close_cover') e.state = 'closed';
        else if (service === 'install') { e.state = 'off'; e.attrs.installed_version = e.attrs.latest_version; }
        e.changed = new Date().toISOString();
      }
      return { ok: true };
    },
    async checkConfig() { await wait(1500); return { result: 'valid', errors: null }; },
  },
  unifi: {
    async summary() { return { version: '9.5.21', devices: structuredClone(uDevices), clients: structuredClone(uClients) }; },
    async restartDevice() { await wait(600); return { ok: true }; },
  },
};

export const demoLinks = [
  { name: 'Infrastructure', items: [
    { name: 'Unraid', url: 'http://192.168.1.10', icon: 'unraid', pinned: true, description: 'Tower web UI' },
        { name: 'UniFi', url: 'https://192.168.1.1', icon: 'unifi', pinned: true, description: 'Network console' },
    { name: 'Router admin (ISP)', url: 'http://192.168.0.1', icon: 'router', check: false },
  ] },
  { name: 'Household', items: [
    { name: 'Bin collections', url: 'https://www.gov.uk/rubbish-collection-day', icon: 'https://www.gov.uk/favicon.ico', check: false },
    { name: 'Octopus Energy', url: 'https://octopus.energy/dashboard/', icon: 'https://octopus.energy/favicon.ico', check: false },
  ] },
];
