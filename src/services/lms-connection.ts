/**
 * LMS Connection Service
 * Manages this PWA's registration as a Squeezebox player via the local bridge
 */

import {
  bridgeClient,
  type BrowseResult,
  type PlayerEvent,
} from "./bridge-client";
import { storage } from "./storage";
import type { ConnectionStatus, ServerUrl, ButtonCommand } from "@utils/types";
import { CONNECTION_STATUS_VALUES, makeServerUrl } from "@utils/types";

export interface ConnectionState {
  status: ConnectionStatus;
  error?: string;
  serverUrl?: ServerUrl;
  /** MAC address assigned to this player by the bridge */
  playerId?: string;
  /** Current audio stream URL (set when LMS sends a strm-s command) */
  streamUrl?: string;
  /** Playback status driven by LMS strm commands */
  playbackStatus?: "playing" | "paused" | "stopped";
  /** Volume level 0-100 */
  volume?: number;
  /** Current track title from LMS status */
  title?: string;
  /** Current track artist from LMS status */
  artist?: string;
  /** Current track album from LMS status */
  album?: string;
  /** Artwork URL for current track */
  artworkUrl?: string;
  /** Current elapsed position in seconds */
  elapsed?: number;
  /** Current track duration in seconds */
  duration?: number;
}

type PersistedBrowseCache = {
  staleMarker: number;
  entries: Record<string, BrowseResult>;
};

class LmsConnectionService {
  private state: ConnectionState = { status: CONNECTION_STATUS_VALUES.IDLE };
  private localPauseOverride = false;
  private credentials: {
    serverUrl: string;
    username?: string;
    password?: string;
    playerName: string;
  } | null = null;
  private sessionToken: string | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private listeners: Set<(state: ConnectionState) => void> = new Set();

  private browseCache = new Map<
    string,
    { generation: number; result: BrowseResult }
  >();
  private browseCacheGeneration = 0;
  private browseCacheContext: string | null = null;

  private static readonly BROWSE_CACHE_STALE_KEY = "browseCacheStaleMarker";

