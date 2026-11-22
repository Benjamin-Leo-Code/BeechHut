import { WebSocket } from 'undici';

/*
 * A button helper in Home Assistant that BeechHut answers. On start-up BeechHut
 * makes sure the input_button exists (creating it if need be), then listens for
 * presses over HA's WebSocket API and runs onPress. If the action fails, a
 * notification in Home Assistant says why.
 */
export function createHaButton({ wsUrl, token, objectId, name, icon, onPress, log }) {
  let ws = null, nextId = 1, retry = 5000, stopped = false;
  const pending = new Map();
  let entityId = `input_button.${objectId}`;

  const call = (msg) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, ...msg }));
  });

  async function setUp() {
    // Use an existing helper with this ID or name, otherwise create one.
    try {
      const list = await call({ type: 'input_button/list' });
      const found = list.find((b) => b.id === objectId || b.name === name);
      if (found) entityId = `input_button.${found.id}`;
      else {
        const made = await call({ type: 'input_button/create', name, icon });
        entityId = `input_button.${made.id}`;
        log(`created ${entityId} in Home Assistant`);
      }
    } catch (e) {
      log(`couldn’t create the button helper (${e.message}); create a Button helper called “${name}” in Home Assistant and BeechHut will use it`);
    }
    await call({ type: 'subscribe_trigger', trigger: { platform: 'state', entity_id: entityId, to: null } });
    log(`listening for presses of ${entityId}`);
  }

  function pressed(trigger) {
    const from = trigger?.from_state?.state, to = trigger?.to_state?.state;
    const real = (v) => v && v !== 'unknown' && v !== 'unavailable';
    if (!real(from) || !real(to) || from === to) return; // start-up and restarts, not presses
    log(`${entityId} pressed`);
    Promise.resolve().then(onPress).catch((e) => {
      log(`${name} failed: ${e.message}`);
      call({
        type: 'call_service', domain: 'persistent_notification', service: 'create',
        service_data: { title: 'BeechHut', message: `${name} didn’t work: ${e.message}`, notification_id: `beechhut_${objectId}` },
      }).catch(() => {});
    });
  }

  function connect() {
    if (stopped) return;
    const sock = new WebSocket(wsUrl);
    sock.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      if (msg.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_ok') { ws = sock; retry = 5000; setUp().catch((err) => log(`Home Assistant button set-up failed: ${err.message}`)); }
      else if (msg.type === 'auth_invalid') log(`Home Assistant refused the connection: ${msg.message}`);
      else if (msg.type === 'result' && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.success) p.resolve(msg.result); else p.reject(new Error(msg.error?.message || 'failed'));
      } else if (msg.type === 'event' && msg.event?.variables?.trigger) pressed(msg.event.variables.trigger);
    };
    sock.onerror = () => {};
    sock.onclose = () => {
      if (ws === sock) ws = null;
      for (const p of pending.values()) p.reject(new Error('connection closed'));
      pending.clear();
      if (stopped) return;
      // Home Assistant restarting: try again, backing off to a minute.
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 60_000);
    };
  }

  connect();
  return { stop() { stopped = true; try { ws?.close(); } catch { /* */ } } };
}
