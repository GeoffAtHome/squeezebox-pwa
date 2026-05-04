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

const DEFAULT_BRIDGE_URL = "http://localhost:5174";
const BRIDGE_URL =
  (import.meta.env?.VITE_BRIDGE_URL as string | undefined) ??
  DEFAULT_BRIDGE_URL;

export class BridgeClient {
  constructor(private readonly bridgeUrl: string = BRIDGE_URL) {}

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

    const data = (await res.json()) as RegisterResult & {
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
    config: RegisterConfig & { playerId: string },
    command: string,
    args: unknown[] = [],
  ): Promise<void> {
    const res = await fetch(`${this.bridgeUrl}/api/player/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...config, command, args }),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Player command failed");
    }
  }
}

export const bridgeClient = new BridgeClient();
