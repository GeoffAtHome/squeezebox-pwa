# Squeezebox PWA

A Progressive Web App that registers itself as a named **Squeezebox player** with [Lyrion Music Server (LMS)](https://lyrion.org/). It does not control an existing player — it _is_ the player. LMS streams audio directly to the PWA and sends playback commands via the SlimProto protocol.

## How it works

```
LMS Server (port 3483 TCP)
        │  SlimProto
        ▼
bridge/server.ts  (Node.js, port 5174)
        │  POST /api/register   → opens TCP connection, returns { token, mac }
        │  GET  /api/events     → SSE push (stream, pause, volume, metadata…)
        │  POST /api/player/command → forwards JSON-RPC to LMS
        │  GET  /api/artwork    → authenticated artwork proxy
        ▼
src/services/bridge-client.ts  (fetch + EventSource)
        ▼
src/services/lms-connection.ts  (state machine, event handling)
        ▼
src/components/player-controls.ts  (<audio> element + UI)
```

A local Node.js **bridge server** handles the SlimProto TCP connection on behalf of the browser (which cannot open raw TCP sockets) and exposes an HTTP + Server-Sent Events (SSE) API the PWA consumes from a secure context.

## Features

- Registers as a named player in LMS — appears in the LMS player list alongside hardware Squeezebox devices
- Receives and plays audio streams via the browser `<audio>` element
- Play / Pause / Previous / Next track controls
- Seek slider with real-time position (driven from the audio element, offset-corrected after seek)
- Volume control
- Album artwork (via authenticated bridge proxy)
- Track title, artist, and album metadata
- Transport status indicator (Playing / Paused / Buffering / Stopped)
- PWA manifest + service worker — installable as a desktop or mobile app
- Installation prompt shown on successful LMS connection

## Technology stack

| Layer         | Technology                        |
| ------------- | --------------------------------- |
| Framework     | Vite + TypeScript                 |
| UI Components | Lit 3 (web components)            |
| Testing       | Vitest + @testing-library/dom     |
| PWA           | Service Worker + Web App Manifest |
| Bridge        | Node.js (no deps, port 5174)      |

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- A running [Lyrion Music Server](https://lyrion.org/) (LMS) instance accessible on your network

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/squeezebox-pwa.git
cd squeezebox-pwa
npm install
```

For hosted deployments, create `.env.production` in the project root:

```env
VITE_BRIDGE_URL=https://bridge.yourdomain.com
```

Create `.env.local` in the project root (this file is gitignored):

```env
# Optional — overrides the default bridge port (5174)
# BRIDGE_PORT=5174

# Set to "0" to disable bridge command/result logging
# BRIDGE_LOG_COMMANDS=1
```

## Running in development

Open two terminals:

```bash
# Terminal 1 — Vite dev server (http://localhost:5173)
npm run dev

# Terminal 2 — Node.js bridge server (http://localhost:5174)
npm run bridge:dev
```

Then open `http://localhost:5173` in your browser.

1. Enter your LMS server URL (e.g. `http://192.168.1.10:9000`)
2. Optionally enter your LMS username and password
3. Choose a player name (default: `Squeezebox PWA`)
4. Click **Connect** — the player appears in LMS immediately

Play music from LMS to the "Squeezebox PWA" player and the browser will stream and display it.

## Running tests

```bash
npm run test          # run once
npm run test:watch    # watch mode
npm run test:ui       # browser UI dashboard
```

## Building for production

```bash
npm run build         # outputs to dist/
npm run preview       # preview the production build
```

The bridge server is a plain Node.js script and does not need a build step — run it directly with `node bridge/server.js` (after building the TypeScript, or keep using `--experimental-strip-types` for direct `.ts` execution).

## Firebase + Cloudflare Tunnel deployment

For Android or any WAN use, do not expose the browser directly to LMS. Use this layout instead:

```text
Android phone / desktop browser
        │
        │  HTTPS
        ▼
Firebase Hosting (PWA static files)
        │
        │  HTTPS fetch + SSE
        ▼
bridge.yourdomain.com  (Node bridge via Cloudflare Tunnel)
        │
        │  LAN HTTP + SlimProto TCP
        ▼
LMS on your home network
```

Why this layout matters:

- The browser cannot open raw SlimProto TCP connections to LMS port 3483.
- The hosted PWA cannot safely play LMS `http://...` stream URLs directly from an `https://` page.
- The bridge now proxies audio and artwork through its own HTTPS origin so Android browsers avoid mixed-content blocking.

Recommended deployment steps:

1. Deploy the PWA `dist/` folder to Firebase Hosting.
2. Run the bridge on the same machine as LMS, or another always-on machine on the same home LAN.
3. Give the bridge local access to LMS, for example `http://192.168.1.10:9000` and TCP `192.168.1.10:3483`.
4. Publish the bridge with Cloudflare Tunnel as `https://bridge.yourdomain.com`.
5. Build the frontend with `VITE_BRIDGE_URL=https://bridge.yourdomain.com`.
6. In the app connection dialog, enter your LMS URL. This should usually be the LMS LAN URL when the bridge is on the same network as LMS.

Example Cloudflare Tunnel ingress for the bridge:

```yaml
tunnel: squeezebox-bridge
credentials-file: /etc/cloudflared/squeezebox-bridge.json

ingress:
  - hostname: bridge.yourdomain.com
    service: http://localhost:5174
  - service: http_status:404
```

Run the bridge and tunnel on the home-network machine:

```bash
# Bridge
npm run bridge:dev

# Or a production-style launch
node --env-file=.env.local --experimental-strip-types bridge/server.ts

# Tunnel
cloudflared tunnel run squeezebox-bridge
```

Notes:

- You do not need to expose LMS port 3483 publicly when the bridge is running next to LMS.
- Cloudflare Tunnel is a better fit than opening router ports because the bridge is an HTTP/SSE service from the browser's perspective.
- If LMS is protected by HTTP Basic auth, the bridge forwards credentials you enter in the PWA connection dialog.

## Android use

Once Firebase Hosting and the bridge tunnel are live:

1. Open the Firebase-hosted app on your Android phone.
2. Connect to LMS using the normal connection dialog.
3. After the first successful load, install the PWA from Chrome's add-to-home-screen prompt.

The bridge remains the only public API the phone needs. The phone never talks SlimProto directly.

## LMS plugin option

If you want tighter LMS integration later, an LMS plugin is feasible, but it is a rewrite rather than a packaging change.

The strongest reference in [Alexa-Squeezebox](https://github.com/GeoffAtHome/Alexa-Squeezebox) is its LMS plugin, which:

- registers lightweight LMS-native HTTP endpoints under `/alexa/*`
- returns relative stream and artwork paths instead of hard-coded origins
- signs stream URLs so a remote client can fetch media safely
- uses LMS-native control calls for pause, next, previous, stop, and volume

Useful files in that repo are:

- `lms-plugin/AlexaBridge/Plugin.pm`
- `lms-plugin/AlexaBridge/Settings.pm`
- `lms-plugin/AlexaBridge/install.xml`

That design is a good reference if you later want to move this bridge logic into LMS itself. For the Android deployment path, keeping the Node bridge and tunneling it is the lower-risk option.

## Project structure

```
bridge/
└── server.ts              # Node.js bridge: SlimProto TCP ↔ HTTP/SSE API

src/
├── index.html
├── manifest.webmanifest   # PWA metadata
├── service-worker.ts      # Offline support + install prompt
├── components/
│   ├── app-shell.ts       # App container
│   ├── connection-dialog.ts  # LMS connection form
│   └── player-controls.ts   # Audio element + playback UI
├── services/
│   ├── bridge-client.ts   # HTTP/SSE client for the bridge
│   ├── lms-connection.ts  # State machine: registration, events, commands
│   └── storage.ts         # localStorage: serverUrl, username, playerName
└── utils/
    └── types.ts           # Shared types and constants
```

## Security notes

- Credentials entered in the connection dialog are used only to authenticate with LMS and are **not stored to disk** (passwords are kept in memory only for the session duration)
- Do not expose bridge port 5174 directly to the internet; publish it behind HTTPS via a reverse proxy or Cloudflare Tunnel instead
- Artwork is proxied through the bridge with Basic auth so credentials are never sent from the browser to LMS directly
- Audio is proxied through the bridge so an HTTPS-hosted PWA can play LMS streams without mixed-content failures

## Protocol references

- [SlimProto protocol](https://lyrion.org/reference/slimproto-protocol/)
- [SlimBrowse / JSON-RPC API](https://lyrion.org/reference/slimbrowse/)
- [Lyrion Music Server](https://lyrion.org/)
