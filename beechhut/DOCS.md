# BeechHut

An admin console for the house, inside Home Assistant. It shows what needs attention across Unraid, Home Assistant and UniFi, and lets you act on it: restart containers, reboot VMs, install HA updates, restart UniFi devices, toggle lights and more. Press **⌘K** (or `/`) to search and run anything.

Home Assistant itself works automatically: no token is needed. Unraid and UniFi each need an API key.

## Configuration

### Unraid (containers, VMs, array)

1. In Unraid go to **Settings → Management Access → API Keys** and create a key. The *admin* role is simplest. At minimum the key needs read access plus Docker and VM control.
2. Set **Unraid address** to how Home Assistant reaches Unraid, e.g. `http://192.168.1.10`.
3. Paste the key into **Unraid API key**.

This needs Unraid 7.x, which has the API built in. The Unraid API doesn't provide container logs, so those aren't shown. Use the **Unraid Docker** button on the Containers page for them.

### UniFi (network)

1. In UniFi Network go to **Settings → Control Plane → Integrations** and create an API key.
2. Set **UniFi address** to your gateway, e.g. `https://192.168.1.1`, and paste the key.

This needs UniFi Network 9 or later. If you run the UniFi Network Application yourself rather than on a UniFi console, point the address at it. You may also need to set **UniFi API path**.

### Links

Add bookmarks under **Links**. Each one has a name and a URL, plus these optional fields:

