import { createHash } from "node:crypto";

// ── MAC helpers ───────────────────────────────────────────────────────────────

export const playerNameToMac = (playerName: string): string => {
  const hash = createHash("md5").update(playerName).digest();
  return [0x02, hash[0], hash[1], hash[2], hash[3], hash[4]]
    .map((b) => (b & 0xff).toString(16).padStart(2, "0"))
    .join(":");
};

export const macToBytes = (mac: string): Buffer =>
  Buffer.from(mac.split(":").map((h) => parseInt(h, 16)));

// ── SlimProto packet builders ─────────────────────────────────────────────────

/**
 * HELO packet: registers the player with LMS.
 * Fixed data = 36 bytes + optional capabilities string.
 * Offsets (command header starts at 0):
 *   [0..3]  "HELO"
 *   [4..7]  data length (big-endian u32)
 *   [8]     DeviceID = 12 (squeezeplay)
 *   [9]     Revision = 0
 *   [10..15] MAC (6 bytes)
 *   [16..31] UUID (16 bytes, zeros)
 *   [32..33] WLanChannelList (2 bytes)
 *   [34..41] Bytes received (8 bytes, zeros)
 *   [42..43] Language ("en")
 *   [44..]  Capabilities (ASCII comma-separated)
 */
export const buildHelo = (macBuf: Buffer, playerName: string): Buffer => {
  const capabilities = [
    "Model=squeezeplayer",
    `ModelName=${playerName.replace(/[,\r\n]/g, " ").slice(0, 32)}`,
    "AccuratePlayPoints",
    "mp3",
    "ogg",
    "flc",
    "aac",
  ].join(",");

  const capBuf = Buffer.from(capabilities, "ascii");
  const dataLen = 36 + capBuf.length;
  const buf = Buffer.alloc(8 + dataLen, 0);

  buf.write("HELO", 0, "ascii");
  buf.writeUInt32BE(dataLen, 4);
  buf[8] = 12; // DeviceID = squeezeplay
  buf[9] = 0; // Revision
  macBuf.copy(buf, 10); // MAC [10..15]
  // UUID [16..31] = zeros
  buf.writeUInt16BE(0, 32); // WLanChannelList
  // Bytes received [34..41] = zeros
  buf.write("en", 42, "ascii"); // Language
  capBuf.copy(buf, 44); // Capabilities

  return buf;
};

/**
 * STAT packet: heartbeat / playback event notification.
 * Data = 53 bytes.
 * Offsets within the 61-byte buffer (8-byte header + 53-byte data):
 *   [8..11]  event code (4 chars, e.g. "STMt")
 *   [12]     num_crlf
 *   [13]     mas_initialized
 *   [14]     mas_mode
 *   [15..18] buffer_size
 *   [19..22] fullness
 *   [23..30] bytes_received (u64)
 *   [31..32] signal_strength
 *   [33..36] jiffies
 *   [37..40] output_buffer_size
 *   [41..44] output_buffer_fullness
 *   [45..48] elapsed_seconds
 *   [49..50] voltage
 *   [51..54] elapsed_ms
 *   [55..58] server_timestamp
 *   [59..60] error_code
 */
export const buildStat = (eventCode: string, elapsedMs = 0): Buffer => {
  const DATA_LEN = 53;
  const buf = Buffer.alloc(8 + DATA_LEN, 0);
  // >>> 0 coerces to unsigned 32-bit integer, preventing out-of-range crashes
  const jiffies = Date.now() >>> 0;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000)) >>> 0;
  const elapsedMilliseconds = Math.max(0, Math.floor(elapsedMs)) >>> 0;

  buf.write("STAT", 0, "ascii");
  buf.writeUInt32BE(DATA_LEN, 4);
  buf.write(eventCode.padEnd(4, " ").slice(0, 4), 8, "ascii");
  buf.writeUInt16BE(100, 31); // signal_strength = 100 (wired)
  buf.writeUInt32BE(jiffies, 33); // jiffies
  buf.writeUInt32BE(elapsedSeconds, 45); // elapsed_seconds
  buf.writeUInt32BE(elapsedMilliseconds, 51); // elapsed_ms

  return buf;
};
