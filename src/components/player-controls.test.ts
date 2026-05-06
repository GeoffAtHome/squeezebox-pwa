import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@services/lms-connection", () => {
  let listener: ((state: any) => void) | undefined;

  const api = {
    getState: vi.fn(() => ({ status: "connected", playbackStatus: "stopped" })),
    onStateChange: vi.fn((cb: (state: any) => void) => {
      listener = cb;
      return () => {
        listener = undefined;
      };
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

import "./player-controls";
import { lmsConnection } from "@services/lms-connection";

describe("player-controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();

    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sends trackdone via fallback after playing->stopped when ended is not fired", async () => {
    const element = document.createElement("player-controls");
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const emit = (lmsConnection as any).__emit as (state: any) => void;

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

    expect((lmsConnection as any).trackEnded).toHaveBeenCalledTimes(1);
  });

  it("cancels trackdone fallback if a new stream arrives quickly", async () => {
    const element = document.createElement("player-controls");
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const emit = (lmsConnection as any).__emit as (state: any) => void;

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

    expect((lmsConnection as any).trackEnded).not.toHaveBeenCalled();
  });

  it("sends trackdone fallback when stopped state repeats for the same stream", async () => {
    const element = document.createElement("player-controls");
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const emit = (lmsConnection as any).__emit as (state: any) => void;

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

    expect((lmsConnection as any).trackEnded).toHaveBeenCalledTimes(1);
  });

  it("retries audio play from buffering without toggling pause", async () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(
        Object.assign(new Error("blocked"), { name: "NotAllowedError" }),
      )
      .mockResolvedValue(undefined);

    const element = document.createElement("player-controls");
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const emit = (lmsConnection as any).__emit as (state: any) => void;

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=21",
      volume: 50,
    });

    await Promise.resolve();

    const playButton = (element.shadowRoot?.querySelector("button.primary") ??
      null) as HTMLButtonElement | null;
    expect(playButton).not.toBeNull();

    playButton?.click();

    expect((lmsConnection as any).togglePause).not.toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalledTimes(2);
  });

  it("reports track started once when audio fires playing for a stream", async () => {
    const element = document.createElement("player-controls");
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const emit = (lmsConnection as any).__emit as (state: any) => void;

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=31",
      volume: 50,
    });

    const audio = element.shadowRoot?.querySelector("audio") as
      | HTMLAudioElement
      | undefined;
    expect(audio).toBeDefined();

    audio?.dispatchEvent(new Event("playing"));
    audio?.dispatchEvent(new Event("playing"));

    expect((lmsConnection as any).trackStarted).toHaveBeenCalledTimes(1);
  });

  it("reports track started again for the next stream revision", async () => {
    const element = document.createElement("player-controls");
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const emit = (lmsConnection as any).__emit as (state: any) => void;
    const audio = element.shadowRoot?.querySelector("audio") as
      | HTMLAudioElement
      | undefined;

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=41",
      volume: 50,
    });
    audio?.dispatchEvent(new Event("playing"));

    emit({
      status: "connected",
      playbackStatus: "playing",
      streamUrl: "/api/stream?token=t&rev=42",
      volume: 50,
    });
    audio?.dispatchEvent(new Event("playing"));

    expect((lmsConnection as any).trackStarted).toHaveBeenCalledTimes(2);
  });
});
