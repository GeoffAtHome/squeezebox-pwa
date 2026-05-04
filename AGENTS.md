# Squeezebox PWA - AI Agent Instructions

## Project Overview

**Squeezebox PWA** is a Progressive Web App that **registers itself as a named Squeezebox player** with Lyrion Music Server (LMS). It does not control an existing player — it _is_ the player. LMS streams audio directly to the PWA and sends playback commands via the SlimProto protocol.

A local Node.js **bridge server** handles the SlimProto TCP connection (port 3483) on behalf of the browser and exposes an HTTP + Server-Sent Events (SSE) API that the PWA can use from a secure context.

### Key Goals

- **Phase 1 (MVP)**: Register as a named player, receive audio streams, playback controls
- **Phase 2 (Future)**: Music browsing via SlimBrowse API
- **Quality**: Built with TDD throughout development
- **Usability**: PWA installable after successful LMS connection

---

## Technology Stack

| Layer             | Technology                        | Purpose                                     |
| ----------------- | --------------------------------- | ------------------------------------------- |
| **Framework**     | Vite + TypeScript                 | Fast dev experience, type safety            |
| **UI Components** | Lit                               | Lightweight, standards-based web components |
| **Testing**       | Vitest + @testing-library/dom     | TDD workflow support                        |
| **PWA**           | Service Worker + Web App Manifest | Installable, offline-capable app            |
| **Bridge**        | Node.js (no deps, port 5174)      | SlimProto TCP ↔ HTTP/SSE for the browser    |

### Protocol Integration

- **SlimProto**: TCP port 3483, handled by `bridge/server.ts`
  - Reference: https://lyrion.org/reference/slimproto-protocol/

---

## Architecture

### How It Works

```
LMS Server (port 3483 TCP)
        │  SlimProto
        ▼
bridge/server.ts  (Node.js, port 5174)
        │  HTTP POST /api/register   → opens TCP connection, returns { token, mac }
        │  GET  /api/events?token=…  → SSE push (stream, pause, volume, …)
        │  POST /api/player/command  → forwards JSON-RPC to LMS
        ▼
src/services/bridge-client.ts  (fetch + EventSource)
        ▼
src/services/lms-connection.ts  (state machine, event handling)
        ▼
src/components/player-controls.ts  (<audio> element + UI)
```

### Project Structure

```
bridge/
└── server.ts              # Node.js bridge: SlimProto TCP + HTTP/SSE API

src/
├── index.html             # Entry point
├── manifest.webmanifest   # PWA metadata
├── service-worker.ts      # Offline support, updates
├── components/
│   ├── app-shell.ts       # App container: shows dialog or player
│   ├── connection-dialog.ts  # Server URL, credentials, player name input
│   └── player-controls.ts   # <audio> element + play/pause/next/prev/volume
├── services/
│   ├── bridge-client.ts   # HTTP client for the bridge server
│   ├── lms-connection.ts  # Player registration, SSE events, state management
│   └── storage.ts         # localStorage: serverUrl, username, playerName
└── utils/
    └── types.ts           # Shared types and constants
```

### State Management

`lms-connection.ts` owns `ConnectionState`:

```typescript
interface ConnectionState {
  status: "idle" | "connecting" | "connected" | "error";
  serverUrl?: string;
  playerId?: string; // MAC address assigned by LMS
  streamUrl?: string; // Current audio stream URL
  playbackStatus?: "playing" | "paused" | "stopped";
  volume?: number; // 0–100
  error?: string;
}
```

Persistent data stored via `storage.ts`: `serverUrl`, `username`, `playerName`.

---

## User Flow (Phase 1 - Player)

```
1. User opens PWA
2. Connection dialog appears
3. User enters: LMS server URL, optional username/password, player name (default "Squeezebox PWA")
4. PWA calls bridge POST /api/register → bridge opens SlimProto TCP to LMS
5. LMS sees a new named Squeezebox player appear
6. Player controls UI loads; <audio> element ready
7. LMS sends strm commands → bridge forwards via SSE → <audio>.src set and played
8. PWA installation prompt shown on successful connection
```

---

## Development Workflow

### TDD-First Approach

1. Write failing test for new feature
2. Implement minimal code to pass test
3. Refactor for clarity/performance
4. Move to next feature

### Testing Strategy

