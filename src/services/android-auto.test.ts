import { describe, expect, it } from "vitest";
import {
  buildAndroidAutoMediaSessionPayload,
  normalizeAndroidAutoAction,
} from "./android-auto";

describe("android-auto media session helpers", () => {
  it("builds a payload with playback metadata", () => {
    const payload = buildAndroidAutoMediaSessionPayload({
      playbackStatus: "playing",
      title: "Song",
      artist: "Artist",
      album: "Album",
      duration: 240,
      elapsed: 80,
      artworkUrl: "https://example.com/art.png",
    });

    expect(payload.isPlaying).toBe(true);
    expect(payload.title).toBe("Song");
    expect(payload.artist).toBe("Artist");
    expect(payload.duration).toBe(240);
    expect(payload.position).toBe(80);
    expect(payload.artworkUrl).toBe("https://example.com/art.png");
  });

  it("normalizes supported actions and ignores unsupported ones", () => {
    expect(normalizeAndroidAutoAction("play")).toBe("play");
    expect(normalizeAndroidAutoAction("pause")).toBe("pause");
    expect(normalizeAndroidAutoAction("next")).toBe("next");
    expect(normalizeAndroidAutoAction("previous")).toBe("previous");
    expect(normalizeAndroidAutoAction("shuffle")).toBeUndefined();
  });
});
