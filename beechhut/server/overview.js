/**
 * Pulls a summary from every integration in parallel and turns anything
 * that needs a human into an "attention" item. One failing system never
 * blocks the rest – it becomes an attention item itself.
 */
const settle = async (fn) => {
  if (!fn) return { status: 'off' };
  try { return { status: 'ok', value: await fn() }; } catch (e) { return { status: 'error', error: e.message }; }
};

export async function buildOverview({ c, config }) {
  const [containers, system, array, vms, unraidNotes, haStates, haInfo, unifi, links, haDevices] = await Promise.all([
    settle(c.containers), settle(c.system), settle(c.array), settle(c.vms), settle(c.unraidNotifications),
    settle(c.haStates), settle(c.haInfo), settle(c.unifi), settle(c.links), settle(c.haDevices),
  ]);

  const attention = [];
  // group: shown behind the Batteries / Updates / Unavailable buttons rather than in the main list.
  const add = (level, source, title, detail, page, group = null, device = null) => attention.push({ level, source, title, detail, page, group, device });

  for (const [name, r] of [['Unraid', system], ['Home Assistant', haStates], ['UniFi', unifi]]) {
    if (r.status === 'error') add('alert', name, `Can't reach ${name}`, r.error, null);
  }

  // Unraid
  if (array.status === 'ok') {
    const a = array.value;
    if (a.state && a.state !== 'STARTED') add('alert', 'Unraid', `Array is ${a.state.toLowerCase()}`, null, 'server');
    for (const d of [...a.parities, ...a.disks, ...a.caches]) {
      if (d.status && !/OK|NP$/.test(d.status)) add('alert', 'Unraid', `${d.name}: ${d.status.replace(/^DISK_/, '').toLowerCase()}`, null, 'server');
      if (d.errors > 0) add('warning', 'Unraid', `${d.name} has ${d.errors} read/write error${d.errors === 1 ? '' : 's'}`, null, 'server');
      if (d.temp !== null && d.temp >= 50) add('warning', 'Unraid', `${d.name} is running hot`, `${d.temp} °C`, 'server');
      if (d.fsSize && d.fsUsed / d.fsSize >= 0.9) add('info', 'Unraid', `${d.name} is ${Math.round((d.fsUsed / d.fsSize) * 100)}% full`, null, 'server');
    }
  }
  if (unraidNotes.status === 'ok' && (unraidNotes.value.alert || unraidNotes.value.warning)) {
    const n = unraidNotes.value;
    add(n.alert ? 'alert' : 'warning', 'Unraid', `${n.alert + n.warning} unread Unraid notification${n.alert + n.warning === 1 ? '' : 's'}`, null, 'server');
  }
  if (vms.status === 'ok') {
    const ha = vms.value.find((v) => v.name === config.homeassistant?.vmName || /home ?assistant|haos/i.test(v.name));
    if (ha && ha.state !== 'running') add('alert', 'Unraid', `${ha.name} VM is ${ha.state}`, null, 'server');
  }

  // Docker
  if (containers.status === 'ok') {
    const down = containers.value.filter((ct) => ct.state !== 'running' && ct.autoStart);
    for (const ct of down) add('warning', 'Containers', `${ct.name} is ${ct.state === 'exited' ? 'stopped' : ct.state}`, 'Set to autostart but not running', 'containers');
    for (const ct of containers.value.filter((x) => ['restarting', 'dead'].includes(x.state))) {
      if (!ct.autoStart) add('warning', 'Containers', `${ct.name} is ${ct.state}`, null, 'containers');
    }
  }

  // Home Assistant
  if (haStates.status === 'ok') {
    const s = haStates.value;
    for (const u of s.filter((e) => e.domain === 'update' && e.state === 'on')) {
      add('info', 'Home Assistant', u.attrs.title || u.name.replace(/ update$/i, ''), `${u.attrs.installed_version} → ${u.attrs.latest_version}`, 'home', 'update');
    }
    // Low batteries: percentage sensors at or below the threshold, battery binary sensors reporting "low",
    // and any battery sensor that's unavailable (often a flat battery). Unavailable ones go last.
    const limit = config.homeassistant?.lowBattery ?? 20;
    const low = [
      ...s.filter((e) => e.deviceClass === 'battery' && e.unit === '%' && e.state !== '' && Number(e.state) <= limit)
        .map((e) => ({ e, level: Number(e.state), detail: `${e.state}%` })),
      ...s.filter((e) => e.domain === 'binary_sensor' && e.deviceClass === 'battery' && e.state === 'on')
        .map((e) => ({ e, level: -1, detail: 'Low' })),
      ...s.filter((e) => e.deviceClass === 'battery' && e.state === 'unavailable')
        .map((e) => ({ e, level: 1000, detail: 'Unavailable' })),
    ].sort((a, b) => a.level - b.level);
    for (const { e, detail } of low) add('warning', 'Home Assistant', e.name.replace(/ battery( level)?$/i, ''), detail, 'home', 'battery');
    // Every unavailable entity (batteries are already under Batteries), with the device it belongs to.
    // If the device lookup fails, they're simply listed without devices.
    const devices = haDevices.status === 'ok' ? haDevices.value : {};
    for (const e of s.filter((x) => x.state === 'unavailable' && x.deviceClass !== 'battery').sort((a, b) => a.name.localeCompare(b.name))) {
      const device = devices[e.id] || null;
      // HA names entities "<device> <entity>"; inside a device group the device part is redundant.
      const short = device && e.name.toLowerCase().startsWith(`${device.toLowerCase()} `) ? e.name.slice(device.length + 1) : e.name;
      add('info', 'Home Assistant', short.charAt(0).toUpperCase() + short.slice(1), e.id, 'home', 'unavailable', device);
    }
  }

  // UniFi
  if (unifi.status === 'ok') {
    for (const d of unifi.value.devices.filter((x) => x.state !== 'ONLINE')) add(d.state === 'OFFLINE' ? 'alert' : 'warning', 'UniFi', `${d.name} is ${d.state.toLowerCase().replace(/_/g, ' ')}`, d.model, 'network');
    for (const d of unifi.value.devices.filter((x) => x.firmwareUpdatable)) add('info', 'UniFi', `${d.name} firmware`, d.firmware ? `Currently ${d.firmware}` : 'New firmware available', 'network', 'update');
  }

  // Links
  if (links.status === 'ok') {
    for (const l of links.value.flatMap((g) => g.items)) if (l.health && !l.health.up) add('warning', 'Links', `${l.name} isn't responding`, l.health.error || `HTTP ${l.health.status}`, null);
  }

  const order = { alert: 0, warning: 1, info: 2 };
  attention.sort((a, b) => order[a.level] - order[b.level]);

  const ha = haStates.status === 'ok' ? haStates.value : [];
  return {
    attention,
    tiles: {
      server: system.status === 'ok' ? {
        ...system.value,
        array: array.status === 'ok' ? { state: array.value.state, ...array.value.capacity } : null,
      } : { error: system.error, off: system.status === 'off' },
      containers: containers.status === 'ok' ? {
        running: containers.value.filter((x) => x.state === 'running').length,
        total: containers.value.length,
      } : { error: containers.error, off: containers.status === 'off' },
      vms: vms.status === 'ok' ? vms.value : null,
      home: haStates.status === 'ok' ? {
        version: haInfo.value?.version,
        lightsOn: ha.filter((e) => e.domain === 'light' && e.state === 'on').length,
        lights: ha.filter((e) => e.domain === 'light').length,
        updates: ha.filter((e) => e.domain === 'update' && e.state === 'on').length,
        climate: ha.filter((e) => e.domain === 'climate' && e.attrs.current_temperature !== undefined).map((e) => ({ name: e.name, current: e.attrs.current_temperature, target: e.attrs.temperature, action: e.attrs.hvac_action })),
      } : { error: haStates.error, off: haStates.status === 'off' },
      network: unifi.status === 'ok' ? {
        devicesOnline: unifi.value.devices.filter((d) => d.state === 'ONLINE').length,
        devices: unifi.value.devices.length,
        clients: unifi.value.clients.length,
        wireless: unifi.value.clients.filter((x) => x.type === 'WIRELESS').length,
        gateway: unifi.value.devices.find((d) => d.features.includes('gateway')) || null,
      } : { error: unifi.error, off: unifi.status === 'off' },
    },
  };
}
