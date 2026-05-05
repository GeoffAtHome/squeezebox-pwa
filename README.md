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
- The bridge server is intended to run on your local machine only — do not expose port 5174 to the internet
- Artwork is proxied through the bridge with Basic auth so credentials are never sent from the browser to LMS directly

## Protocol references

- [SlimProto protocol](https://lyrion.org/reference/slimproto-protocol/)
- [SlimBrowse / JSON-RPC API](https://lyrion.org/reference/slimbrowse/)
- [Lyrion Music Server](https://lyrion.org/)
