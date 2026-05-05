/**
 * Bridge Client
 * Communicates with the local LMS bridge server (HTTP + SSE)
 */

export interface RegisterConfig {
  serverUrl: string;
  username?: string;
  password?: string;
  playerName: string;
}

export interface RegisterResult {
  token: string;
  mac: string;
  playerName: string;
}

export interface BrowseConfig extends RegisterConfig {
  playerId: string;
  token?: string;
}

export interface BrowseQuery {
  itemId?: string;
  start?: number;
  quantity?: number;
  search?: string;
}

export interface BrowseItem {
  id?: string | number;
  node?: string;
  text?: string;
  name?: string;
  type?: string;
  hasitems?: number | boolean;
  passthrough?: Record<string, unknown>;
}

export interface BrowseResult {
  item_loop?: BrowseItem[];
  count?: number;
  offset?: number;
}

export type PlayerEvent =
  | { type: "registered"; playerId: string; playerName: string }
  | { type: "stream"; url: string; mimeType: string }
  | { type: "pause" }
  | { type: "unpause" }
  | { type: "stop" }
  | { type: "volume"; level: number }
  | {
      type: "metadata";
      title: string;
      artist: string;
      album: string;
      artworkUrl?: string;
      playbackStatus?: "playing" | "paused" | "stopped";
      elapsed?: number;
      duration?: number;
    }
  | { type: "error"; message: string };

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1"]);

const getDefaultBridgeUrl = (): string => {
  const locationHost = globalThis.location?.hostname;
  if (!locationHost || LOCALHOST_HOSTS.has(locationHost)) {
    return "http://localhost:5174";
  }

  return globalThis.location.origin;
};

const normalizeBridgeUrl = (bridgeUrl: string): string =>
  bridgeUrl.replace(/\/$/, "");

const qualifyBridgeUrl = (
  url: string | undefined,
  bridgeUrl: string,
): string | undefined => {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${normalizeBridgeUrl(bridgeUrl)}${url.startsWith("/") ? url : `/${url}`}`;
};

const DEFAULT_BRIDGE_URL = getDefaultBridgeUrl();
const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL ?? DEFAULT_BRIDGE_URL;

const isJsonResponse = (res: Response): boolean => {
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("application/json");
};

const summarizeNonJsonBody = (body: string): string => {
  const trimmed = body.trim();
  if (!trimmed) return "empty response";

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
    return "received HTML instead of JSON";
  }

  return `non-JSON response: ${trimmed.slice(0, 160)}`;
};

const parseJsonBody = async <T>(
  res: Response,
  endpoint: string,
): Promise<T> => {
  if (isJsonResponse(res)) {
    return (await res.json()) as T;
  }

  const body = await res.text();
  throw new Error(
    `Bridge ${endpoint} returned unexpected content-type (${res.headers.get("content-type") ?? "unknown"}); ${summarizeNonJsonBody(body)}`,
  );
};

export class BridgeClient {
  constructor(
    private readonly bridgeUrl: string = normalizeBridgeUrl(BRIDGE_URL),
  ) {}

  /**
   * Register the PWA as a named Squeezebox player with LMS.
   * The bridge opens a SlimProto TCP connection and returns a session token.
   */
  async registerPlayer(config: RegisterConfig): Promise<RegisterResult> {
    const res = await fetch(`${this.bridgeUrl}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    const data = (await parseJsonBody<
      RegisterResult & {
        ok?: boolean;
        error?: string;
      }
    >(res, "/api/register")) as RegisterResult & {
      ok?: boolean;
      error?: string;
    };

    if (!res.ok || !data.token) {
      throw new Error(data.error ?? "Player registration failed");
    }

    return { token: data.token, mac: data.mac, playerName: data.playerName };
  }

  /**
   * Open the SSE event stream for an active player session.
   * Returns an unsubscribe function.
   */
  openEventStream(
    token: string,
    onEvent: (event: PlayerEvent) => void,
  ): () => void {
    const url = `${this.bridgeUrl}/api/events?token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);

    source.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as PlayerEvent;

        if (event.type === "stream") {
          onEvent({
            ...event,
            url: qualifyBridgeUrl(event.url, this.bridgeUrl) ?? event.url,
          });
          return;
        }

        if (event.type === "metadata") {
          onEvent({
            ...event,
            artworkUrl: qualifyBridgeUrl(event.artworkUrl, this.bridgeUrl),
          });
          return;
        }

        onEvent(event);
      } catch {
        // ignore parse errors
      }
    };

    source.onerror = () => {
      onEvent({ type: "error", message: "Bridge connection lost" });
    };

    return () => {
      source.close();
    };
  }

  /**
   * Send a player command via LMS JSON-RPC (e.g. play, pause, playlist skip).
   */
  async playerCommand(
    config: RegisterConfig & { playerId: string; token?: string },
    command: string,
    args: unknown[] = [],
  ): Promise<void> {
    const res = await fetch(`${this.bridgeUrl}/api/player/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, token: config.token, command, args }),
    });

    if (!res.ok) {
      const data = await parseJsonBody<{ error?: string }>(
        res,
        "/api/player/command",
      );
      throw new Error(data.error ?? "Player command failed");
    }
  }

  /**
   * Notify the bridge that audio playback ended so it can send STMd to LMS
   * and advance the queue.
   */
  async trackDone(token: string): Promise<void> {
    await fetch(`${this.bridgeUrl}/api/player/trackdone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  }

  /**
   * Browse LMS library menu for this player session.
   */
  async browse(
    config: BrowseConfig,
    query: BrowseQuery = {},
  ): Promise<BrowseResult> {
    const res = await fetch(`${this.bridgeUrl}/api/browse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...config,
        token: config.token,
        itemId: query.itemId,
        start: query.start,
        quantity: query.quantity,
        search: query.search,
      }),
    });

    const data = await parseJsonBody<{
      ok?: boolean;
      error?: string;
      result?: BrowseResult;
    }>(res, "/api/browse");

    if (!res.ok || !data.result) {
      throw new Error(data.error ?? "Browse request failed");
    }

    return data.result;
  }
}

export const bridgeClient = new BridgeClient();
