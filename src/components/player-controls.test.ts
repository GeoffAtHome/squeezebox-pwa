import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { html } from "lit";
import { render, getByShadow, setupTestCleanup } from "../../test/test-harness";

import { lmsConnection } from "@services/lms-connection";
import "./player-controls";

setupTestCleanup();

// Mock LMS connection service
vi.mock("@services/lms-connection", () => {
  let listener: ((state: any) => void) | undefined;

  const api = {
    getState: vi.fn(() => ({ status: "connected", playbackStatus: "stopped" })),
    onStateChange: vi.fn((cb: (state: any) => void) => {
      listener = cb;
      return () => (listener = undefined);
    }),
    trackEnded: vi.fn(),
    trackStarted: vi.fn(),
    togglePause: vi.fn(),
    sendButton: vi.fn(),
    setVolume: vi.fn(),
    seekTo: vi.fn(),
    __emit(state: any) {
      listener?.(state);
    },
  };

  return { lmsConnection: api };
});

describe("player-controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const emit = (state: any) =>
    (lmsConnection as any).__emit(state);

  it("sends trackdone via fallback after playing->stopped when ended is not fired", async () => {
    const el = await render<HTMLElement>(html`<player-controls></player-controls>`);

    // Ignore startup events
    vi.clearAllMocks();

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=1",
      volume: 50,
    });

    emit({
      status: "connected",
      playbackStatus: "stopped",
      streamUrl: "/api/stream?token=t&rev=1",
      volume: 50,
    });

    vi.advanceTimersByTime(1600);

    expect(lmsConnection.trackEnded).toHaveBeenCalledTimes(1);
  });

  it("cancels trackdone fallback if a new stream arrives quickly", async () => {
    const el = await render<HTMLElement>(html`<player-controls></player-controls>`);

    // Ignore startup events
    vi.clearAllMocks();

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=1",
      volume: 50,
    });

    emit({
      status: "connected",
      playbackStatus: "stopped",
      streamUrl: "/api/stream?token=t&rev=1",
      volume: 50,
    });

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=2",
      volume: 50,
    });

    vi.advanceTimersByTime(1600);

    expect(lmsConnection.trackEnded).not.toHaveBeenCalled();
  });

  it("sends trackdone fallback when stopped state repeats for the same stream", async () => {
    const el = await render<HTMLElement>(html`<player-controls></player-controls>`);

    // Ignore startup events
    vi.clearAllMocks();

    emit({
      status: "connected",
      playbackStatus: "stopped",
      streamUrl: "/api/stream?token=t&rev=9",
      volume: 50,
    });

    emit({
      status: "connected",
      playbackStatus: "stopped",
      streamUrl: "/api/stream?token=t&rev=9",
      volume: 50,
    });

    vi.advanceTimersByTime(1600);

    expect(lmsConnection.trackEnded).toHaveBeenCalledTimes(1);
  });

  it("retries audio play from buffering without toggling pause", async () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(
        Object.assign(new Error("blocked"), { name: "NotAllowedError" }),
      )
      .mockResolvedValue(undefined);

    const el = await render<HTMLElement>(html`<player-controls></player-controls>`);

    // Ignore startup events
    vi.clearAllMocks();

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=21",
      volume: 50,
    });

    await Promise.resolve();

    const playButton = getByShadow<HTMLButtonElement>(el, "button.primary");
    playButton.click();

    expect(lmsConnection.togglePause).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it("reports track started once when audio fires playing for a stream", async () => {
    const el = await render<HTMLElement>(html`<player-controls></player-controls>`);

    // Ignore startup events
    vi.clearAllMocks();

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=31",
      volume: 50,
    });

    const audio = getByShadow<HTMLAudioElement>(el, "audio");

    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("playing"));

    expect(lmsConnection.trackStarted).toHaveBeenCalledTimes(1);
  });

  it("reports track started again for the next stream revision", async () => {
    const el = await render<HTMLElement>(html`<player-controls></player-controls>`);

    // Ignore startup events
    vi.clearAllMocks();

    const audio = getByShadow<HTMLAudioElement>(el, "audio");

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=41",
      volume: 50,
    });
    audio.dispatchEvent(new Event("playing"));

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=42",
      volume: 50,
    });
    audio.dispatchEvent(new Event("playing"));

    expect(lmsConnection.trackStarted).toHaveBeenCalledTimes(2);
  });
});
