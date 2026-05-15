/**
 * LMS Connection Service
 * Manages this PWA's registration as a Squeezebox player via the local bridge
 */

import {
  bridgeClient,
  type BrowseItem,
  type BrowseResult,
  type PlayerEvent,
} from "./bridge-client";
import { browseCacheStore } from "./browse-cache-store";
import { storage } from "./storage";
import type {
  ConnectionStatus,
  ServerUrl,
  ButtonCommand,
  PlayerId,
  StreamUrl,
  ArtworkUrl,
  ItemId,
  Token,
  Username,
} from "@utils/types";
import { PAGE_SIZE } from "../utils/config";
import { CONNECTION_STATUS_VALUES, makeServerUrl } from "@utils/types";

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1"]);

const getDefaultBridgeUrl = (): string => {
  const locationHost = globalThis.location?.hostname;
  if (!locationHost || LOCALHOST_HOSTS.has(locationHost)) {
    return "http://localhost:5174";
  }

  return globalThis.location.origin;
};

const normalizeBridgeUrl = (bridgeUrl: string): string =>
  bridgeUrl.replace(/\/+$/, "");

/** Artwork cache data structure */
interface ArtworkCacheData {
  coverid?: string | number;
  artworkId?: string | number;
  itemId?: string | number;
  fallbackArtworkUrl?: string; // For when no specific ID is found
}

/**
 * Extracts cacheable artwork identifiers from a BrowseItem.
 */
const extractArtworkCacheData = (
  item: BrowseItem,
): ArtworkCacheData | undefined => {
  let cacheData: ArtworkCacheData = {};

  // 1. Check for explicit URL first (if it's already absolute)
  if (item.artworkUrl && /^https?:\/\//i.test(String(item.artworkUrl))) {
    cacheData.fallbackArtworkUrl = String(item.artworkUrl);
    return cacheData;
  }

  // 2. Check for coverid
  if (item.coverid !== undefined && item.coverid !== null) {
    cacheData.coverid = item.coverid;
  }

  // 3. Check for artwork_id
  if (item.artwork_id !== undefined && item.artwork_id !== null) {
    cacheData.artworkId = item.artwork_id;
  }

  // 4. Fallback to general ID if nothing else is found
  if (
    !cacheData.coverid &&
    !cacheData.artworkId &&
    item.id !== undefined &&
    item.id !== null
  ) {
    cacheData.itemId = item.id;
  }

  return Object.keys(cacheData).length > 0 ? cacheData : undefined;
};

/**
 * Generates the artwork URL for a given BrowseItem, using caching logic.
 */
const normalizeBrowseItemArtwork = (
  item: BrowseItem,
  bridgeUrl = import.meta.env.VITE_BRIDGE_URL ?? getDefaultBridgeUrl(),
  token?: string,
): ArtworkUrl | undefined => {
  // 1. Extract cache data from the item
  const cacheData = extractArtworkCacheData(item);

  if (!cacheData) return undefined;

  // 2. Try to use the fallback URL if provided and it's absolute
  if (
    cacheData.fallbackArtworkUrl &&
    /^https?:\/\//i.test(cacheData.fallbackArtworkUrl)
  ) {
    return cacheData.fallbackArtworkUrl as ArtworkUrl;
  }

  // 3. Build the URL using the session token and cached identifiers
  const normalizedBridgeUrl = normalizeBridgeUrl(bridgeUrl);
  let urlParams: Record<string, string> = { token: token ?? "" };

  // Prioritize coverid
  if (cacheData.coverid !== undefined && cacheData.coverid !== null) {
    urlParams.coverid = String(cacheData.coverid);
    return `${normalizedBridgeUrl}/api/artwork?${new URLSearchParams(urlParams).toString()}` as ArtworkUrl;
  }

  // Use artworkId (trackId)
  if (cacheData.artworkId !== undefined && cacheData.artworkId !== null) {
    urlParams.trackId = String(cacheData.artworkId);
    return `${normalizedBridgeUrl}/api/artwork?${new URLSearchParams(urlParams).toString()}` as ArtworkUrl;
  }

  // Fallback to item ID
  if (cacheData.itemId !== undefined && cacheData.itemId !== null) {
    urlParams.trackId = String(cacheData.itemId);
    return `${normalizedBridgeUrl}/api/artwork?${new URLSearchParams(urlParams).toString()}` as ArtworkUrl;
  }

  return undefined;
};

