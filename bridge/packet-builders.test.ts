// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildHelo,
  buildStat,
  macToBytes,
  playerNameToMac,
} from "./packet-builders.ts";

describe("playerNameToMac", () => {
  it("returns a valid 6-byte colon-separated MAC", () => {
    const mac = playerNameToMac("Squeezebox PWA");
    expect(mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
  });

  it("always sets the first byte to 02 (locally administered)", () => {
    expect(playerNameToMac("Player A").startsWith("02:")).toBe(true);
    expect(playerNameToMac("Player B").startsWith("02:")).toBe(true);
  });

  it("produces the same MAC for the same player name", () => {
    expect(playerNameToMac("My Player")).toBe(playerNameToMac("My Player"));
  });

  it("produces different MACs for different player names", () => {
    expect(playerNameToMac("Player A")).not.toBe(playerNameToMac("Player B"));
  });
});

describe("buildHelo", () => {
  it("starts with HELO command header", () => {
    const mac = macToBytes(playerNameToMac("Test"));
    const buf = buildHelo(mac, "Test");
    expect(buf.toString("ascii", 0, 4)).toBe("HELO");
  });

  it("stores the MAC at bytes 10–15", () => {
    const mac = playerNameToMac("Test Player");
    const macBuf = macToBytes(mac);
    const buf = buildHelo(macBuf, "Test Player");
    expect(buf.subarray(10, 16).toString("hex")).toBe(macBuf.toString("hex"));
  });

  it("includes player name in capabilities", () => {
    const mac = macToBytes(playerNameToMac("My Box"));
    const buf = buildHelo(mac, "My Box");
    expect(buf.toString("ascii").includes("ModelName=My Box")).toBe(true);
  });
});

describe("buildStat", () => {
  it("starts with STAT command header", () => {
    const buf = buildStat("STMt");
    expect(buf.toString("ascii", 0, 4)).toBe("STAT");
  });

  it("is always 61 bytes (8 header + 53 data)", () => {
    expect(buildStat("STMt").length).toBe(61);
    expect(buildStat("STMc", 5000).length).toBe(61);
  });

  it("writes the event code at bytes 8–11", () => {
    expect(buildStat("STMt").toString("ascii", 8, 12)).toBe("STMt");
    expect(buildStat("STMc").toString("ascii", 8, 12)).toBe("STMc");
    expect(buildStat("STMp").toString("ascii", 8, 12)).toBe("STMp");
  });

  it("does not throw for a large (near-overflow) jiffies value — regression for ERR_OUT_OF_RANGE", () => {
    // Date.now() for a far-future timestamp that would have overflowed the old code
    // 2^32 - 1 = 4294967295, values above this were crashing writeUInt32BE
    const farFuture = 0x1_0000_0000 + 1; // 4294967297 — beyond u32 max
    vi.spyOn(Date, "now").mockReturnValue(farFuture);
    expect(() => buildStat("STMt")).not.toThrow();
    vi.restoreAllMocks();
  });

  it("writes elapsed_seconds at bytes 45–48", () => {
    const buf = buildStat("STMt", 7000); // 7 seconds
    expect(buf.readUInt32BE(45)).toBe(7);
  });

  it("writes elapsed_ms at bytes 51–54", () => {
    const buf = buildStat("STMt", 7500);
    expect(buf.readUInt32BE(51)).toBe(7500);
  });

  it("clamps negative elapsedMs to zero without throwing", () => {
    expect(() => buildStat("STMt", -1)).not.toThrow();
    const buf = buildStat("STMt", -1);
    expect(buf.readUInt32BE(45)).toBe(0);
    expect(buf.readUInt32BE(51)).toBe(0);
  });
});
