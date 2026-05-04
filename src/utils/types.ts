/**
 * Branded TypeScript types
 * Provides type-safe alternatives to plain strings
 */

// Branding utility
declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

// ============================================================================
// SlimProto Command Types
// ============================================================================

export type SlimProtoCommand = Brand<string, "SlimProtoCommand">;

export type SlimProtoCommandType =
  | "HELLO"
  | "STAT"
  | "BUTTON"
  | "DISPLAY"
  | "IR"
  | "JIFFIES"
  | "MOUSE"
  | "MPAUSE"
  | "MPLAY"
  | "MRATE"
  | "SETMETA"
  | "SLAC"
  | "SLSC"
  | "DONT_USE_REPLAY_GAIN";

const createSlimProtoCommand = (cmd: SlimProtoCommandType): SlimProtoCommand =>
  cmd as SlimProtoCommand;

export const SLIMPROTO_COMMAND_VALUES = {
  HELLO: createSlimProtoCommand("HELLO"),
  STAT: createSlimProtoCommand("STAT"),
  BUTTON: createSlimProtoCommand("BUTTON"),
  DISPLAY: createSlimProtoCommand("DISPLAY"),
  IR: createSlimProtoCommand("IR"),
  JIFFIES: createSlimProtoCommand("JIFFIES"),
  MOUSE: createSlimProtoCommand("MOUSE"),
  MPAUSE: createSlimProtoCommand("MPAUSE"),
  MPLAY: createSlimProtoCommand("MPLAY"),
  MRATE: createSlimProtoCommand("MRATE"),
  SETMETA: createSlimProtoCommand("SETMETA"),
  SLAC: createSlimProtoCommand("SLAC"),
  SLSC: createSlimProtoCommand("SLSC"),
  DONT_USE_REPLAY_GAIN: createSlimProtoCommand("DONT_USE_REPLAY_GAIN"),
} as const;

// ============================================================================
// Button Types
// ============================================================================

export type ButtonCommand = Brand<string, "ButtonCommand">;

export type ButtonCommandType =
  | "prev"
  | "next"
  | "play"
  | "pause"
  | "stop"
  | "fwd"
  | "rew";

const createButtonCommand = (btn: ButtonCommandType): ButtonCommand =>
  btn as ButtonCommand;

export const BUTTON_COMMAND_VALUES = {
  PREV: createButtonCommand("prev"),
  NEXT: createButtonCommand("next"),
  PLAY: createButtonCommand("play"),
  PAUSE: createButtonCommand("pause"),
  STOP: createButtonCommand("stop"),
  FWD: createButtonCommand("fwd"),
  REW: createButtonCommand("rew"),
} as const;

// ============================================================================
// Connection Status Types
// ============================================================================

export type ConnectionStatus = Brand<string, "ConnectionStatus">;

export type ConnectionStatusType =
  | "idle"
  | "connecting"
  | "connected"
  | "error";

const createConnectionStatus = (
  status: ConnectionStatusType,
): ConnectionStatus => status as ConnectionStatus;

export const CONNECTION_STATUS_VALUES = {
  IDLE: createConnectionStatus("idle"),
  CONNECTING: createConnectionStatus("connecting"),
  CONNECTED: createConnectionStatus("connected"),
  ERROR: createConnectionStatus("error"),
} as const;

// ============================================================================
// Player Status Types
// ============================================================================

export type PlayerStatusCode = Brand<number, "PlayerStatusCode">;

export const PLAYER_STATUS_VALUES = {
  STOPPED: 0 as PlayerStatusCode,
  PLAYING: 1 as PlayerStatusCode,
  PAUSED: 2 as PlayerStatusCode,
} as const;

// ============================================================================
// Server URL Type
// ============================================================================

export type ServerUrl = Brand<string, "ServerUrl">;

const createServerUrl = (url: string): ServerUrl => url as ServerUrl;

export const makeServerUrl = (url: string): ServerUrl => {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Server URL cannot be empty");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error("Invalid server URL");
  }

  if (!parsedUrl.hostname || !/^https?:$/.test(parsedUrl.protocol)) {
    throw new Error("Invalid server URL");
  }

  return createServerUrl(trimmed);
};

// ============================================================================
// Username Type
// ============================================================================

export type Username = Brand<string, "Username">;

export const makeUsername = (username: string): Username | undefined => {
  const trimmed = username.trim();
  return trimmed ? (trimmed as Username) : undefined;
};

// ============================================================================
// Volume Type
// ============================================================================

export type Volume = Brand<number, "Volume">;

export const makeVolume = (volume: number): Volume => {
  const clamped = Math.max(0, Math.min(100, volume));
  return clamped as Volume;
};

// ============================================================================
// Track Duration Type
// ============================================================================

export type TrackDuration = Brand<number, "TrackDuration">;

export const makeTrackDuration = (duration: number): TrackDuration => {
  return Math.max(0, duration) as TrackDuration;
};

// ============================================================================
// Track Position Type
// ============================================================================

export type TrackPosition = Brand<number, "TrackPosition">;

export const makeTrackPosition = (position: number): TrackPosition => {
  return Math.max(0, position) as TrackPosition;
};
