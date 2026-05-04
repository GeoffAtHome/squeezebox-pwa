/**
 * Protocol constants and utilities
 * Handles SlimProto/SlimP3 protocol specifics
 */

import { SLIMPROTO_COMMAND_VALUES, PLAYER_STATUS_VALUES } from "./types";

// Re-export branded command types
export const SLIMPROTO_COMMANDS = SLIMPROTO_COMMAND_VALUES;

// Re-export branded player status values
export const PLAYER_STATUS = PLAYER_STATUS_VALUES;

// SlimProto protocol defaults
export const PROTOCOL_DEFAULTS = {
  PORT: 3483,
  TIMEOUT: 5000,
  BUFFER_SIZE: 65536,
} as const;
