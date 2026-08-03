import { lmsConnection, type ConnectionState } from "@services/lms-connection";
import { BUTTON_COMMAND_VALUES } from "@utils/types";

export type AndroidAutoPlaybackStatus = "playing" | "paused" | "stopped";

export interface AndroidAutoMediaSessionPayload {
  isPlaying: boolean;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  position?: number;
  artworkUrl?: string;
  playbackStatus: AndroidAutoPlaybackStatus;
}

interface AndroidAutoMediaSessionInput extends Partial<AndroidAutoMediaSessionPayload> {
  playbackStatus: AndroidAutoPlaybackStatus;
  elapsed?: number;
}

export type AndroidAutoAction = "play" | "pause" | "next" | "previous";

type AndroidAutoActionInput = string | null | undefined;

declare global {
  interface Window {
    AndroidAutoBridge?: {
      updateMediaSession: (payload: AndroidAutoMediaSessionPayload) => void;
      handleAction: (action: string) => void;
    };
  }
}

export const buildAndroidAutoMediaSessionPayload = (
  state: AndroidAutoMediaSessionInput,
): AndroidAutoMediaSessionPayload => ({
  isPlaying: state.playbackStatus === "playing",
  title: state.title,
  artist: state.artist,
  album: state.album,
  duration: state.duration,
  position: state.position ?? state.elapsed,
  artworkUrl: state.artworkUrl,
  playbackStatus: state.playbackStatus,
});

export const normalizeAndroidAutoAction = (
  action: AndroidAutoActionInput,
): AndroidAutoAction | undefined => {
  switch (action) {
    case "play":
    case "pause":
    case "next":
    case "previous":
      return action;
    default:
      return undefined;
  }
};

const updateAndroidAutoMediaSession = (state: ConnectionState): void => {
  const payload = buildAndroidAutoMediaSessionPayload({
    playbackStatus: (state.playbackStatus ??
      "stopped") as AndroidAutoPlaybackStatus,
    title: state.title,
    artist: state.artist,
    album: state.album,
    duration: state.duration,
    elapsed: state.elapsed,
    artworkUrl: state.artworkUrl,
  });

  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    const mediaSession = navigator.mediaSession;

    if (typeof MediaMetadata !== "undefined") {
      const artwork = payload.artworkUrl
        ? [{ src: payload.artworkUrl, sizes: "512x512", type: "image/png" }]
        : [];

      mediaSession.metadata = new MediaMetadata({
        title: payload.title ?? "Squeezebox PWA",
        artist: payload.artist ?? "Lyrion Music Server",
        album: payload.album ?? undefined,
        artwork,
      });
    }

    mediaSession.playbackState = payload.isPlaying ? "playing" : "paused";

    if (typeof payload.duration === "number" && payload.duration > 0) {
      mediaSession.setPositionState({
        duration: payload.duration,
        position: payload.position ?? 0,
        playbackRate: 1,
      });
    }
  }

  window.AndroidAutoBridge?.updateMediaSession(payload);
};

export const initAndroidAutoBridge = (): void => {
  if (typeof window === "undefined") return;

  window.AndroidAutoBridge = {
    updateMediaSession: (payload) => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("android-auto-media-session", { detail: payload }),
      );
    },
    handleAction: (action) => {
      const normalizedAction = normalizeAndroidAutoAction(action);
      if (!normalizedAction) return;

      switch (normalizedAction) {
        case "play":
          lmsConnection.play();
          break;
        case "pause":
          lmsConnection.togglePause();
          break;
        case "next":
          lmsConnection.sendButton(BUTTON_COMMAND_VALUES.NEXT);
          break;
        case "previous":
          lmsConnection.sendButton(BUTTON_COMMAND_VALUES.PREV);
          break;
      }
    },
  };

  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => {
      lmsConnection.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      lmsConnection.togglePause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      lmsConnection.sendButton(BUTTON_COMMAND_VALUES.PREV);
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      lmsConnection.sendButton(BUTTON_COMMAND_VALUES.NEXT);
    });
  }

  const emitCurrentState = () => {
    updateAndroidAutoMediaSession(lmsConnection.getState());
  };

  emitCurrentState();
  const unsubscribe = lmsConnection.onStateChange((state) => {
    updateAndroidAutoMediaSession(state);
  });

  window.addEventListener("beforeunload", () => unsubscribe(), { once: true });
};