- **Unit**: Component logic, services, state management
- **Integration**: LMS connection flow, SSE event handling

### Git Conventions

- Branch: `feature/<name>`, `fix/<name>`, `test/<name>`
- Commit: Include test status, reference issue numbers if applicable

### Running Tests

```bash
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:ui           # UI dashboard
```

### Building & Serving

```bash
npm run dev               # Development server with HMR (Vite, port 5173)
npm run build             # Production build
npm run preview           # Preview production build
node bridge/server.js     # Run bridge server (port 5174)
```

---

## Key Integration Points

### Bridge Server (`bridge/server.ts`)

- Listens on port 5174 (configurable via `BRIDGE_PORT` env var)
- `POST /api/register` — connects to LMS via SlimProto, sends HELO, returns `{ token, mac, playerName }`
- `GET /api/events?token=…` — SSE stream pushing `stream`, `pause`, `unpause`, `stop`, `volume`, `error` events
- `POST /api/player/command` — forwards JSON-RPC commands to LMS

### Bridge Client (`services/bridge-client.ts`)

- `bridgeClient.registerPlayer(config)` → `Promise<{ token, mac, playerName }>`
- `bridgeClient.openEventStream(token, onEvent)` → returns unsubscribe function
- `bridgeClient.playerCommand(config, command, args)` → `Promise<void>`

### LMS Connection (`services/lms-connection.ts`)

- `lmsConnection.connect(serverUrl, username?, password?, playerName?)` — registers with LMS and opens SSE stream
- `lmsConnection.onStateChange(listener)` — returns unsubscribe function
- `lmsConnection.play()`, `.pause()`, `.sendButton(button)` — send commands via bridge
- `lmsConnection.restoreConnection()` — reconnects from saved `storage.ts` config

### Player Controls (`components/player-controls.ts`)

- Contains a hidden `<audio>` element
- Subscribes to `lmsConnection.onStateChange` and calls `syncAudio()` on state changes:
  - New `streamUrl` → sets `audio.src` and calls `audio.play()`
  - `playbackStatus` change → `audio.play()` or `audio.pause()`
  - `volume` change → `audio.volume = level / 100`

### Service Worker (`src/service-worker.ts`)

- Caches assets for offline access
- Triggers PWA installation prompt after successful LMS connection

---

## Phase 1 Scope (MVP)

**Completed:**

- ✓ Connection dialog with URL, credentials, and player name input
- ✓ Bridge server: SlimProto TCP + HTTP/SSE API
- ✓ Player registration via bridge (PWA appears as named player in LMS)
- ✓ Audio streaming via `<audio>` element driven by SSE events
- ✓ Player controls: play, pause, next, previous, volume display
- ✓ PWA manifest + service worker
- ✓ Installation prompt on successful connection

**Nice to Have (Phase 1):**

- Seek position slider
- Album art display
- Track title / artist display (requires metadata from LMS)
- Keyboard shortcuts

**Future (Phase 2):**

- Music browsing (SlimBrowse API)
- Playlist management
- Multiple player zones

---

## Phase 2 Goals (Browsing)

Once player MVP is stable, extend with:

- Browse music library via SlimBrowse API
  - Reference: https://lyrion.org/reference/slimbrowse/
- Search capability
- Playlist creation and management
- Queue management

---

## Helpful Resources

- **Lyrion/LMS Documentation**: https://lyrion.org/
- **SlimProto Protocol**: https://lyrion.org/reference/slimproto-protocol/
- **SlimBrowse API**: https://lyrion.org/reference/slimbrowse/ (Phase 2)
- **Lit Documentation**: https://lit.dev/
- **Vite Documentation**: https://vitejs.dev/
- **Web App Manifest**: https://developer.mozilla.org/en-US/docs/Web/Manifest
- **Service Workers**: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

---

## Questions for AI Agents

When implementing features, agents should ask themselves:

1. **Does this touch the bridge or the PWA?** Keep them clearly separated.
2. **Have I written tests first?** Before implementation?
3. **Does this need persistent storage?** Use `storage.ts` (serverUrl, username, playerName only — no passwords).
4. **Is this an LMS event or a user action?** Events come via SSE; user actions go via `playerCommand`.
5. **Are there accessibility concerns?** Test with keyboard and screen reader.
6. **Is this component reusable?** Or should it be split further?