export interface ConnectionState {
  status: ConnectionStatus;
  error?: string;
  serverUrl?: ServerUrl;
  /** MAC address assigned to this player by the bridge */
  playerId?: PlayerId;
  /** Current audio stream URL (set when LMS sends a strm-s command) */
  streamUrl?: StreamUrl;
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
  artworkUrl?: ArtworkUrl;
  /** Current elapsed position in seconds */
  elapsed?: number;
  /** Current track duration in seconds */
  duration?: number;
}

type BrowseWarmTarget = {
  itemId: ItemId;
  label: string;
};

class LmsConnectionService {
  private static readonly BROWSE_PREFETCH_PAGE_SIZE = PAGE_SIZE;
  private static readonly BROWSE_PREFETCH_TARGETS: BrowseWarmTarget[] = [
    { itemId: "section:artists" as ItemId, label: "artists" },
    { itemId: "section:albums" as ItemId, label: "albums" },
    { itemId: "section:tracks" as ItemId, label: "tracks" },
    { itemId: "section:playlists" as ItemId, label: "playlists" },
  ];

  private state: ConnectionState = { status: CONNECTION_STATUS_VALUES.IDLE };
  private localPauseOverride = false;
  private credentials: {
    serverUrl: ServerUrl;
    username?: Username;
    password?: string;
    playerName: string;
  } | null = null;
  private sessionToken: Token | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private listeners: Set<(state: ConnectionState) => void> = new Set();

  private browseCache = new Map<
    string,
    { generation: number; result: BrowseResult }
  >();
  private browseCacheGeneration = 0;
  private browseCacheContext: string | null = null;
  private browseWarmRunId = 0;

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
      const validatedUsername = username ? (username as Username) : undefined;
      this.setState({
        status: CONNECTION_STATUS_VALUES.CONNECTING,
        serverUrl: validatedUrl,
      });

      const { token, mac } = await bridgeClient.registerPlayer({
        serverUrl: validatedUrl,
        username: validatedUsername,
        password,
        playerName,
      });

      this.credentials = {
        serverUrl: validatedUrl,
        username: validatedUsername,
        password,
        playerName,
      };
      this.sessionToken = token;
      await this.initializeBrowseCache(validatedUrl, mac);
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
    this.browseWarmRunId += 1;
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
    itemId?: ItemId;
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
      return this.qualifyBrowseResult(cached.result);
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
    void this.persistBrowseCacheEntry(cacheKey, result);

