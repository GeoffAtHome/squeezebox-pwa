/**
 * Player State Service
 * Manages playback state and player information
 */

import type { Volume, TrackDuration, TrackPosition } from "@utils/types";
import { makeVolume, makeTrackPosition } from "@utils/types";

export interface PlayerState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTrack?: {
    title: string;
    artist: string;
    album: string;
    duration: TrackDuration;
    position: TrackPosition;
  };
  volume: Volume;
  isMuted: boolean;
}

class PlayerStateService {
  private state: PlayerState = {
    isPlaying: false,
    isPaused: false,
    volume: makeVolume(80),
    isMuted: false,
  };

  private listeners: Set<(state: PlayerState) => void> = new Set();

  /**
   * Get current player state
   */
  getState(): PlayerState {
    return { ...this.state };
  }

  /**
   * Update player state
   */
  setState(updates: Partial<PlayerState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  /**
   * Set current track
   */
  setCurrentTrack(track: PlayerState["currentTrack"]): void {
    this.setState({ currentTrack: track });
  }

  /**
   * Set playing status
   */
  setPlaying(isPlaying: boolean): void {
    this.setState({
      isPlaying,
      isPaused: !isPlaying,
    });
  }

  /**
   * Set volume (0-100)
   */
  setVolume(volume: number): void {
    this.setState({ volume: makeVolume(volume) });
  }

  /**
   * Toggle mute
   */
  toggleMute(): void {
    this.setState({ isMuted: !this.state.isMuted });
  }

  /**
   * Update track position
   */
  updateTrackPosition(position: number): void {
    if (this.state.currentTrack) {
      this.setState({
        currentTrack: {
          ...this.state.currentTrack,
          position: makeTrackPosition(position),
        },
      });
    }
  }

  /**
   * Register for state changes
   */
  onStateChange(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);

    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener(this.getState()));
  }

  /**
   * Reset state
   */
  reset(): void {
    this.state = {
      isPlaying: false,
      isPaused: false,
      volume: makeVolume(80),
      isMuted: false,
    };
    this.notifyListeners();
  }
}

export const playerState = new PlayerStateService();
