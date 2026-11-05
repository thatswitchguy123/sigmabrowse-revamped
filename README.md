# Nova Browser — Replit project

A custom Chrome-style web interface backed by a real headless Chromium process. It does **not** use iframes: the server renders pages in Chromium and streams screenshots to the browser UI over WebSockets. Mouse clicks, scrolling and keyboard input are sent back to Chromium.

## Replit setup

1. Create a new **Node.js** Replit project.
2. Upload/extract all files from this project into the Replit workspace. Keep the `public` folder.
3. Open **Tools → Secrets** and add:
   - `BROWSER_PASSWORD` — choose a strong password. This is required.
   - `COOKIE_SECRET` — optional; use a long random secret if you want login cookies to remain valid across restarts.
4. In the Shell, run:
   ```bash
   npm install
   ```
5. Click **Run**. The app listens on Replit's `PORT` and binds to `0.0.0.0`.

If Replit asks you to configure the run command, use:
```bash
npm start
```

## Important Replit/Chromium note

The project includes `replit.nix` with Chromium and common Linux runtime libraries. Replit may need to rebuild the environment after adding or changing this file. If the console says Chromium cannot launch, check that the Nix environment finished rebuilding and that `which chromium` returns a path. You can also set the `CHROMIUM_PATH` Replit Secret to the exact executable path shown by `which chromium`.

This app uses `playwright-core`, so it expects a system Chromium executable. It does not download a second browser bundle.

## What is included

- Chrome-like tabs, address/search bar, back, forward, reload and home.
- Real Chromium page rendering, JavaScript and cookies.
- Each connected browser session gets its own temporary Chromium instance and isolated cookies.
- Up to 8 tabs per connected session.
- Screenshot streaming and remote mouse/keyboard/scroll input.
- Password gate for the public Replit URL.

## Current limitations

This is an early working prototype, not a full replacement for Chrome:
- The display is screenshot-based, so fast video, animations and games may look less smooth than a native browser.
- Browser sessions and cookies are temporary and are lost when the connection/server restarts.
- Downloads are announced but are not yet transferred to the user's device.
- Extensions, browser sync, bookmarks, history and microphone/camera permissions are not implemented.
- Some websites block automation or remote browsers. No browser can guarantee every site works.
- Public Replit deployments have resource limits. A Chromium process per connected user can use substantial RAM and CPU.
- The URL guard blocks common local/private address patterns, but this is not a hardened public browsing service. Keep the password private and do not remove the login gate.

## Troubleshooting

**`BROWSER_PASSWORD` missing**  
Add it under Replit Secrets and restart.

**`Executable doesn't exist` / Chromium launch failed**  
Check `which chromium` in the Shell. If no path appears, confirm `replit.nix` is present and wait for the environment to rebuild.

**WebSocket connection failed**  
Open the app using the Replit HTTPS preview URL. Do not open `index.html` directly from your computer.

**Page opens but clicks are offset**  
This prototype maps the displayed screenshot to a fixed 1365×850 Chromium viewport. Keep the preview at its normal aspect ratio; a later version can add responsive coordinate scaling.

**`npm install` fails**  
Check the Replit console output and retry `npm install` after the workspace has finished provisioning.
