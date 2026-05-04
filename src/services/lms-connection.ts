/**
 * LMS Connection Service
 * Manages this PWA's registration as a Squeezebox player via the local bridge
 */

import { bridgeClient, type PlayerEvent } from "./bridge-client";
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

class LmsConnectionService {
  private state: ConnectionState = { status: CONNECTION_STATUS_VALUES.IDLE };
  private localPauseOverride = false;
  private credentials: {
    serverUrl: string;
    username?: string;
    password?: string;
    playerName: string;
  } | null = null;
  private unsubscribeEvents: (() => void) | null = null;
  private listeners: Set<(state: ConnectionState) => void> = new Set();

  async connect(
    serverUrl: string,
    username?: string,
    password?: string,
    playerName = "Squeezebox PWA",
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
      storage.saveServerConfig(serverUrl, username, password, playerName);

      // Open SSE stream for push events from LMS
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
    this.setState({ status: CONNECTION_STATUS_VALUES.IDLE });
  }

  getState(): ConnectionState {
    return { ...this.state };
  }

  isConnected(): boolean {
    return this.state.status === CONNECTION_STATUS_VALUES.CONNECTED;
  }

  play(): void {
    if (!this.credentials || !this.state.playerId) return;
    this.localPauseOverride = false;
    this.setState({ playbackStatus: "playing" });
    bridgeClient
      .playerCommand(
        { ...this.credentials, playerId: this.state.playerId },
        "pause",
        [0],
      )
      .catch(console.error);
  }

  pause(): void {
    if (!this.credentials || !this.state.playerId) return;
    this.localPauseOverride = true;
    this.setState({ playbackStatus: "paused" });
    bridgeClient
      .playerCommand(
        { ...this.credentials, playerId: this.state.playerId },
        "pause",
        [1],
      )
      .catch(console.error);
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
        { ...this.credentials, playerId: this.state.playerId },
        "playlist",
        args,
      )
      .catch(console.error);
  }

  setVolume(level: number): void {
    if (!this.credentials || !this.state.playerId) return;
    const clampedLevel = Math.max(0, Math.min(100, Math.round(level)));
    bridgeClient
      .playerCommand(
        { ...this.credentials, playerId: this.state.playerId },
        "mixer",
        ["volume", clampedLevel],
      )
      .catch(console.error);
  }

  seekTo(seconds: number): void {
    if (!this.credentials || !this.state.playerId) return;
    const clampedSeconds = Math.max(0, Math.round(seconds));

    this.setState({ elapsed: clampedSeconds });

    bridgeClient
      .playerCommand(
        { ...this.credentials, playerId: this.state.playerId },
        "time",
        [clampedSeconds],
      )
      .catch(console.error);
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
        this.setState({ streamUrl: undefined, playbackStatus: "stopped" });
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

    try {
      await this.connect(
        config.serverUrl,
        config.username,
        undefined,
        config.playerName,
      );
      return true;
    } catch {
      return false;
    }
  }
}

export const lmsConnection = new LmsConnectionService();
