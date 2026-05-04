import { afterEach, describe, expect, it, vi } from "vitest";

import { CONNECTION_STATUS_VALUES } from "@utils/types";

const loadSubject = async (options?: {
  storedConfig?: {
    serverUrl: string;
    username?: string;
    playerName?: string;
  } | null;
}) => {
  vi.resetModules();

  const saveServerConfig = vi.fn();
  const getServerConfig = vi
    .fn()
    .mockReturnValue(options?.storedConfig ?? null);

  const mockRegisterPlayer = vi.fn().mockResolvedValue({
    token: "test-token",
    mac: "02:00:00:aa:bb:cc",
    playerName: "Test Player",
  });
  const mockOpenEventStream = vi.fn().mockReturnValue(() => {});
  const mockPlayerCommand = vi.fn().mockResolvedValue(undefined);

  vi.doMock("@services/bridge-client", () => ({
    bridgeClient: {
      registerPlayer: mockRegisterPlayer,
      openEventStream: mockOpenEventStream,
      playerCommand: mockPlayerCommand,
    },
  }));

  vi.doMock("./storage", () => ({
    storage: {
      saveServerConfig,
      getServerConfig,
    },
  }));

  const subject = await import("./lms-connection");

  return {
    ...subject,
    mockRegisterPlayer,
    mockOpenEventStream,
    mockPlayerCommand,
    saveServerConfig,
    getServerConfig,
  };
};

describe("lmsConnection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("connects with a trimmed URL and persists the server config", async () => {
    const {
      lmsConnection,
      mockRegisterPlayer,
      mockOpenEventStream,
      saveServerConfig,
    } = await loadSubject();

    await lmsConnection.connect(
      "  http://localhost:9000  ",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    expect(mockRegisterPlayer).toHaveBeenCalledOnce();
    expect(mockRegisterPlayer).toHaveBeenCalledWith({
      serverUrl: "http://localhost:9000",
      username: "SlimpMP3",
      password: "hiwiccp",
      playerName: "My Player",
    });
    expect(mockOpenEventStream).toHaveBeenCalledWith(
      "test-token",
      expect.any(Function),
    );
    expect(saveServerConfig).toHaveBeenCalledWith(
      "  http://localhost:9000  ",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );
    expect(lmsConnection.getState()).toEqual(
      expect.objectContaining({
        status: CONNECTION_STATUS_VALUES.CONNECTED,
        serverUrl: "http://localhost:9000",
        playerId: "02:00:00:aa:bb:cc",
      }),
    );
  });

  it("rejects a malformed URL before attempting a transport connection", async () => {
    const { lmsConnection, mockRegisterPlayer } = await loadSubject();

    await expect(
      lmsConnection.connect("not-a-url", "SlimpMP3", "hiwiccp"),
    ).rejects.toThrow("Invalid server URL");

    expect(mockRegisterPlayer).not.toHaveBeenCalled();
    expect(lmsConnection.getState().status).toBe(
      CONNECTION_STATUS_VALUES.ERROR,
    );
  });

  it("restores connection from storage", async () => {
    const storedConfig = {
      serverUrl: "http://localhost:9000",
      username: "SlimpMP3",
      playerName: "Saved Player",
    };
    const { lmsConnection, mockRegisterPlayer } = await loadSubject({
      storedConfig,
    });

    const result = await lmsConnection.restoreConnection();

    expect(result).toBe(true);
    expect(mockRegisterPlayer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: "http://localhost:9000",
        username: "SlimpMP3",
        playerName: "Saved Player",
      }),
    );
  });

  it("returns false from restoreConnection when no stored config", async () => {
    const { lmsConnection, mockRegisterPlayer } = await loadSubject({
      storedConfig: null,
    });

    const result = await lmsConnection.restoreConnection();

    expect(result).toBe(false);
    expect(mockRegisterPlayer).not.toHaveBeenCalled();
  });
});
