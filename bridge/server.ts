import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createConnection, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import {
  buildHelo,
  buildStat,
  macToBytes,
  playerNameToMac,
} from "./packet-builders.ts";

// ── Types ────────────────────────────────────────────────────────────────────

type BridgeConfig = {
  serverUrl: string;
  username?: string;
  password?: string;
  playerName: string;
};

type SlimCmd = {
  name: string;
  data: Buffer;
};

type StreamSource = {
  url: string;
  headers: Record<string, string>;
  mimeType: string;
};

type Session = {
  token: string;
  config: BridgeConfig;
  mac: string;
  socket: Socket | null;
  tcpBuffer: Buffer;
  sseResponse: ServerResponse | null;
  eventBuffer: object[];
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  metadataTimer: ReturnType<typeof setInterval> | null;
  /** Timer to defer TCP teardown when SSE disconnects — allows reconnect */
  sseCleanupTimer: ReturnType<typeof setTimeout> | null;
  currentStream: StreamSource | null;
  streamRevision: number;
  pendingConnectAckRevision: number | null;
};

type RequestPayload = Record<string, unknown>;

// ── Constants ─────────────────────────────────────────────────────────────────

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? 5174);
const LMS_SLIMPROTO_PORT = 3483;
const REGISTER_TIMEOUT_MS = 5000;
const STAT_INTERVAL_MS = 5000;
const METADATA_INTERVAL_MS = 5000;
/** How long to keep the LMS TCP connection alive after the SSE stream closes */
const SSE_GRACE_MS = 30_000;
const BRIDGE_LOG_COMMANDS = process.env.BRIDGE_LOG_COMMANDS !== "0";
const BRIDGE_LOG_REQUESTS = process.env.BRIDGE_LOG_REQUESTS !== "0";
const DEFAULT_SERVER_URL = process.env.VITE_LMS_SERVER_URL;
const DEFAULT_USERNAME = process.env.VITE_LMS_USERNAME;
const DEFAULT_PASSWORD = process.env.VITE_LMS_PASSWORD;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Cache-Control, Pragma, Last-Event-ID",
};

// ── Session store ─────────────────────────────────────────────────────────────

const sessions = new Map<string, Session>(); // token → session
const macToToken = new Map<string, string>(); // mac → token

// ── SSE helper ────────────────────────────────────────────────────────────────

const writeSseEvent = (res: ServerResponse, data: unknown): void => {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // ignore — client may have disconnected
  }
};

const logCommand = (
  message: string,
  details: Record<string, unknown>,
): void => {
  if (!BRIDGE_LOG_COMMANDS) return;
  console.log(`[bridge] ${message}`, details);
};

const logRequest = (
  message: string,
  details: Record<string, unknown>,
): void => {
  if (!BRIDGE_LOG_REQUESTS) return;
  console.log(`[bridge] ${message}`, details);
};

const emitSessionEvent = (session: Session, event: unknown): void => {
  if (session.sseResponse && !session.sseResponse.writableEnded) {
    writeSseEvent(session.sseResponse, event);
  } else {
    session.eventBuffer.push(event as object);
  }
};

const buildSessionUrl = (
  path: string,
  params: Record<string, string | number | undefined>,
): string => {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
};

type LmsStatusResponse = {
  mode?: string;
  "mixer volume"?: string | number;
  title?: string;
  current_title?: string;
  remote_title?: string;
  artist?: string;
  album?: string;
  playlist_loop?: Array<{
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    id?: string | number;
    artwork_url?: string;
    coverid?: string | number;
  }>;
  time?: number;
  duration?: number;
};

type LmsMenuResult = {
  item_loop?: unknown[];
  count?: number;
  offset?: number;
};

type LmsBrowseEntry = {
  id?: string | number;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string | number;
  title?: string;
  playlist?: string;
  name?: string;
  type?: string;
  coverid?: string | number;
  artwork_url?: string;
  duration?: string | number;
  tracknum?: string | number;
};

type BridgeBrowseItem = {
  id: string;
  text: string;
  subtitle?: string;
  meta?: string;
  artworkUrl?: string;
  hasitems?: number | boolean;
  type?: string;
  canOpen?: boolean;
  canPlay?: boolean;
  canQueue?: boolean;
};

type BridgeBrowseResult = {
  item_loop: BridgeBrowseItem[];
  count: number;
  offset: number;
};

const ROOT_BROWSE_ITEMS: BridgeBrowseItem[] = [
  {
    id: "section:artists",
    text: "Artists",
    subtitle: "Browse by artist",
    hasitems: 1,
    type: "section",
    canOpen: true,
    canPlay: false,
    canQueue: false,
  },
  {
    id: "section:albums",
    text: "Albums",
    subtitle: "Browse by album",
    hasitems: 1,
    type: "section",
    canOpen: true,
    canPlay: false,
    canQueue: false,
  },
  {
    id: "section:tracks",
    text: "Tracks",
    subtitle: "Browse all tracks",
    hasitems: 1,
    type: "section",
    canOpen: true,
    canPlay: false,
    canQueue: false,
  },
  {
    id: "section:genres",
    text: "Genres",
    subtitle: "Browse by genre",
    hasitems: 1,
    type: "section",
    canOpen: true,
    canPlay: false,
    canQueue: false,
  },
  {
    id: "section:years",
    text: "Years",
    subtitle: "Browse by year",
    hasitems: 1,
    type: "section",
    canOpen: true,
    canPlay: false,
    canQueue: false,
  },
  {
    id: "section:playlists",
    text: "Playlists",
    subtitle: "Saved playlists",
    hasitems: 1,
    type: "section",
    canOpen: true,
    canPlay: false,
    canQueue: false,
  },
  {
    id: "section:folders",
    text: "Folders",
    subtitle: "Browse folders",
    hasitems: 1,
    type: "section",
    canOpen: true,
    canPlay: false,
    canQueue: false,
  },
];

const buildBrowseResult = (
  itemLoop: BridgeBrowseItem[],
): BridgeBrowseResult => ({
  item_loop: itemLoop,
  count: itemLoop.length,
  offset: 0,
});

const toBrowseSectionItems = (): BridgeBrowseResult =>
  buildBrowseResult(ROOT_BROWSE_ITEMS);

const parseBrowseId = (
  itemId?: string,
): { kind: string; value?: string } | null => {
  if (!itemId) return null;

  const separatorIndex = itemId.indexOf(":");
  if (separatorIndex <= 0) {
    return { kind: itemId };
  }

  return {
    kind: itemId.slice(0, separatorIndex),
    value: itemId.slice(separatorIndex + 1),
  };
};

