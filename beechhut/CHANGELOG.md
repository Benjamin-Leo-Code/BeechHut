# Changelog

## 0.9.3
- Frame TV: before asking for permission, BeechHut writes the TV's own description of itself to the Log tab (model, whether remote control is on, and so on), to help track down connection problems.

## 0.9.2
- Frame TV: BeechHut now connects to the TV the same way the open-source samsungtvws library does (without asking for compression), in case the TV ignores connections that ask for it.

## 0.9.1
- Frame TV: if the TV doesn't answer on its encrypted port (8002), BeechHut now tries the older port (8001), which some Frames use instead, and remembers whichever works.
- The add-on's Log tab now shows exactly what the TV sends back, to help track down problems.

## 0.9.0
- **Frame TV Art Mode button in Home Assistant.** BeechHut adds a button helper, `input_button.frame_tv_art_mode`, that switches the Frame TV to Art Mode (like the Off button on its remote). Put it on a dashboard or use it in automations. If the TV can't be reached, a notification in Home Assistant says why. Turn it off with **Frame TV Art Mode button** on the Configuration tab.
- An **Art Mode** button on the Photo uploader page does the same.

## 0.8.1
- Frame TV: BeechHut now asks the TV for permission the way a remote-control app does, which is what makes the **Allow** message appear on the TV. The permission is then used for Art Mode.
- Clearer messages when the TV doesn't answer, and each step of connecting to the TV is written to the add-on's Log tab.

## 0.8.0
- Photo uploader can now add photos to a **Samsung The Frame** TV's Art Mode (My Photos). Set **Frame TV address** on the Configuration tab; the first time, choose **Allow** on the TV.
- Choose **Photo frame**, **Frame TV** or **Both** above the Add photos button. With Both, each photo is cropped twice: once for the frame's shape and once for the TV's 16:9.
- **On the Frame TV** lists your own photos on the TV and marks the one showing. Tap one to **Show now** or **Delete** it.
- Optional **Frame TV mat** setting for the border Art Mode puts round uploads (none by default).

## 0.7.0
- New **Photo uploader** page for a digital photo frame. Add photos from your phone, each cropped to the frame's exact shape first (drag to move, pinch or use the slider to zoom), and see, re-crop or delete the photos already in the frame.
- Set **Photo frame folder** on the Configuration tab (e.g. `/config/www/photo-frame`), and **Photo frame shape** if your frame isn't 238:162. The page is hidden until the folder is set.
- BeechHut can now read and write Home Assistant's config folder, so it can save photos to the frame's folder.

## 0.6.0
- The house plan is now loaded straight from a folder served by Home Assistant, e.g. `/local/<folder>/house-plan/` in the `www` folder. The GitHub settings and token are gone; set **House plan address** on the Configuration tab instead.

## 0.5.0
- House Plan is now a single view of the whole house, floating on the page with a soft shadow. It has no upload button, file list or frame.
- The plan is read from a folder in a GitHub repository (it can be private): `plan.json` lists each part of the house (rooms, floors, garden) and where it sits. Set the repository, branch, folder and a read-only token on the Configuration tab.
- Files are cached by their content hash and the plan checks for changes about once a minute. Settings mistakes are reported on the page and don't stop the add-on.
- Plans uploaded in 0.4.0 are no longer used. They're left in the add-on's storage under `plans/`.

## 0.4.0
- New **House Plan** page: upload LiDAR scans (USDZ or GLB) and explore them in 3D – rotate, zoom, top-down view, wall cutaway, full screen, and tap to identify walls, doors, windows and furniture.
- Scans with mislabelled units are rescaled automatically, and the plan's real-world size is shown.

## 0.3.5
- Icon: wider hut with double doors, small hinges and a sliding bolt.

## 0.3.4
- Icon: larger door.

## 0.3.3
- Icon: shallower roof pitch and a round door handle.

## 0.3.2
- Icon: bigger hut, outlined square-ended roof with less overhang, no ground line.

## 0.3.1
- New icon: a striped beach hut, in the same green and white.

## 0.3.0
- Renamed to BeechHut. The add-on slug has changed too, so Home Assistant treats it as a new add-on – see the README.
- New apps bar at the top of the overview: every running container with a web UI, one tap to open. Favourite containers come first.
- Quick launch now only shows pinned links (containers are in the apps bar).

## 0.2.0
- Now a Home Assistant add-on: opens from the sidebar and the HA app, uses Home Assistant's sign-in, and connects to Home Assistant automatically.
- Containers are controlled through the Unraid API (no Docker socket needed).
- Settings moved to the add-on's Configuration tab.
- Container logs removed: the Unraid API doesn't provide them.

## 0.1.0
- First version: a standalone container on Unraid.