  async connect(
    serverUrl: string,
    username?: string,
    password?: string,
    playerName = "Squeezebox PWA",
    rememberPassword = false,
  ): Promise<void> {
    try {
      const validatedUrl = makeServerUrl(serverUrl);
      this.setState({
        status: CONNECTION_STATUS_VALUES.CONNECTING,
        serverUrl: validatedUrl,
      });

      const { token, mac } = await bridgeClient.registerPlayer({
        serverUrl: validatedUrl,
        username,
        password,
        playerName,
      });

      this.credentials = {
        serverUrl: validatedUrl,
        username,
        password,
        playerName,
      };
      this.sessionToken = token;
      this.initializeBrowseCache(validatedUrl, mac);
      storage.saveServerConfig(
        serverUrl,
        username,
        password,
        playerName,
        rememberPassword,
      );

      if (this.unsubscribeEvents) this.unsubscribeEvents();
      this.unsubscribeEvents = bridgeClient.openEventStream(token, (event) => {
        this.handlePlayerEvent(event);
      });

      this.setState({
        status: CONNECTION_STATUS_VALUES.CONNECTED,
        serverUrl: validatedUrl,
        playerId: mac,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Connection failed";
      this.setState({
        status: CONNECTION_STATUS_VALUES.ERROR,
        error: errorMessage,
      });
      throw error;
    }
  }

  disconnect(): void {
    if (this.unsubscribeEvents) {
      this.unsubscribeEvents();
      this.unsubscribeEvents = null;
    }
    this.credentials = null;
    this.sessionToken = null;
    this.browseCache.clear();
    this.browseCacheContext = null;
    this.setState({ status: CONNECTION_STATUS_VALUES.IDLE });
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.state.status === CONNECTION_STATUS_VALUES.CONNECTED;
  }

  trackEnded(): void {
    if (!this.sessionToken) return;
    bridgeClient.trackDone(this.sessionToken).catch(console.error);
  }

  trackStarted(elapsedSeconds = 0): void {
    if (!this.sessionToken) return;
    bridgeClient
      .trackStarted(this.sessionToken, elapsedSeconds)
      .catch(console.error);
  }

  private handleCommandError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const isAuthFailure = /status\s+401/.test(message);

    if (isAuthFailure) {
      this.setState({
        status: CONNECTION_STATUS_VALUES.ERROR,
        error:
          "LMS authentication failed (401). Reconnect and enter valid LMS credentials.",
      });
      return;
    }

    console.error(error);
  }

  play(): void {
    if (!this.credentials || !this.state.playerId) return;
    const previousPlaybackStatus = this.state.playbackStatus;
    this.localPauseOverride = false;
    this.setState({ playbackStatus: "playing" });
    bridgeClient
      .playerCommand(
        {
          ...this.credentials,
          token: this.sessionToken ?? undefined,
          playerId: this.state.playerId,
        },
        "pause",
        [0],
      )
      .catch((error) => {
        this.setState({ playbackStatus: previousPlaybackStatus });
        this.handleCommandError(error);
      });
  }

  pause(): void {
    if (!this.credentials || !this.state.playerId) return;
    const previousPlaybackStatus = this.state.playbackStatus;
    this.localPauseOverride = true;
    this.setState({ playbackStatus: "paused" });
    bridgeClient
      .playerCommand(
        {
          ...this.credentials,
          token: this.sessionToken ?? undefined,
          playerId: this.state.playerId,
        },
        "pause",
        [1],
      )
      .catch((error) => {
        this.setState({ playbackStatus: previousPlaybackStatus });
        this.handleCommandError(error);
      });
  }

  togglePause(): void {
    if (this.state.playbackStatus === "playing") {
      this.pause();
      return;
    }

    this.play();
  }

  sendButton(button: ButtonCommand): void {
    if (!this.credentials || !this.state.playerId) return;
    const argsByButton: Partial<Record<ButtonCommand, unknown[]>> = {
      prev: ["index", "-1"] as unknown[],
      next: ["index", "+1"] as unknown[],
    } as Partial<Record<ButtonCommand, unknown[]>>;

    const args = argsByButton[button];
    if (!args) return;

    bridgeClient
      .playerCommand(
        {
          ...this.credentials,
          token: this.sessionToken ?? undefined,
          playerId: this.state.playerId,
        },
        "playlist",
        args,
      )
      .catch((error) => this.handleCommandError(error));
  }

  setVolume(level: number): void {
    if (!this.credentials || !this.state.playerId) return;
    const clampedLevel = Math.max(0, Math.min(100, Math.round(level)));
    bridgeClient
      .playerCommand(
        {
          ...this.credentials,
          token: this.sessionToken ?? undefined,
          playerId: this.state.playerId,
        },
        "mixer",
        ["volume", clampedLevel],
      )
      .catch((error) => this.handleCommandError(error));
  }

  seekTo(seconds: number): void {
    if (!this.credentials || !this.state.playerId) return;
    const clampedSeconds = Math.max(0, Math.round(seconds));

    this.setState({ elapsed: clampedSeconds });

    bridgeClient
      .playerCommand(
        {
          ...this.credentials,
          token: this.sessionToken ?? undefined,
          playerId: this.state.playerId,
        },
        "time",
        [clampedSeconds],
      )
      .catch((error) => this.handleCommandError(error));
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async browseMenu(options?: {
    itemId?: string;
    start?: number;
    quantity?: number;
    search?: string;
    forceRefresh?: boolean;
  }): Promise<BrowseResult> {
    if (!this.credentials || !this.state.playerId) {
      throw new Error("Not connected");
    }

    const normalizedOptions = {
      itemId: options?.itemId,
      start: options?.start ?? 0,
      quantity: options?.quantity ?? 100,
      search: options?.search,
    };

    const cacheKey = JSON.stringify(normalizedOptions);
    const cached = this.browseCache.get(cacheKey);
    if (
      !options?.forceRefresh &&
      cached &&
      cached.generation === this.browseCacheGeneration
    ) {
      return cached.result;
    }

    const result = await bridgeClient.browse(
      {
        ...this.credentials,
        token: this.sessionToken ?? undefined,
        playerId: this.state.playerId,
      },
      normalizedOptions,
    );

    this.browseCache.set(cacheKey, {
      generation: this.browseCacheGeneration,
      result,
    });
    this.persistBrowseCache();

    return result;
  }

  async playBrowseItem(itemId: string): Promise<void> {
    if (!this.credentials || !this.state.playerId) {
      throw new Error("Not connected");
    }

    const trimmedItemId = itemId.trim();
    if (!trimmedItemId) {
      throw new Error("Missing browse item id");
    }

    const browseArgs = this.getBrowsePlaylistControlArgs("load", trimmedItemId);

    await bridgeClient.playerCommand(
      {
        ...this.credentials,
        token: this.sessionToken ?? undefined,
        playerId: this.state.playerId,
      },
      "playlistcontrol",
      browseArgs,
    );
  }

  async addNextBrowseItem(itemId: string): Promise<void> {
    if (!this.credentials || !this.state.playerId) {
      throw new Error("Not connected");
    }

    const trimmedItemId = itemId.trim();
    if (!trimmedItemId) {
      throw new Error("Missing browse item id");
    }

    const browseArgs = this.getBrowsePlaylistControlArgs(
      "insert",
      trimmedItemId,
    );

    await bridgeClient.playerCommand(
      {
        ...this.credentials,
        token: this.sessionToken ?? undefined,
        playerId: this.state.playerId,
      },
      "playlistcontrol",
      browseArgs,
    );
  }

  async addToEndBrowseItem(itemId: string): Promise<void> {
    if (!this.credentials || !this.state.playerId) {
      throw new Error("Not connected");
    }

    const trimmedItemId = itemId.trim();
    if (!trimmedItemId) {
      throw new Error("Missing browse item id");
    }

    const browseArgs = this.getBrowsePlaylistControlArgs("add", trimmedItemId);

    await bridgeClient.playerCommand(
      {
        ...this.credentials,
        token: this.sessionToken ?? undefined,
        playerId: this.state.playerId,
      },
      "playlistcontrol",
      browseArgs,
    );
  }

  private getBrowsePlaylistControlArgs(
    command: "load" | "insert" | "add",
    itemId: string,
  ): string[] {
    const separatorIndex = itemId.indexOf(":");
    const kind = separatorIndex > 0 ? itemId.slice(0, separatorIndex) : "item";
    const value =
      separatorIndex > 0 ? itemId.slice(separatorIndex + 1) : itemId;

    if (!value) {
      throw new Error("Missing browse item id");
    }

    switch (kind) {
      case "track":
        return [`cmd:${command}`, `track_id:${value}`];
      case "album":
        return [`cmd:${command}`, `album_id:${value}`];
      case "artist":
        return [`cmd:${command}`, `artist_id:${value}`];
      case "genre":
        return [`cmd:${command}`, `genre_id:${value}`];
      case "year":
        return [`cmd:${command}`, `year:${value}`];
      case "playlist":
        return [`cmd:${command}`, `playlist_id:${value}`];
      case "folder":
        return [`cmd:${command}`, `folder_id:${value}`];
      case "section":
        throw new Error("Browse section cannot be queued");
      default:
        return [`cmd:${command}`, `item_id:${value}`];
    }
  }

  markBrowseCacheStale(): void {
    this.browseCacheGeneration += 1;
    storage.set(
      LmsConnectionService.BROWSE_CACHE_STALE_KEY,
      this.browseCacheGeneration,
    );

    if (this.browseCacheContext) {
      storage.remove(this.getBrowseCacheStorageKey(this.browseCacheContext));
    }

    this.browseCache.clear();
  }

  clearBrowseCache(): void {
    if (this.browseCacheContext) {
      storage.remove(this.getBrowseCacheStorageKey(this.browseCacheContext));
    }

    this.browseCache.clear();
    this.browseCacheGeneration = 0;
    storage.set(LmsConnectionService.BROWSE_CACHE_STALE_KEY, 0);
  }

  private initializeBrowseCache(serverUrl: string, playerId: string): void {
    this.browseCache.clear();
    this.browseCacheContext = this.getBrowseCacheContext(serverUrl, playerId);

    this.browseCacheGeneration =
      storage.get<number>(LmsConnectionService.BROWSE_CACHE_STALE_KEY, 0) ?? 0;

    const persisted = storage.get<PersistedBrowseCache>(
      this.getBrowseCacheStorageKey(this.browseCacheContext),
    );

    if (!persisted || persisted.staleMarker !== this.browseCacheGeneration) {
      return;
    }

    for (const [key, result] of Object.entries(persisted.entries)) {
      this.browseCache.set(key, {
        generation: this.browseCacheGeneration,
        result,
      });
    }
  }

  private persistBrowseCache(): void {
    if (!this.browseCacheContext) return;

    const entries: Record<string, BrowseResult> = {};
    for (const [key, value] of this.browseCache.entries()) {
      entries[key] = value.result;
    }

    const payload: PersistedBrowseCache = {
      staleMarker: this.browseCacheGeneration,
      entries,
    };

    storage.set(
      this.getBrowseCacheStorageKey(this.browseCacheContext),
      payload,
    );
  }

  private getBrowseCacheContext(serverUrl: string, playerId: string): string {
    return `${serverUrl}::${playerId}`;
  }

  private getBrowseCacheStorageKey(context: string): string {
    return `browseCache_${encodeURIComponent(context)}`;
  }

  private handlePlayerEvent(event: PlayerEvent): void {
    switch (event.type) {
      case "stream":
        this.localPauseOverride = false;
        this.setState({ streamUrl: event.url, playbackStatus: "playing" });
        break;
      case "pause":
        this.setState({ playbackStatus: "paused" });
        break;
      case "unpause":
        this.localPauseOverride = false;
        this.setState({ playbackStatus: "playing" });
        break;
      case "stop":
        this.localPauseOverride = false;
        this.setState({ playbackStatus: "stopped" });
        break;
      case "volume":
        this.setState({ volume: event.level });
        break;
      case "metadata":
        this.setState({
          title: event.title,
          artist: event.artist,
          album: event.album,
          artworkUrl: event.artworkUrl,
          elapsed:
            typeof event.elapsed === "number"
              ? event.elapsed
              : this.state.elapsed,
          duration:
            typeof event.duration === "number"
              ? event.duration
              : this.state.duration,
          playbackStatus:
            this.localPauseOverride || !event.playbackStatus
              ? this.state.playbackStatus
              : event.playbackStatus,
        });
        break;
      case "error":
        this.setState({
          status: CONNECTION_STATUS_VALUES.ERROR,
          error: event.message,
        });
        break;
      default:
        break;
    }
  }

  private setState(updates: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach((listener) => listener(this.getState()));
  }

  async restoreConnection(): Promise<boolean> {
    const config = storage.getServerConfig();
    if (!config) return false;

    const password = storage.getSessionPassword();

    // If a username is configured but no session password is available,
    // avoid reconnecting with incomplete credentials that will 401 on control calls.
    if (config.username && !password) {
      return false;
    }

    try {
      await this.connect(
        config.serverUrl,
        config.username,
        password,
        config.playerName,
      );
      return true;
    } catch {
      return false;
    }
  }
}

export const lmsConnection = new LmsConnectionService();