const mapQueryItems = (
  entries: LmsBrowseEntry[] | undefined,
  mapEntry: (entry: LmsBrowseEntry, index: number) => BridgeBrowseItem | null,
): BridgeBrowseItem[] => {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry, index) => mapEntry(entry, index))
    .filter((entry): entry is BridgeBrowseItem => entry !== null);
};

const toText = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
};

const formatDuration = (value: unknown): string | undefined => {
  const durationSeconds =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return undefined;
  }

  const totalSeconds = Math.round(durationSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const joinMeta = (...parts: Array<string | undefined>): string | undefined => {
  const values = parts.filter(
    (part): part is string =>
      typeof part === "string" && part.trim().length > 0,
  );

  return values.length > 0 ? values.join(" • ") : undefined;
};

const buildBrowseArtworkUrl = (
  session: Session | undefined,
  entry: Pick<LmsBrowseEntry, "id" | "coverid" | "artwork_url">,
): string | undefined => {
  if (!session) {
    return undefined;
  }

  return buildArtworkProxyUrl(session, entry);
};

const browseLibrary = async (
  config: BridgeConfig,
  start: number,
  quantity: number,
  itemId?: string,
  search?: string,
  session?: Session,
): Promise<BridgeBrowseResult> => {
  const target = parseBrowseId(itemId);

  if (search) {
    const result = await callJsonRpc<{
      titles_loop?: LmsBrowseEntry[];
      song_loop?: LmsBrowseEntry[];
      count?: number;
    }>(config, [0, ["titles", start, quantity, `search:${search}`]]);

    return {
      item_loop: mapQueryItems(
        result.titles_loop ?? result.song_loop,
        (entry, index) => {
          if (entry.id === undefined || entry.id === null) return null;
          return {
            id: `track:${entry.id}`,
            text: toText(entry.title ?? entry.name, `Track ${index + 1}`),
            subtitle: entry.artist,
            meta: joinMeta(entry.album, formatDuration(entry.duration)),
            artworkUrl: buildBrowseArtworkUrl(session, entry),
            hasitems: 0,
            type: "track",
            canOpen: false,
            canPlay: true,
            canQueue: true,
          };
        },
      ),
      count: Number(result.count ?? 0),
      offset: start,
    };
  }

  if (!target) {
    return toBrowseSectionItems();
  }

  switch (target.kind) {
    case "section": {
      switch (target.value) {
        case "artists": {
          const result = await callJsonRpc<{
            artist_loop?: LmsBrowseEntry[];
            artists_loop?: LmsBrowseEntry[];
            count?: number;
          }>(config, [0, ["artists", start, quantity]]);

          return {
            item_loop: mapQueryItems(
              result.artist_loop ?? result.artists_loop,
              (entry, index) => {
                if (entry.id === undefined || entry.id === null) return null;
                return {
                  id: `artist:${entry.id}`,
                  text: toText(
                    entry.artist ?? entry.name,
                    `Artist ${index + 1}`,
                  ),
                  subtitle: "Artist",
                  hasitems: 1,
                  type: "artist",
                  canOpen: true,
                  canPlay: true,
                  canQueue: true,
                };
              },
            ),
            count: Number(result.count ?? 0),
            offset: start,
          };
        }

        case "albums": {
          const result = await callJsonRpc<{
            albums_loop?: LmsBrowseEntry[];
            album_loop?: LmsBrowseEntry[];
            count?: number;
          }>(config, [0, ["albums", start, quantity, "tags:aljcc"]]);

          return {
            item_loop: mapQueryItems(
              result.albums_loop ?? result.album_loop,
              (entry, index) => {
                if (entry.id === undefined || entry.id === null) return null;
                return {
                  id: `album:${entry.id}`,
                  text: toText(
                    entry.album ?? entry.title,
                    `Album ${index + 1}`,
                  ),
                  subtitle: entry.artist,
                  meta:
                    typeof entry.year !== "undefined"
                      ? String(entry.year)
                      : undefined,
                  artworkUrl: buildBrowseArtworkUrl(session, entry),
                  hasitems: 1,
                  type: "album",
                  canOpen: true,
                  canPlay: true,
                  canQueue: true,
                };
              },
            ),
            count: Number(result.count ?? 0),
            offset: start,
          };
        }

        case "tracks": {
          const result = await callJsonRpc<{
            titles_loop?: LmsBrowseEntry[];
            song_loop?: LmsBrowseEntry[];
            count?: number;
          }>(config, [0, ["titles", start, quantity]]);

          return {
            item_loop: mapQueryItems(
              result.titles_loop ?? result.song_loop,
              (entry, index) => {
                if (entry.id === undefined || entry.id === null) return null;
                return {
                  id: `track:${entry.id}`,
                  text: toText(entry.title ?? entry.name, `Track ${index + 1}`),
                  subtitle: entry.artist,
                  meta: joinMeta(entry.album, formatDuration(entry.duration)),
                  artworkUrl: buildBrowseArtworkUrl(session, entry),
                  hasitems: 0,
                  type: "track",
                  canOpen: false,
                  canPlay: true,
                  canQueue: true,
                };
              },
            ),
            count: Number(result.count ?? 0),
            offset: start,
          };
        }

        case "genres": {
          const result = await callJsonRpc<{
            genres_loop?: LmsBrowseEntry[];
            genre_loop?: LmsBrowseEntry[];
            count?: number;
          }>(config, [0, ["genres", start, quantity]]);

          return {
            item_loop: mapQueryItems(
              result.genres_loop ?? result.genre_loop,
              (entry, index) => {
                if (entry.id === undefined || entry.id === null) return null;
                return {
                  id: `genre:${entry.id}`,
                  text: toText(entry.genre ?? entry.name, `Genre ${index + 1}`),
                  subtitle: "Genre",
                  hasitems: 1,
                  type: "genre",
                  canOpen: true,
                  canPlay: true,
                  canQueue: true,
                };
              },
            ),
            count: Number(result.count ?? 0),
            offset: start,
          };
        }

        case "years": {
          const result = await callJsonRpc<{
            years_loop?: LmsBrowseEntry[];
            year_loop?: LmsBrowseEntry[];
            count?: number;
          }>(config, [0, ["years", start, quantity, "hasAlbums:1"]]);

          return {
            item_loop: mapQueryItems(
              result.years_loop ?? result.year_loop,
              (entry, index) => {
                const yearValue =
                  typeof entry.year === "string" ||
                  typeof entry.year === "number"
                    ? String(entry.year)
                    : undefined;
                if (!yearValue) return null;
                return {
                  id: `year:${yearValue}`,
                  text: toText(entry.year, `Year ${index + 1}`),
                  subtitle: "Year",
                  hasitems: 1,
                  type: "year",
                  canOpen: true,
                  canPlay: true,
                  canQueue: true,
                };
              },
            ),
            count: Number(result.count ?? 0),
            offset: start,
          };
        }

        case "playlists": {
          const result = await callJsonRpc<{
            playlists_loop?: LmsBrowseEntry[];
            playlist_loop?: LmsBrowseEntry[];
            count?: number;
          }>(config, [0, ["playlists", start, quantity]]);

          return {
            item_loop: mapQueryItems(
              result.playlists_loop ?? result.playlist_loop,
              (entry, index) => {
                if (entry.id === undefined || entry.id === null) return null;
                return {
                  id: `playlist:${entry.id}`,
                  text: toText(
                    entry.playlist ?? entry.name,
                    `Playlist ${index + 1}`,
                  ),
                  subtitle: "Playlist",
                  hasitems: 1,
                  type: "playlist",
                  canOpen: true,
                  canPlay: true,
                  canQueue: true,
                };
              },
            ),
            count: Number(result.count ?? 0),
            offset: start,
          };
        }

        case "folders": {
          const result = await callJsonRpc<{
            folder_loop?: LmsBrowseEntry[];
            item_loop?: LmsBrowseEntry[];
            count?: number;
          }>(config, [0, ["musicfolder", start, quantity]]);

          return {
            item_loop: mapQueryItems(
              result.folder_loop ?? result.item_loop,
              (entry, index) => {
                if (entry.id === undefined || entry.id === null) return null;
                const type = toText(entry.type, "unknown");
                const isFolder = type === "dir" || type === "folder";
                const isPlaylist = type === "playlist";

                return {
                  id: isFolder
                    ? `folder:${entry.id}`
                    : isPlaylist
                      ? `playlist:${entry.id}`
                      : `track:${entry.id}`,
                  text: toText(entry.title ?? entry.name, `Item ${index + 1}`),
                  subtitle: isFolder
                    ? "Folder"
                    : isPlaylist
                      ? "Playlist"
                      : entry.artist,
                  meta: isFolder
                    ? undefined
                    : joinMeta(entry.album, formatDuration(entry.duration)),
                  artworkUrl:
                    isFolder || isPlaylist
                      ? undefined
                      : buildBrowseArtworkUrl(session, entry),
                  hasitems: isFolder ? 1 : 0,
                  type,
                  canOpen: isFolder || isPlaylist,
                  canPlay: true,
                  canQueue: true,
                };
              },
            ),
            count: Number(result.count ?? 0),
            offset: start,
          };
        }

        default:
          return buildBrowseResult([]);
      }
    }

    case "artist": {
      const result = await callJsonRpc<{
        albums_loop?: LmsBrowseEntry[];
        album_loop?: LmsBrowseEntry[];
        count?: number;
      }>(config, [
        0,
        ["albums", start, quantity, `artist_id:${target.value}`, "tags:aljcc"],
      ]);

      return {
        item_loop: mapQueryItems(
          result.albums_loop ?? result.album_loop,
          (entry, index) => {
            if (entry.id === undefined || entry.id === null) return null;
            return {
              id: `album:${entry.id}`,
              text: toText(entry.album ?? entry.title, `Album ${index + 1}`),
              subtitle: entry.artist,
              meta:
                typeof entry.year !== "undefined"
                  ? String(entry.year)
                  : undefined,
              artworkUrl: buildBrowseArtworkUrl(session, entry),
              hasitems: 1,
              type: "album",
              canOpen: true,
              canPlay: true,
              canQueue: true,
            };
          },
        ),
        count: Number(result.count ?? 0),
        offset: start,
      };
    }

    case "genre": {
      const result = await callJsonRpc<{
        albums_loop?: LmsBrowseEntry[];
        album_loop?: LmsBrowseEntry[];
        count?: number;
      }>(config, [
        0,
        ["albums", start, quantity, `genre_id:${target.value}`, "tags:aljcc"],
      ]);

      return {
        item_loop: mapQueryItems(
          result.albums_loop ?? result.album_loop,
          (entry, index) => {
            if (entry.id === undefined || entry.id === null) return null;
            return {
              id: `album:${entry.id}`,
              text: toText(entry.album ?? entry.title, `Album ${index + 1}`),
              subtitle: entry.artist,
              meta:
                typeof entry.year !== "undefined"
                  ? String(entry.year)
                  : undefined,
              artworkUrl: buildBrowseArtworkUrl(session, entry),
              hasitems: 1,
              type: "album",
              canOpen: true,
              canPlay: true,
              canQueue: true,
            };
          },
        ),
        count: Number(result.count ?? 0),
        offset: start,
      };
    }

    case "year": {
      const result = await callJsonRpc<{
        albums_loop?: LmsBrowseEntry[];
        album_loop?: LmsBrowseEntry[];
        count?: number;
      }>(config, [
        0,
        ["albums", start, quantity, `year:${target.value}`, "tags:aljcc"],
      ]);

      return {
        item_loop: mapQueryItems(
          result.albums_loop ?? result.album_loop,
          (entry, index) => {
            if (entry.id === undefined || entry.id === null) return null;
            return {
              id: `album:${entry.id}`,
              text: toText(entry.album ?? entry.title, `Album ${index + 1}`),
              subtitle: entry.artist,
              meta:
                typeof entry.year !== "undefined"
                  ? String(entry.year)
                  : undefined,
              artworkUrl: buildBrowseArtworkUrl(session, entry),
              hasitems: 1,
              type: "album",
              canOpen: true,
              canPlay: true,
              canQueue: true,
            };
          },
        ),
        count: Number(result.count ?? 0),
        offset: start,
      };
    }

    case "album": {
      const result = await callJsonRpc<{
        titles_loop?: LmsBrowseEntry[];
        song_loop?: LmsBrowseEntry[];
        count?: number;
      }>(config, [
        0,
        [
          "titles",
          start,
          quantity,
          `album_id:${target.value}`,
          "sort:albumtrack",
        ],
      ]);

      return {
        item_loop: mapQueryItems(
          result.titles_loop ?? result.song_loop,
          (entry, index) => {
            if (entry.id === undefined || entry.id === null) return null;
            return {
              id: `track:${entry.id}`,
              text: toText(entry.title ?? entry.name, `Track ${index + 1}`),
              subtitle: entry.artist,
              meta: joinMeta(
                entry.tracknum ? `Track ${entry.tracknum}` : undefined,
                formatDuration(entry.duration),
              ),
              artworkUrl: buildBrowseArtworkUrl(session, entry),
              hasitems: 0,
              type: "track",
              canOpen: false,
              canPlay: true,
              canQueue: true,
            };
          },
        ),
        count: Number(result.count ?? 0),
        offset: start,
      };
    }

    case "playlist": {
      const result = await callJsonRpc<{
        playlisttracks_loop?: LmsBrowseEntry[];
        titles_loop?: LmsBrowseEntry[];
        song_loop?: LmsBrowseEntry[];
        count?: number;
      }>(config, [
        0,
        ["playlists", "tracks", start, quantity, `playlist_id:${target.value}`],
      ]);

      return {
        item_loop: mapQueryItems(
          result.playlisttracks_loop ?? result.titles_loop ?? result.song_loop,
          (entry, index) => {
            if (entry.id === undefined || entry.id === null) return null;
            return {
              id: `track:${entry.id}`,
              text: toText(entry.title ?? entry.name, `Track ${index + 1}`),
              subtitle: entry.artist,
              meta: joinMeta(entry.album, formatDuration(entry.duration)),
              artworkUrl: buildBrowseArtworkUrl(session, entry),
              hasitems: 0,
              type: "track",
              canOpen: false,
              canPlay: true,
              canQueue: true,
            };
          },
        ),
        count: Number(result.count ?? 0),
        offset: start,
      };
    }

    case "folder": {
      const result = await callJsonRpc<{
        folder_loop?: LmsBrowseEntry[];
        item_loop?: LmsBrowseEntry[];
        count?: number;
      }>(config, [
        0,
        ["musicfolder", start, quantity, `folder_id:${target.value}`],
      ]);

      return {
        item_loop: mapQueryItems(
          result.folder_loop ?? result.item_loop,
          (entry, index) => {
            if (entry.id === undefined || entry.id === null) return null;
            const type = toText(entry.type, "unknown");
            const isFolder = type === "dir" || type === "folder";
            const isPlaylist = type === "playlist";

            return {
              id: isFolder
                ? `folder:${entry.id}`
                : isPlaylist
                  ? `playlist:${entry.id}`
                  : `track:${entry.id}`,
              text: toText(entry.title ?? entry.name, `Item ${index + 1}`),
              subtitle: isFolder
                ? "Folder"
                : isPlaylist
                  ? "Playlist"
                  : entry.artist,
              meta: isFolder
                ? undefined
                : joinMeta(entry.album, formatDuration(entry.duration)),
              artworkUrl:
                isFolder || isPlaylist
                  ? undefined
                  : buildBrowseArtworkUrl(session, entry),
              hasitems: isFolder ? 1 : 0,
              type,
              canOpen: isFolder || isPlaylist,
              canPlay: true,
              canQueue: true,
            };
          },
        ),
        count: Number(result.count ?? 0),
        offset: start,
      };
    }

    default:
      return buildBrowseResult([]);
  }
};

const buildArtworkProxyUrl = (
  session: Session,
  current?: {
    id?: string | number;
    artwork_url?: string;
    coverid?: string | number;
  },
): string | undefined => {
  if (current?.coverid !== undefined && current.coverid !== null) {
    return buildSessionUrl("/api/artwork", {
      token: session.token,
      coverid: String(current.coverid),
    });
  }

  if (current?.id !== undefined && current.id !== null) {
    return buildSessionUrl("/api/artwork", {
      token: session.token,
      trackId: String(current.id),
    });
  }

  return buildSessionUrl("/api/artwork", {
    token: session.token,
    player: session.mac,
  });
};

const buildStreamProxyUrl = (session: Session): string =>
  buildSessionUrl("/api/stream", {
    token: session.token,
    rev: session.streamRevision,
  });

const refreshPlayerStatus = async (session: Session): Promise<void> => {
  try {
    const status = await callJsonRpc<LmsStatusResponse>(session.config, [
      session.mac,
      // tags: a=artist, d=duration, K=artwork_url, l=album, c=coverid, e=album_id, t=tracknum
      ["status", "-", 1, "tags:adKlcet"],
    ]);

    const current = status.playlist_loop?.[0];
    const level = Number(status["mixer volume"] ?? NaN);
    if (!Number.isNaN(level)) {
      emitSessionEvent(session, {
        type: "volume",
        level: Math.max(0, Math.min(100, Math.round(level))),
      });
    }

    const modeMap: Record<string, "playing" | "paused" | "stopped"> = {
      play: "playing",
      pause: "paused",
      stop: "stopped",
    };
    const playbackStatus = status.mode ? modeMap[status.mode] : undefined;
    const elapsed = Number(status.time ?? NaN);
    const duration = Number(current?.duration ?? status.duration ?? NaN);

    emitSessionEvent(session, {
      type: "metadata",
      title:
        current?.title ??
        status.current_title ??
        status.remote_title ??
        status.title ??
        "",
      artist: current?.artist ?? status.artist ?? "",
      album: current?.album ?? status.album ?? "",
      artworkUrl: buildArtworkProxyUrl(session, current),
      playbackStatus,
      elapsed: Number.isFinite(elapsed) ? Math.max(0, elapsed) : undefined,
      duration: Number.isFinite(duration) ? Math.max(0, duration) : undefined,
    });
  } catch (err) {
    // Log errors so bridge operator can diagnose credential/network issues.
    // Do NOT tear down the session — polling will retry on the next interval.
    console.error(
      `[bridge] metadata poll failed for ${session.mac}:`,
      err instanceof Error ? err.message : err,
    );
  }
};

const startStatusPolling = (session: Session): void => {
  if (session.metadataTimer) {
    clearInterval(session.metadataTimer);
  }

  void refreshPlayerStatus(session);
  session.metadataTimer = setInterval(() => {
    void refreshPlayerStatus(session);
  }, METADATA_INTERVAL_MS);
};

// ── SlimProto TCP stream parser ───────────────────────────────────────────────

/**
 * LMS→player frame format:
 *   [0..1]  total_length (u16 big-endian) = 4 + data_size
 *   [2..5]  command name (4 ASCII chars)
 *   [6..]   command data
 */
const parseLmsCommands = (
  buf: Buffer,
): { commands: SlimCmd[]; remaining: Buffer } => {
  const commands: SlimCmd[] = [];
  let offset = 0;

  while (offset + 2 <= buf.length) {
    const totalLen = buf.readUInt16BE(offset);
    if (totalLen < 4) break;
    const frameEnd = offset + 2 + totalLen;
    if (frameEnd > buf.length) break; // incomplete frame

    const name = buf.subarray(offset + 2, offset + 6).toString("ascii");
    const data = buf.subarray(offset + 6, frameEnd);
    commands.push({ name, data });
    offset = frameEnd;
  }

  return { commands, remaining: buf.subarray(offset) };
};

// ── LMS command dispatcher ────────────────────────────────────────────────────

const handleLmsCommand = (cmd: SlimCmd, session: Session): void => {
  const { name, data } = cmd;

  switch (name.trim()) {
    case "strm": {
      if (data.length < 24) break;
      const strmCmd = String.fromCharCode(data[0]);

      if (strmCmd === "s") {
        // Start streaming
        const serverPort = data.readUInt16BE(18);
        const serverIpBytes = data.subarray(20, 24);
        const useControlServer = serverIpBytes.every((b) => b === 0);
        const lmsHost = new URL(session.config.serverUrl).hostname;
        const serverIp = useControlServer
          ? lmsHost
          : Array.from(serverIpBytes).join(".");

        const httpHeader = data.subarray(24).toString("ascii");
        const requestLines = httpHeader
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const pathMatch = requestLines[0]?.match(/^GET ([^\s\r\n]+)/);
        const path = pathMatch?.[1] ?? "/";
        const requestHeaders = requestLines
          .slice(1)
          .reduce<Record<string, string>>((headers, line) => {
            const separatorIndex = line.indexOf(":");
            if (separatorIndex <= 0) {
              return headers;
            }

            const name = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            if (!name || !value || /^host$/i.test(name)) {
              return headers;
            }

            headers[name] = value;
            return headers;
          }, {});

        const formatByte = String.fromCharCode(data[2]);
        const mimeByFormat: Record<string, string> = {
          m: "audio/mpeg",
          f: "audio/flac",
          o: "audio/ogg",
          p: "audio/pcm",
          a: "audio/aac",
          l: "audio/alac",
        };
        const mimeType = mimeByFormat[formatByte] ?? "audio/mpeg";
        session.streamRevision += 1;
        const streamUrl = `http://${serverIp}:${serverPort}${path}`;
        session.currentStream = {
          url: streamUrl,
          headers: requestHeaders,
          mimeType,
        };
        session.pendingConnectAckRevision = session.streamRevision;

        emitSessionEvent(session, {
          type: "stream",
          url: buildStreamProxyUrl(session),
          mimeType,
        });
        void refreshPlayerStatus(session);
      } else if (strmCmd === "p") {
        emitSessionEvent(session, { type: "pause" });
        session.socket?.write(buildStat("STMp"));
        void refreshPlayerStatus(session);
      } else if (strmCmd === "u") {
        emitSessionEvent(session, { type: "unpause" });
        session.socket?.write(buildStat("STMr"));
        void refreshPlayerStatus(session);
      } else if (strmCmd === "q" || strmCmd === "f") {
        session.currentStream = null;
        emitSessionEvent(session, { type: "stop" });
        session.socket?.write(buildStat("STMf"));
        void refreshPlayerStatus(session);
      } else if (strmCmd === "t") {
        // Status request — reflect server_timestamp back
        const serverTimestamp = data.readUInt32BE(14);
        const stat = buildStat("STMt");
        stat.writeUInt32BE(serverTimestamp, 55); // server_timestamp field
        session.socket?.write(stat);
      }
      break;
    }

    case "audg": {
      // Volume: data[10..13] = new_left (16.16 fixed-point)
      if (data.length >= 14) {
        const fixedLeft = data.readUInt32BE(10);
        const volume = Math.min(100, Math.round((fixedLeft / 65536) * 100));
        emitSessionEvent(session, { type: "volume", level: volume });
      }
      break;
    }

    case "stat": {
      // Server requesting a STAT update
      session.socket?.write(buildStat("STMt"));
      break;
    }

    // vers, aude, grfe, visu, serv etc. — acknowledged silently
    default:
      break;
  }
};

// ── Session lifecycle ─────────────────────────────────────────────────────────

const cleanupSession = (token: string): void => {
  const session = sessions.get(token);
  if (!session) return;

  if (session.sseCleanupTimer) {
    clearTimeout(session.sseCleanupTimer);
    session.sseCleanupTimer = null;
  }

  if (session.heartbeatTimer) {
    clearInterval(session.heartbeatTimer);
    session.heartbeatTimer = null;
  }

  if (session.metadataTimer) {
    clearInterval(session.metadataTimer);
    session.metadataTimer = null;
  }

  if (session.socket && !session.socket.destroyed) {
    session.socket.destroy();
    session.socket = null;
  }

  sessions.delete(token);
  macToToken.delete(session.mac);
};

/**
 * Open the SlimProto TCP connection for a session.
 * Called when the browser opens the SSE stream.
 */
const attachSocket = (session: Session): void => {
  if (session.socket) return; // already connected

  const lmsHost = new URL(session.config.serverUrl).hostname;
  const macBuf = macToBytes(session.mac);

  const socket = createConnection(LMS_SLIMPROTO_PORT, lmsHost, () => {
    socket.write(buildHelo(macBuf, session.config.playerName));

    // Flush any buffered events once SSE is receiving
    for (const evt of session.eventBuffer) {
      if (session.sseResponse && !session.sseResponse.writableEnded) {
        writeSseEvent(session.sseResponse, evt);
      }
    }
    session.eventBuffer = [];

    // Periodic heartbeat
    session.heartbeatTimer = setInterval(() => {
      if (!socket.destroyed) socket.write(buildStat("STMt"));
    }, STAT_INTERVAL_MS);

    startStatusPolling(session);
  });

  session.socket = socket;

  socket.on("data", (chunk: Buffer) => {
    session.tcpBuffer = Buffer.concat([session.tcpBuffer, chunk]);
    const { commands, remaining } = parseLmsCommands(session.tcpBuffer);
    session.tcpBuffer = remaining;
    for (const cmd of commands) {
      handleLmsCommand(cmd, session);
    }
  });

  socket.on("error", (err) => {
    const res = session.sseResponse;
    if (res && !res.writableEnded) {
      writeSseEvent(res, { type: "error", message: err.message });
      try {
        res.end();
      } catch {}
    }
    cleanupSession(session.token);
  });

  socket.on("close", () => {
    const res = session.sseResponse;
    if (res && !res.writableEnded) {
      try {
        res.end();
      } catch {}
    }
    cleanupSession(session.token);
  });
};

/**
 * Register a new player: opens TCP to LMS, sends HELO, waits for first
 * response to confirm the server accepted us.
 * Rejects after REGISTER_TIMEOUT_MS if no response.
 */
const registerWithLms = (session: Session): Promise<void> => {
  return new Promise((resolve, reject) => {
    const lmsHost = new URL(session.config.serverUrl).hostname;
    const macBuf = macToBytes(session.mac);

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Connection to LMS timed out"));
    }, REGISTER_TIMEOUT_MS);

    const socket = createConnection(LMS_SLIMPROTO_PORT, lmsHost, () => {
      socket.write(buildHelo(macBuf, session.config.playerName));
    });

    socket.once("data", (chunk: Buffer) => {
      clearTimeout(timeout);

      // Store socket and start full listener
      session.socket = socket;
      session.tcpBuffer = chunk; // first chunk is already buffered

      // Process any commands already in the first chunk
      const { commands, remaining } = parseLmsCommands(session.tcpBuffer);
      session.tcpBuffer = remaining;
      for (const cmd of commands) {
        handleLmsCommand(cmd, session);
      }

      // Set up ongoing listeners
      socket.on("data", (c: Buffer) => {
        session.tcpBuffer = Buffer.concat([session.tcpBuffer, c]);
        const { commands: cmds, remaining: rem } = parseLmsCommands(
          session.tcpBuffer,
        );
        session.tcpBuffer = rem;
        for (const cmd of cmds) {
          handleLmsCommand(cmd, session);
        }
      });

      socket.on("error", (err) => {
        const res = session.sseResponse;
        if (res && !res.writableEnded) {
          writeSseEvent(res, { type: "error", message: err.message });
          try {
            res.end();
          } catch {}
        }
        cleanupSession(session.token);
      });

      socket.on("close", () => {
        const res = session.sseResponse;
        if (res && !res.writableEnded) {
          try {
            res.end();
          } catch {}
        }
        cleanupSession(session.token);
      });

      // Heartbeat
      session.heartbeatTimer = setInterval(() => {
        if (!socket.destroyed) socket.write(buildStat("STMt"));
      }, STAT_INTERVAL_MS);

      startStatusPolling(session);

      resolve();
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
};

const scheduleTrackDoneAdvanceFallback = (session: Session): void => {
  const revisionAtSchedule = session.streamRevision;

  setTimeout(() => {
    void (async () => {
      try {
        // A new stream command already arrived; this fallback is stale.
        if (session.streamRevision !== revisionAtSchedule) {
          return;
        }

        const status = await callJsonRpc<LmsStatusResponse>(session.config, [
          session.mac,
          ["status", "-", 1],
        ]);

        const mode = String(status.mode ?? "").toLowerCase();

        // If STMd did not leave LMS actively playing, nudge LMS to the next
        // queue item and explicitly resume playback.
        if (mode !== "play" && mode !== "playing") {
          logCommand("trackdone fallback advance", {
            playerId: session.mac,
            mode: status.mode,
            revisionAtSchedule,
            currentRevision: session.streamRevision,
          });

          await callJsonRpc<unknown>(session.config, [
            session.mac,
            ["playlist", "index", "+1"],
          ]);

          await callJsonRpc<unknown>(session.config, [
            session.mac,
            ["pause", 0],
          ]);
        }
      } catch (error) {
        logCommand("trackdone fallback failed", {
          playerId: session.mac,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, 800);
};

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const normalizeServerUrl = (serverUrl?: string): string => {
  if (!serverUrl) throw new Error("Missing LMS server URL");
  const parsed = new URL(serverUrl);
  if (!/^https?:$/.test(parsed.protocol))
    throw new Error("Invalid LMS server URL");
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
};

const readBody = async (req: IncomingMessage): Promise<RequestPayload> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? (JSON.parse(body) as RequestPayload) : {};
};

const withAuthHeaders = (
  config: Pick<BridgeConfig, "username" | "password">,
): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.username && config.password) {
    headers.Authorization = `Basic ${Buffer.from(
      `${config.username}:${config.password}`,
    ).toString("base64")}`;
  }
  return headers;
};

const sendJson = (
  res: ServerResponse,
  status: number,
  payload: unknown,
): void => {
  res.writeHead(status, {
    ...corsHeaders,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
};

const sendNoContent = (res: ServerResponse): void => {
  res.writeHead(204, corsHeaders);
  res.end();
};

const proxyArtwork = async (
  res: ServerResponse,
  session: Session,
  options: { coverid?: string; trackId?: string; player?: string },
): Promise<void> => {
  const path = options.coverid
    ? `/music/${encodeURIComponent(options.coverid)}/cover.jpg`
    : options.trackId
      ? `/music/${encodeURIComponent(options.trackId)}/cover.jpg`
      : `/music/current/cover.jpg?player=${encodeURIComponent(options.player ?? session.mac)}`;

  const response = await fetch(new URL(path, session.config.serverUrl), {
    method: "GET",
    headers: withAuthHeaders(session.config),
  });

  if (!response.ok || !response.body) {
    sendJson(res, response.status || 502, { error: "Artwork not available" });
    return;
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const imageBuffer = Buffer.from(await response.arrayBuffer());

  res.writeHead(200, {
    ...corsHeaders,
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=30",
  });
  res.end(imageBuffer);
};

const proxyStream = async (
  req: IncomingMessage,
  res: ServerResponse,
  session: Session,
): Promise<void> => {
  if (!session.currentStream) {
    sendJson(res, 409, { error: "No active stream" });
    return;
  }

  const controller = new AbortController();
  req.on("close", () => {
    controller.abort();
  });

  try {
    const upstreamHeaders = new Headers(session.currentStream.headers);
    if (typeof req.headers.range === "string") {
      upstreamHeaders.set("Range", req.headers.range);
    }

    const response = await fetch(session.currentStream.url, {
      method: "GET",
      headers: upstreamHeaders,
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      sendJson(res, response.status || 502, { error: "Stream unavailable" });
      return;
    }

    if (session.pendingConnectAckRevision === session.streamRevision) {
      session.socket?.write(buildStat("STMc"));
      // Safety: if the browser never posts /trackstarted (older client build or
      // suppressed media events), still tell LMS playback started at t=0.
      session.socket?.write(buildStat("STMs", 0));
      session.pendingConnectAckRevision = null;
    }

    const headers: Record<string, string> = {
      ...corsHeaders,
      "Content-Type":
        response.headers.get("content-type") ?? session.currentStream.mimeType,
      "Cache-Control": "no-store",
    };

    for (const name of ["accept-ranges", "content-length", "content-range"]) {
      const value = response.headers.get(name);
      if (value) {
        headers[name] = value;
      }
    }

    res.writeHead(response.status, headers);
    Readable.fromWeb(response.body as any).pipe(res);
  } catch (error) {
    if (controller.signal.aborted || res.writableEnded) {
      return;
    }

    const message =
      error instanceof Error ? error.message : "Unknown stream proxy error";
    sendJson(res, 502, { error: message });
  }
};

const callJsonRpc = async <T>(
  config: BridgeConfig,
  params: unknown[],
): Promise<T> => {
  const response = await fetch(`${config.serverUrl}/jsonrpc.js`, {
    method: "POST",
    headers: withAuthHeaders(config),
    body: JSON.stringify({ id: 1, method: "slim.request", params }),
  });
  if (!response.ok) {
    throw new Error(`LMS JSON-RPC failed with status ${response.status}`);
  }
  const data = (await response.json()) as {
    result?: T;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  return data.result as T;
};

// ── Request handler ───────────────────────────────────────────────────────────

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: "Missing request info" });
    return;
  }

  const requestUrl = new URL(req.url, "http://localhost");
  const requestPath = requestUrl.pathname.replace(/\/+$/, "") || "/";

  logRequest("request", {
    method: req.method,
    rawUrl: req.url,
    path: requestPath,
    origin: req.headers.origin,
    forwardedHost: req.headers["x-forwarded-host"],
    forwardedProto: req.headers["x-forwarded-proto"],
  });

  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  // GET /health
  if (req.method === "GET" && requestPath === "/health") {
    sendJson(res, 200, { ok: true, port: BRIDGE_PORT });
    return;
  }

  // GET /api/artwork?token=...&coverid=...|trackId=...|player=...
  if (req.method === "GET" && requestPath === "/api/artwork") {
    const params = requestUrl.searchParams;
    const token = params.get("token");
    if (!token) {
      sendJson(res, 400, { error: "Missing token" });
      return;
    }

    const session = sessions.get(token);
    if (!session) {
      sendJson(res, 404, { error: "Session not found or expired" });
      return;
    }

    await proxyArtwork(res, session, {
      coverid: params.get("coverid") ?? undefined,
      trackId: params.get("trackId") ?? undefined,
      player: params.get("player") ?? undefined,
    });
    return;
  }

  // GET /api/stream?token=...
  if (req.method === "GET" && requestPath === "/api/stream") {
    const token = requestUrl.searchParams.get("token");
    if (!token) {
      sendJson(res, 400, { error: "Missing token" });
      return;
    }

    const session = sessions.get(token);
    if (!session) {
      sendJson(res, 404, { error: "Session not found or expired" });
      return;
    }

    await proxyStream(req, res, session);
    return;
  }

  // GET /api/events?token=…  (SSE stream)
  if (req.method === "GET" && requestPath === "/api/events") {
    const token = requestUrl.searchParams.get("token");
    if (!token) {
      sendJson(res, 400, { error: "Missing token" });
      return;
    }

    const session = sessions.get(token);
    if (!session) {
      sendJson(res, 404, { error: "Session not found or expired" });
      return;
    }

    res.writeHead(200, {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    session.sseResponse = res;

    // Flush any events that arrived before SSE opened
    for (const evt of session.eventBuffer) {
      writeSseEvent(res, evt);
    }
    session.eventBuffer = [];

    // Send "registered" confirmation
    writeSseEvent(res, {
      type: "registered",
      playerId: session.mac,
      playerName: session.config.playerName,
    });

    req.on("close", () => {
      // Don't immediately tear down the LMS TCP connection — the browser may
      // be mid-reload or recovering from a transient network blip.
      // After SSE_GRACE_MS with no reconnect, clean up for real.
      session.sseResponse = null;
      if (session.sseCleanupTimer) clearTimeout(session.sseCleanupTimer);
      session.sseCleanupTimer = setTimeout(() => {
        cleanupSession(token);
      }, SSE_GRACE_MS);
    });

    // If a cleanup timer was pending from a previous SSE connection, cancel it
    if (session.sseCleanupTimer) {
      clearTimeout(session.sseCleanupTimer);
      session.sseCleanupTimer = null;
    }

    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = await readBody(req);

    // POST /api/register
    if (requestPath === "/api/register") {
      const serverUrl = normalizeServerUrl(
        typeof payload.serverUrl === "string"
          ? payload.serverUrl
          : DEFAULT_SERVER_URL,
      );
      const username =
        typeof payload.username === "string"
          ? payload.username
          : DEFAULT_USERNAME;
      const password =
        typeof payload.password === "string"
          ? payload.password
          : DEFAULT_PASSWORD;
      const playerName =
        typeof payload.playerName === "string" && payload.playerName.trim()
          ? payload.playerName.trim()
          : "Squeezebox PWA";

      const mac = playerNameToMac(playerName);
      const token = randomBytes(16).toString("hex");

      // Clean up any existing session for this player
      const existingToken = macToToken.get(mac);
      if (existingToken) cleanupSession(existingToken);

      const session: Session = {
        token,
        config: { serverUrl, username, password, playerName },
        mac,
        socket: null,
        tcpBuffer: Buffer.alloc(0),
        sseResponse: null,
        eventBuffer: [],
        heartbeatTimer: null,
        metadataTimer: null,
        sseCleanupTimer: null,
        currentStream: null,
        streamRevision: 0,
        pendingConnectAckRevision: null,
      };

      // Open TCP to LMS and wait for first response (confirms registration)
      await registerWithLms(session);

      // Validate JSON-RPC credentials up front so bad credentials fail during
      // connect rather than later on first control command.
      try {
        await callJsonRpc<LmsStatusResponse>(session.config, [
          session.mac,
          ["status", "-", 1],
        ]);
      } catch (error) {
        if (session.metadataTimer) {
          clearInterval(session.metadataTimer);
          session.metadataTimer = null;
        }
        if (session.heartbeatTimer) {
          clearInterval(session.heartbeatTimer);
          session.heartbeatTimer = null;
        }
        if (session.socket && !session.socket.destroyed) {
          session.socket.destroy();
          session.socket = null;
        }
        throw error;
      }

      sessions.set(token, session);
      macToToken.set(mac, token);

      sendJson(res, 200, { ok: true, token, mac, playerName });
      return;
    }

    // POST /api/browse  (library menu via LMS JSON-RPC)
    if (requestPath === "/api/browse") {
      const token =
        typeof payload.token === "string" ? payload.token : undefined;
      const session = token ? sessions.get(token) : undefined;

      logRequest("browse request", {
        hasToken: Boolean(token),
        hasSession: Boolean(session),
        playerId:
          typeof payload.playerId === "string" ? payload.playerId : undefined,
        itemId: typeof payload.itemId === "string" ? payload.itemId : undefined,
        start: typeof payload.start === "number" ? payload.start : undefined,
        quantity:
          typeof payload.quantity === "number" ? payload.quantity : undefined,
        search: typeof payload.search === "string" ? payload.search : undefined,
      });

      if (token && !session) {
        sendJson(res, 404, { error: "Session not found or expired" });
        return;
      }

      const serverUrl = session
        ? session.config.serverUrl
        : normalizeServerUrl(
            typeof payload.serverUrl === "string"
              ? payload.serverUrl
              : DEFAULT_SERVER_URL,
          );
      const username = session
        ? session.config.username
        : typeof payload.username === "string"
          ? payload.username
          : DEFAULT_USERNAME;
      const password = session
        ? session.config.password
        : typeof payload.password === "string"
          ? payload.password
          : DEFAULT_PASSWORD;
      const playerName = session
        ? session.config.playerName
        : typeof payload.playerName === "string"
          ? payload.playerName
          : "Squeezebox PWA";
      const playerId =
        typeof payload.playerId === "string"
          ? payload.playerId
          : (session?.mac ?? playerNameToMac(playerName));

      const start =
        typeof payload.start === "number" && Number.isFinite(payload.start)
          ? Math.max(0, Math.floor(payload.start))
          : 0;
      const quantity =
        typeof payload.quantity === "number" &&
        Number.isFinite(payload.quantity)
          ? Math.max(1, Math.floor(payload.quantity))
          : 100;
      const itemId =
        typeof payload.itemId === "string" && payload.itemId.trim()
          ? payload.itemId.trim()
          : undefined;
      const search =
        typeof payload.search === "string" && payload.search.trim()
          ? payload.search.trim()
          : undefined;

      const config: BridgeConfig = {
        serverUrl,
        username,
        password,
        playerName,
      };

      const result = await browseLibrary(
        config,
        start,
        quantity,
        itemId,
        search,
        session,
      );

      logRequest("browse result", {
        playerId,
        itemCount: Array.isArray(result.item_loop)
          ? result.item_loop.length
          : 0,
        count: result.count,
        offset: result.offset,
        firstItem: result.item_loop?.[0]?.text,
      });

      sendJson(res, 200, { ok: true, result });
      return;
    }

    // POST /api/player/command  (play, pause, skip etc. via LMS JSON-RPC)
    if (requestPath === "/api/player/command") {
      const token =
        typeof payload.token === "string" ? payload.token : undefined;
      const session = token ? sessions.get(token) : undefined;

      if (token && !session) {
        sendJson(res, 404, { error: "Session not found or expired" });
        return;
      }

      const serverUrl = session
        ? session.config.serverUrl
        : normalizeServerUrl(
            typeof payload.serverUrl === "string"
              ? payload.serverUrl
              : DEFAULT_SERVER_URL,
          );
      const username = session
        ? session.config.username
        : typeof payload.username === "string"
          ? payload.username
          : DEFAULT_USERNAME;
      const password = session
        ? session.config.password
        : typeof payload.password === "string"
          ? payload.password
          : DEFAULT_PASSWORD;
      const playerName = session
        ? session.config.playerName
        : typeof payload.playerName === "string"
          ? payload.playerName
          : "Squeezebox PWA";
      const playerId =
        typeof payload.playerId === "string"
          ? payload.playerId
          : (session?.mac ?? playerNameToMac(playerName));
      const command =
        typeof payload.command === "string" ? payload.command : undefined;
      const args = Array.isArray(payload.args) ? payload.args : [];

      if (!command) throw new Error("Missing player command");

      const config: BridgeConfig = {
        serverUrl,
        username,
        password,
        playerName,
      };
      const startedAt = Date.now();
      logCommand("player command", {
        playerId,
        command,
        args,
      });

      const result = await callJsonRpc<unknown>(config, [
        playerId,
        [command, ...args],
      ]);

      logCommand("player command result", {
        playerId,
        command,
        elapsedMs: Date.now() - startedAt,
        ok: true,
        result,
      });

      sendJson(res, 200, { ok: true });
      return;
    }

    // POST /api/player/trackdone  — player reports audio playback ended; advance LMS queue
    if (requestPath === "/api/player/trackdone") {
      const token =
        typeof payload.token === "string" ? payload.token : undefined;
      const session = token ? sessions.get(token) : undefined;

      if (!session) {
        sendJson(res, 404, { error: "Session not found or expired" });
        return;
      }

      session.socket?.write(buildStat("STMd"));
      scheduleTrackDoneAdvanceFallback(session);
      sendJson(res, 200, { ok: true });
      return;
    }

    // POST /api/player/trackstarted  — player reports playback started for current stream
    if (requestPath === "/api/player/trackstarted") {
      const token =
        typeof payload.token === "string" ? payload.token : undefined;
      const session = token ? sessions.get(token) : undefined;

      if (!session) {
        sendJson(res, 404, { error: "Session not found or expired" });
        return;
      }

      const elapsedMs =
        typeof payload.elapsedMs === "number" &&
        Number.isFinite(payload.elapsedMs)
          ? Math.max(0, Math.floor(payload.elapsedMs))
          : 0;

      session.socket?.write(buildStat("STMs", elapsedMs));
      sendJson(res, 200, { ok: true });
      return;
    }

    logRequest("route not found", {
      method: req.method,
      rawUrl: req.url,
      path: requestPath,
    });
    sendJson(res, 404, { error: "Route not found" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown bridge error";
    const statusMatch = message.match(/status\s+(\d{3})/i);
    const statusCode = statusMatch ? Number(statusMatch[1]) : 500;
    const responseCode = Number.isFinite(statusCode) ? statusCode : 500;
    logCommand("request failed", {
      path: req.url,
      method: req.method,
      message,
    });
    sendJson(res, responseCode, { error: message });
  }
};

// ── Server startup ────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    const message = err instanceof Error ? err.message : "Unhandled error";
    sendJson(res, 500, { error: message });
  });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Bridge port ${BRIDGE_PORT} is already in use. Is another instance running?`,
    );
  } else {
    console.error("Bridge server error:", err.message);
  }
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception in bridge:", err);
  // Don't exit — keep serving other sessions
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in bridge:", reason);
});

server.listen(BRIDGE_PORT, () => {
  console.log(`LMS bridge listening on http://localhost:${BRIDGE_PORT}`);
  console.log(
    `[bridge] logging flags: requests=${BRIDGE_LOG_REQUESTS ? "on" : "off"}, commands=${BRIDGE_LOG_COMMANDS ? "on" : "off"}`,
  );
});
