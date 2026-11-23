# BeechHut

Front page and admin console for everything at Beech. It runs as a **Home Assistant add-on**, so it lives in the HA sidebar on the Mac and in the Home Assistant app on the iPhone.

![Overview](docs/screenshots/desktop-overview.png)

It's meant for running the house, so you can act on things from it as well as look at them:

| Page | What you can do |
| --- | --- |
| **Overview** | An **apps bar** with every running container that has a web UI and all your own links, one tap to open (favourites and pinned links first). Below it, a **Needs attention** list across every system: disks with errors or running hot, stopped autostart containers, offline UniFi devices, links that aren't responding. Buttons above the list show **Batteries** (low batteries), **Updates** (Home Assistant and UniFi) and **Unavailable** (Home Assistant entities) on their own. Plus a summary card for each system. |
| **Containers** | Start, stop and restart your Unraid containers and open their web UIs. |
| **Server** | Unraid CPU, RAM, array capacity, per-disk usage, temperatures and errors, and unread notifications. Start, shut down, reboot or force-stop VMs. |
| **Home** | Lights, switches, heating, locks, covers, scenes, scripts and automations, all controllable. You can also install updates, check the config, restart HA and search every entity. |
| **Network** | WAN throughput, UniFi devices (with CPU, memory and a restart button) and every client, searchable by name, IP or MAC. |
| **House Plan** | The whole house in 3D, floating on the page, built from LiDAR scans. Spin it round, zoom in, look from above, cut the walls down to see inside, and tap things to identify them. The plan (`plan.json` plus the model files) is a folder served by Home Assistant (e.g. from its `www` folder) that BeechHut loads directly. See the add-on's Documentation tab. |
| **Photo uploader** | Add photos to a digital photo frame from your phone, each cropped to the frame's exact shape (drag, pinch to zoom), and see, re-crop or delete the ones already there. Photos are saved to a folder in Home Assistant's config folder, such as one under `www`. |
| **Notes** | House notes: boiler service dates, where the stopcock is, to-dos. |

Press **⌘K** (or `/`) to search and run anything, for example "restart plex", "kitchen" to toggle a light, or "open unifi". Anything that changes something asks you to confirm first.

## Install

The add-on lives in [`beechhut/`](beechhut). Home Assistant builds it from source on install, so there's no image to publish. There are two ways to get it into HA.

**A. As an add-on repository (easiest updates).** This only works if this GitHub repo is **public**. Home Assistant can't read private repos, and there's nothing secret in the code.
1. In HA go to **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and add `https://github.com/Benjamin-Leo-Code/BeechHut`.
2. Find **BeechHut** in the store and select **Install**. The first build takes a few minutes.

**B. As a local add-on (repo can stay private).**
1. Copy the `beechhut` folder into the `addons` share on Home Assistant, using the Samba share or the SSH / Studio Code Server add-ons, so you have `/addons/beechhut/config.yaml`.
2. Go to **Settings → Add-ons → Add-on Store → ⋮ → Check for updates**. BeechHut appears under **Local add-ons**.
3. To update later, copy the folder over again with a higher `version` in `config.yaml`.

### Upgrading from BeechFront

The add-on was renamed from BeechFront to BeechHut, and its internal ID changed with it, so Home Assistant sees it as a new add-on:
1. Copy anything you want to keep from the old BeechFront notes page, and note its Configuration tab settings.
2. Uninstall **BeechFront**, then install **BeechHut** and enter the settings again.
3. Add your notes back.

Then, on the add-on's page:
1. **Configuration tab:** enter your Unraid and UniFi addresses and API keys. The **Documentation** tab says where to create them. Home Assistant needs no setup.
2. **Info tab:** turn on **Show in sidebar** and start the add-on.

## Development

```sh
cd beechhut
npm install
npm run dev:demo     # sample data, no real systems needed → http://localhost:5173
npm run build        # type-check and build the front end
```

Demo mode (`BEECHHUT_DEMO=1`) swaps every integration for in-memory sample data, and actions still work against it. Outside Home Assistant, settings are read from `beechhut/config.yaml` (see `config.example.yaml`), including `homeassistant: { url, token }`. You can also set `BEECHHUT_OPTIONS` to point at an `options.json` file.

### Layout

```
repository.yaml            makes this repo an HA add-on repository
beechhut/                the add-on
  config.yaml              add-on manifest + Configuration tab schema
  translations/en.yaml     labels for the Configuration tab
  DOCS.md                  the add-on's Documentation tab
  Dockerfile               built by the HA Supervisor
  server/                  Fastify API (Node 22)
    config.js              reads the add-on options and optional config.yaml
    overview.js            builds the "Needs attention" list
    integrations/          unraid (GraphQL, incl. containers) · homeassistant · unifi · links · notes · photos
  web/src/                 React + TypeScript front end (Vite); pages/PlanViewer.tsx is the three.js 3D viewer,
                           pages/crop.tsx the photo cropper
```

### How it fits into Home Assistant

- **Ingress:** HA serves the UI under `/api/hassio_ingress/<token>/`, so the front end only uses relative URLs. The server rejects any connection that doesn't come from the Supervisor's ingress proxy.
- **Home Assistant API:** reached through `http://supervisor/core` with the injected `SUPERVISOR_TOKEN` (`homeassistant_api: true`).
- **Storage:** notes are kept in `/data`, so they're included in HA backups. Photo uploader writes to the photo frame folder in HA's config folder, mapped in at `/homeassistant` (`homeassistant_config`).
- **Unraid:** the GraphQL schema has changed between 7.x releases. Each section is queried separately, with fallbacks, so a missing field only blanks one card.