    return result;
  }

  async playBrowseItem(itemId: ItemId): Promise<void> {
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

  async addToEndBrowseItem(itemId: ItemId): Promise<void> {
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
      void browseCacheStore.deleteContext(this.browseCacheContext);
      storage.remove(
        this.getLegacyBrowseCacheStorageKey(this.browseCacheContext),
      );
    }

    this.browseCache.clear();
  }

  clearBrowseCache(): void {
    this.browseWarmRunId += 1;

    if (this.browseCacheContext) {
      void browseCacheStore.deleteContext(this.browseCacheContext);
      storage.remove(
        this.getLegacyBrowseCacheStorageKey(this.browseCacheContext),
      );
    }

    this.browseCache.clear();
    this.browseCacheGeneration = 0;
    storage.set(LmsConnectionService.BROWSE_CACHE_STALE_KEY, 0);
  }

  warmBrowseCacheInBackground(): Promise<void> {
    if (!this.credentials || !this.state.playerId || !this.sessionToken) {
      return Promise.resolve();
    }

    const runId = ++this.browseWarmRunId;
    return this.prefetchBrowseTargets(runId);
  }

  private async initializeBrowseCache(
    serverUrl: string,
    playerId: string,
  ): Promise<void> {
    this.browseCache.clear();
    this.browseCacheContext = this.getBrowseCacheContext(serverUrl, playerId);

    this.browseCacheGeneration =
      storage.get<number>(LmsConnectionService.BROWSE_CACHE_STALE_KEY, 0) ?? 0;

    storage.remove(
      this.getLegacyBrowseCacheStorageKey(this.browseCacheContext),
    );

    const persisted = await browseCacheStore.loadContext(
      this.browseCacheContext,
      this.browseCacheGeneration,
    );

    for (const [key, result] of Object.entries(persisted)) {
      this.browseCache.set(key, {
        generation: this.browseCacheGeneration,
        result: this.qualifyBrowseResult(result),
      });
    }
  }

  private qualifyBrowseResult(result: BrowseResult): BrowseResult {
    if (!Array.isArray(result.item_loop)) {
      return result;
    }

    // Don't include artworkUrl in cached results - it contains the session token which can go stale.
    // The raw identifiers (coverid, artwork_id, id, artwork_url) are kept, and artworkUrl will be
    // reconstructed on-demand via getBrowseArtworkUrl() using the current session token.
    return {
      ...result,
      item_loop: result.item_loop.map((item) => {
        const { artworkUrl: _unused, ...rest } = item;
        return rest;
      }),
    };
  }

  getBrowseArtworkUrl(item: BrowseItem): ArtworkUrl | undefined {
    return normalizeBrowseItemArtwork(
      item,
      import.meta.env.VITE_BRIDGE_URL ?? getDefaultBridgeUrl(),
      this.sessionToken ?? undefined,
    );
  }

  private async persistBrowseCacheEntry(
    cacheKey: string,
    result: BrowseResult,
  ): Promise<void> {
    if (!this.browseCacheContext) return;

    await browseCacheStore.putEntry(
      this.browseCacheContext,
      this.browseCacheGeneration,
      cacheKey,
      result,
    );
  }

  private getBrowseCacheContext(serverUrl: string, playerId: string): string {
    return `${serverUrl}::${playerId}`;
  }

  private getLegacyBrowseCacheStorageKey(context: string): string {
    return `browseCache_${encodeURIComponent(context)}`;
  }

  private async prefetchBrowseTargets(runId: number): Promise<void> {
    for (const target of LmsConnectionService.BROWSE_PREFETCH_TARGETS) {
      if (!this.isBrowseWarmRunActive(runId)) {
        return;
      }

      try {
        await this.prefetchBrowsePages(target.itemId, runId);
      } catch (error) {
        if (!this.isBrowseWarmRunActive(runId)) {
          return;
        }

        console.warn(
          `[browse-cache] failed to warm ${target.label}`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  private async prefetchBrowsePages(
    itemId: ItemId,
    runId: number,
  ): Promise<void> {
    let start = 0;

    while (this.isBrowseWarmRunActive(runId)) {
      const result = await this.browseMenu({
        itemId,
        start,
        quantity: LmsConnectionService.BROWSE_PREFETCH_PAGE_SIZE,
      });

      const items = result.item_loop ?? [];
      const count = Math.max(items.length, Number(result.count ?? 0));

      if (items.length === 0) {
        return;
      }

      start += LmsConnectionService.BROWSE_PREFETCH_PAGE_SIZE;
      if (
        start >= count ||
        items.length < LmsConnectionService.BROWSE_PREFETCH_PAGE_SIZE
      ) {
        return;
      }
    }
  }

  private isBrowseWarmRunActive(runId: number): boolean {
    return (
      runId === this.browseWarmRunId &&
      this.state.status === CONNECTION_STATUS_VALUES.CONNECTED &&
      !!this.credentials &&
      !!this.state.playerId &&
      !!this.sessionToken
    );
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
