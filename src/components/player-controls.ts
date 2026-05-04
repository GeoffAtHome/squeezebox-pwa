/**
 * Player Controls Component
 * Plays audio streamed by LMS and provides playback controls
 */

import { LitElement, html, css } from "lit";
import { customElement, state, query } from "lit/decorators.js";
import { lmsConnection, type ConnectionState } from "@services/lms-connection";
import { BUTTON_COMMAND_VALUES } from "@utils/types";

@customElement("player-controls")
export class PlayerControls extends LitElement {
  @state()
  connectionState: ConnectionState = lmsConnection.getState();

  @state()
  private transportStatus: "playing" | "paused" | "stopped" | "buffering" =
    "stopped";

  @state()
  private seekDraft: number | null = null;

  @state()
  private localElapsed = 0;

  @state()
  private localDuration = 0;

  @query("audio")
  private audioEl!: HTMLAudioElement;

  private unsubscribeConnection: (() => void) | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;

  // After a seek, LMS restarts the stream so audio.currentTime resets to 0.
  // We track the seek target and the audio.currentTime baseline at the moment
  // of the seek, then compute: localElapsed = seekOffset + (currentTime - audioBase)
  private seekOffset = 0;
  private audioBase = 0;

  static styles = css`
    :host {
      display: block;
      max-width: 500px;
      margin: 0 auto;
    }

    .player {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 2rem;
    }

    .track-info {
      text-align: center;
      margin-bottom: 2rem;
      min-height: 100px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .album-art {
      width: 200px;
      height: 200px;
      background: #333;
      border-radius: 8px;
      margin: 0 auto 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3rem;
    }

    .album-art img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 8px;
    }

    .track-title {
      font-size: 1.3rem;
      font-weight: 600;
      margin: 0.5rem 0;
      word-break: break-word;
    }

    .track-artist {
      color: #aaa;
      font-size: 0.95rem;
      margin: 0.25rem 0;
    }

    .track-album {
      color: #666;
      font-size: 0.85rem;
      margin: 0.25rem 0;
    }

    .transport {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      margin-top: 0.75rem;
      font-size: 0.8rem;
      color: #9aa0a6;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .transport-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #666;
    }

    .transport-dot.playing {
      background: #2ecc71;
      box-shadow: 0 0 8px #2ecc71;
    }

    .transport-dot.paused {
      background: #f1c40f;
    }

    .transport-dot.stopped {
      background: #7f8c8d;
    }

    .transport-dot.buffering {
      background: #3498db;
      animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
      0% {
        opacity: 0.4;
      }
      50% {
        opacity: 1;
      }
      100% {
        opacity: 0.4;
      }
    }

    .progress {
      margin: 2rem 0;
    }

    .progress-bar {
      width: 100%;
      height: 4px;
      background: #333;
      border-radius: 2px;
      overflow: hidden;
      cursor: pointer;
    }

    .progress-fill {
      height: 100%;
      background: #0066cc;
      transition: width 0.1s;
    }

    .time-display {
      display: flex;
      justify-content: space-between;
      color: #888;
      font-size: 0.8rem;
      margin-top: 0.5rem;
    }

    .controls {
      display: flex;
      justify-content: center;
      gap: 1rem;
      margin: 2rem 0;
      flex-wrap: wrap;
    }

    button {
      width: 50px;
      height: 50px;
      border: none;
      border-radius: 50%;
      background: #333;
      color: #fff;
      font-size: 1.2rem;
      cursor: pointer;
      transition: background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    button:hover {
      background: #444;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.primary {
      background: #0066cc;
      width: 60px;
      height: 60px;
      font-size: 1.5rem;
    }

    button.primary:hover {
      background: #0052a3;
    }

    .volume-control {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      justify-content: center;
      margin-top: 2rem;
    }

    .volume-slider {
      width: 150px;
      height: 4px;
      cursor: pointer;
    }

    .volume-label {
      font-size: 0.8rem;
      color: #888;
      min-width: 30px;
    }

    .seek-slider {
      width: 100%;
      margin-top: 0.75rem;
      cursor: pointer;
    }

    .no-track {
      text-align: center;
      color: #666;
      padding: 2rem 0;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribeConnection = lmsConnection.onStateChange((state) => {
      const prev = this.connectionState;
      this.connectionState = state;
      this.syncAudio(prev, state);
    });

    this.elapsedTimer = setInterval(() => {
      const audio = this.audioEl;
      if (!audio) return;

      const rawDuration = audio.duration;
      const rawCurrentTime = audio.currentTime;

      if (Number.isFinite(rawDuration) && rawDuration > 0) {
        this.localDuration = rawDuration;
      }

      if (!this.seekDraft && Number.isFinite(rawCurrentTime)) {
        // Offset compensates for LMS restarting the stream after a seek:
        // audio.currentTime resets to 0, but we want position = seekOffset + elapsed_since_seek
        const delta = Math.max(0, rawCurrentTime - this.audioBase);
        this.localElapsed = this.seekOffset + delta;
      }
    }, 500);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.unsubscribeConnection) {
      this.unsubscribeConnection();
    }
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  private syncAudio(prev: ConnectionState, next: ConnectionState): void {
    if (!this.audioEl) return;

    // New stream URL → load and play; reset seek tracking
    if (next.streamUrl && next.streamUrl !== prev.streamUrl) {
      this.audioEl.src = next.streamUrl;
      this.transportStatus = "buffering";
      this.localElapsed = 0;
      this.localDuration = 0;
      this.seekOffset = 0;
      this.audioBase = 0;
      this.audioEl.play().catch(console.error);
      return;
    }

    if (next.playbackStatus !== prev.playbackStatus) {
      if (next.playbackStatus === "playing") {
        this.transportStatus = "buffering";
        this.audioEl.play().catch(console.error);
      } else if (
        next.playbackStatus === "paused" ||
        next.playbackStatus === "stopped"
      ) {
        this.transportStatus = next.playbackStatus;
        this.audioEl.pause();
      }
    }

    if (next.volume !== undefined && next.volume !== prev.volume) {
      this.audioEl.volume = next.volume / 100;
    }
  }

  private handlePlayPause = () => {
    lmsConnection.togglePause();
  };

  private handlePrevious = () => {
    lmsConnection.sendButton(BUTTON_COMMAND_VALUES.PREV);
  };

  private handleNext = () => {
    lmsConnection.sendButton(BUTTON_COMMAND_VALUES.NEXT);
  };

  private handleVolumeInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const level = Number(target.value);
    lmsConnection.setVolume(level);
  };

  private handleSeekInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    this.seekDraft = Number(target.value);
  };

  private handleSeekChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const position = Number(target.value);
    // Set offset so that after LMS restarts the stream (audio.currentTime → 0),
    // the interval computes localElapsed = position + (currentTime - base)
    this.seekOffset = position;
    this.audioBase = this.audioEl?.currentTime ?? 0;
    this.localElapsed = position;
    this.seekDraft = null;
    lmsConnection.seekTo(position);
  };

  private handleAudioPlaying = () => {
    this.transportStatus = "playing";
  };

  private handleAudioWaiting = () => {
    if (this.connectionState.playbackStatus === "playing") {
      this.transportStatus = "buffering";
    }
  };

  private handleAudioPause = () => {
    this.transportStatus =
      this.connectionState.playbackStatus === "stopped" ? "stopped" : "paused";
  };

  private handleAudioEnded = () => {
    this.transportStatus = "stopped";
  };

  private formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const totalSeconds = Math.floor(seconds);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  render() {
    const {
      playbackStatus,
      streamUrl,
      volume,
      playerId,
      title,
      artist,
      album,
      artworkUrl,
      elapsed,
      duration,
    } = this.connectionState;
    const isPlaying = playbackStatus === "playing";
    const hasTrackInfo = Boolean(title || artist || album || streamUrl);
    const displayVolume = volume ?? 100;
    // Prefer audio element's own values for real-time accuracy;
    // fall back to LMS-polled values before audio has loaded.
    const effectiveDuration =
      this.localDuration > 0 ? this.localDuration : (duration ?? 0);
    const totalDuration = Math.max(0, effectiveDuration);
    const rawElapsed = this.seekDraft ?? this.localElapsed ?? elapsed ?? 0;
    const currentPosition = Math.max(
      0,
      Math.min(totalDuration || Number.MAX_SAFE_INTEGER, rawElapsed),
    );
    const statusLabel =
      this.transportStatus === "buffering"
        ? "Buffering"
        : this.transportStatus === "playing"
          ? "Playing"
          : this.transportStatus === "paused"
            ? "Paused"
            : "Stopped";

    return html`
      <audio
        @playing=${this.handleAudioPlaying}
        @waiting=${this.handleAudioWaiting}
        @stalled=${this.handleAudioWaiting}
        @pause=${this.handleAudioPause}
        @ended=${this.handleAudioEnded}
      ></audio>