| Field | What it does |
| --- | --- |
| `group` | Groups links together on the Links page |
| `icon` | A name from [dashboardicons.com](https://dashboardicons.com) (e.g. `plex`) or an image URL |
| `pinned` | Puts the link in Quick launch on the overview |
| `check` | Set to `false` to skip the up/down check |

Example in YAML mode:

```yaml
links:
  - name: Unraid
    url: http://tower.local
    icon: unraid
    group: Infrastructure
    pinned: true
  - name: Bin collections
    url: https://www.gov.uk/rubbish-collection-day
    group: Household
    check: false
```

### Other options

| Option | What it does |
| --- | --- |
| Favourite containers | Container names to show first in the apps bar at the top of the overview |
| Hidden containers / Hidden entities | Things to leave out. For entities, end with `*` to match a prefix (e.g. `sensor.sun_*`) |
| Home Assistant VM name | The name of this VM in Unraid, so the overview can show it |
| Low battery threshold | Battery sensors at or below this % are flagged |

### House Plan

The House Plan page shows the whole house in 3D, floating on the page. Drag to rotate, scroll or pinch to zoom, and right-drag or use two fingers to move. The buttons reset the view, look straight down, cut the walls down to waist height so you can see inside, and go full screen. Tap anything to see what it is (for example *Sofa · Living room*).

The plan is a folder of files that BeechHut loads directly. It contains:

- **`plan.json`**, which lists every part of the house (a scan of each room, floor or the garden) and where each one sits;
- **the model files** it refers to (USDZ or GLB, e.g. LiDAR scans from Magicplan or Polycam).

The easiest place for the folder is Home Assistant's `www` folder. Then set **House plan address** on the Configuration tab to its `/local/` path; for example, `/config/www/my-folder/house-plan/` becomes `/local/my-folder/house-plan/`. The browser loads the files straight from there, so no sign-in or token is needed, and anything in `www` can be read without logging in anyway. A full web address works too, if the files are on a server that allows it.

BeechHut checks `plan.json` for changes every couple of minutes while the page is open, so updates to the plan appear on their own.

`plan.json` looks like this:

```json
{
  "name": "Home",
  "parts": [
    { "id": "living-room", "name": "Living room", "level": "Ground floor",
      "file": "scans/living-room.usdz", "unitScale": 10, "position": [0, 0, 0], "rotation": 0 }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `file` | The model file, relative to the folder |
| `position` | Where the part goes, in metres: `[east, up, south]` |
| `rotation` | Degrees anticlockwise, seen from above |
| `unitScale` | Turns the file's units into metres. Magicplan's USDZ needs `10`. If you leave it out, BeechHut picks a sensible size itself |

### Photo uploader

The Photo uploader page adds photos to a digital photo frame (any slideshow that shows a folder of photos) and manages the ones already there. It's laid out for a phone.

- **Add photos** lets you pick several photos at once. Each one is cropped on the phone to the frame's exact shape: drag to move it, pinch, scroll or use the slider to zoom, then tap **Add**. **Cancel** skips that photo. The cropped photo is at most 1920 pixels across, so uploads are quick.
- **In the frame** shows every photo in the folder, newest first. Tap one to see it large, **Crop** it again or **Delete** it, or use the × on a thumbnail. Deleting asks first.

Set it up on the Configuration tab:

| Option | What it does |
| --- | --- |
| Photo frame folder | The folder the frame shows, inside Home Assistant's config folder, e.g. `/config/www/photo-frame`. `www/photo-frame` and `/local/photo-frame` mean the same. Create the folder first. Leave blank to hide the page |
| Photo frame shape | The frame's width:height, e.g. `16:9` or `4:3`. Leave blank for `238:162` |

BeechHut saves each photo straight into the folder as `YYYY-MM-DD-HHMMSS-<random>.jpg`, so names sort newest first and can't be guessed (anything in `www` can be read at `/local/…` without logging in). If the folder is also listed under `homeassistant: media_dirs:`, the photos appear in Home Assistant's media browser as usual; nothing else needs to change.

### Samsung The Frame

Photo uploader can also add photos to a Samsung The Frame TV's Art Mode, under **My Photos**. Photos are cropped to 16:9 and sent at up to 3840 pixels across (4K).

1. Give the TV a fixed IP address: reserve it in your router (in UniFi, open the TV under Client Devices and turn on **Fixed IP Address**).
2. Set **Frame TV address** on the Configuration tab to that IP address, and restart BeechHut.
3. With the TV on, open Photo uploader. The TV shows a message asking whether to allow **BeechHut**: choose **Allow**. You only need to do this once.

When both the photo frame and the TV are set up, choose **Photo frame**, **Frame TV** or **Both** above the Add photos button. With **Both**, each photo is cropped twice, once for each shape. **On the Frame TV** shows your own photos on the TV (not Art Store pieces) and marks the one showing; tap one to **Show now** or **Delete** it.

| Option | What it does |
| --- | --- |
| Frame TV address | The TV's IP address. Leave blank if you don't have one |
| Frame TV mat | The border Art Mode puts round uploaded photos, using Samsung's names, e.g. `shadowbox_polar` or `modern_apricot`. Leave blank for none |

Things to know:

- The TV has to be on, or in Art Mode, to receive photos. When it's fully off, the page says it isn't answering.
- Samsung doesn't document this connection; BeechHut uses the same one as the open-source `samsungtvws` library. A TV software update could change it.
- If you reset the TV or remove BeechHut from its list of connected devices, choose **Allow** again next time.
- If the Allow message never appears, check the TV's **Settings → General → External Device Manager → Device Connection Manager**: **Access Notification** should be on (e.g. *First Time Only*), and BeechHut mustn't be set to *Deny* in **Device List**. Each step of connecting is written to the add-on's **Log** tab.

### Advanced

For anything the Configuration tab doesn't cover, such as overriding a container's link or grouping links in YAML, create `config.yaml` in this add-on's config folder: `/addon_configs/<id>_beechhut/` on the host, which the File editor or Studio Code Server add-on can reach. See `config.example.yaml` in the repository.

## Access and security

- BeechHut only accepts connections through Home Assistant (ingress), so it uses your HA login. If you can reach HA remotely, e.g. through Nabu Casa, you can reach BeechHut too.
- Only Home Assistant **administrators** should see it in the sidebar, because it can stop containers and reboot VMs. Panels for add-ons with ingress are admin-only by default.
- Notes are stored in the add-on's own storage and included in Home Assistant backups.
- The Frame TV's permission token is kept in the add-on's own storage.
- BeechHut can read and write Home Assistant's config folder, so that Photo uploader can save photos to the frame's folder. It only ever touches photos in that one folder.
- Because it runs inside Home Assistant, it's unavailable while HA is down or restarting. Rebooting the Home Assistant VM from the Server page works, but the console will drop out until HA is back.
