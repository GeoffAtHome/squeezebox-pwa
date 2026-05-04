/**
 * SlimProto/SlimP3 protocol implementation
 * Handles connection and message parsing for LMS server
 */

import { SLIMPROTO_COMMANDS, PROTOCOL_DEFAULTS } from "./constants";
import type { SlimProtoCommand, ButtonCommand, ServerUrl } from "./types";

export interface ProtocolMessage {
  command: SlimProtoCommand;
  data: Record<string, any>;
}

export interface ConnectionConfig {
  serverUrl: ServerUrl;
  username?: string;
  password?: string;
  playerId?: string;
}

/**
 * Protocol handler for communicating with LMS server
 */
export class SlimProtocolHandler {
  private socket: WebSocket | null = null;
  private config: ConnectionConfig;
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(config: ConnectionConfig) {
    this.config = config;
  }

  /**
   * Connect to LMS server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.buildWebSocketUrl();
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          console.log("Connected to LMS server");
          this.sendHello();
          resolve();
        };

        this.socket.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.socket.onerror = (error) => {
          console.error("WebSocket error:", error);
          reject(new Error("Failed to connect to LMS server"));
        };

        this.socket.onclose = () => {
          console.log("Disconnected from LMS server");
        };

        // Set connection timeout
        setTimeout(() => {
          if (this.socket?.readyState !== WebSocket.OPEN) {
            reject(new Error("Connection timeout"));
          }
        }, PROTOCOL_DEFAULTS.TIMEOUT);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from LMS server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  /**
   * Send HELLO message to initiate protocol handshake
   */
  private sendHello(): void {
    // SlimProto HELLO command format
    const message = `${SLIMPROTO_COMMANDS.HELLO as string}\n`;
    this.send(message);
  }

  /**
   * Send a message to the server
   */
  private send(message: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(message);
    }
  }

  /**
   * Handle incoming message from server
   */
  private handleMessage(rawData: string): void {
    try {
      const lines = rawData.split("\n").filter((l) => l);
      lines.forEach((line) => {
        const parts = line.split(/\s+/);
        const command = parts[0];
        const handler = this.messageHandlers.get(command);
        if (handler) {
          handler(parts.slice(1));
        }
      });
    } catch (error) {
      console.error("Failed to parse message:", error);
    }
  }

  /**
   * Register a handler for a specific command
   */
  onCommand(command: SlimProtoCommand, handler: (data: any) => void): void {
    this.messageHandlers.set(command as string, handler);
  }

  /**
   * Build WebSocket URL from server configuration
   */
  private buildWebSocketUrl(): string {
    let url = this.config.serverUrl.trim();

    // Remove protocol if present
    url = url.replace(/^https?:\/\//, "");

    // Ensure protocol
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    return `${protocol}//${url}:${PROTOCOL_DEFAULTS.PORT}`;
  }

  /**
   * Send play command
   */
  sendPlay(): void {
    this.send("MPLAY\n");
  }

  /**
   * Send pause command
   */
  sendPause(): void {
    this.send("MPAUSE\n");
  }

  /**
   * Send button press (e.g., next, previous)
   */
  sendButton(button: ButtonCommand): void {
    this.send(`BUTTON ${button as string}\n`);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}