      <div class="player">
        <div class="track-info">
          ${hasTrackInfo
            ? html`
                <div class="album-art">
                  ${artworkUrl
                    ? html`<img
                        src="${artworkUrl}"
                        alt="Album art"
                        width="200"
                        height="200"
                      />`
                    : html`🎵`}
                </div>
                <div class="track-title">${title || "Unknown title"}</div>
                <div class="track-artist">${artist || "Unknown artist"}</div>
                <div class="track-album">${album || "Unknown album"}</div>
                <div class="track-album">Player: ${playerId ?? ""}</div>
                <div class="transport">
                  <span class="transport-dot ${this.transportStatus}"></span>
                  <span>${statusLabel}</span>
                </div>
              `
            : html`<div class="no-track">
                Waiting for LMS to send a track…
              </div>`}
        </div>

        <div class="progress">
          <input
            class="seek-slider"
            type="range"
            min="0"
            max=${String(Math.max(totalDuration, 1))}
            .value=${String(currentPosition)}
            @input=${this.handleSeekInput}
            @change=${this.handleSeekChange}
            aria-label="Seek"
            ?disabled=${totalDuration <= 0}
          />
          <div class="time-display">
            <span>${this.formatTime(currentPosition)}</span>
            <span>${this.formatTime(totalDuration)}</span>
          </div>
        </div>

        <div class="controls">
          <button @click=${this.handlePrevious} title="Previous">⏮</button>
          <button
            class="primary"
            @click=${this.handlePlayPause}
            title="${isPlaying ? "Pause" : "Play"}"
          >
            ${isPlaying ? "⏸" : "▶"}
          </button>
          <button @click=${this.handleNext} title="Next">⏭</button>
        </div>

        <div class="volume-control">
          <span class="volume-label">🔊</span>
          <input
            class="volume-slider"
            type="range"
            min="0"
            max="100"
            .value=${String(displayVolume)}
            @input=${this.handleVolumeInput}
            aria-label="Volume"
          />
          <span class="volume-label">${displayVolume}%</span>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "player-controls": PlayerControls;
  }
}
