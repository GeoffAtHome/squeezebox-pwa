import { afterEach, describe, expect, it, vi } from "vitest";

import { CONNECTION_STATUS_VALUES } from "@utils/types";

const loadSubject = async (options?: {
  storedConfig?: {
    serverUrl: string;
    username?: string;
    playerName?: string;
  } | null;
  storageData?: Record<string, unknown>;
  sessionPassword?: string;
  browseCacheData?: Record<
    string,
    {
      staleMarker: number;
      entries: Record<string, unknown>;
    }
  >;
}) => {
  vi.resetModules();

  const storageMap = new Map<string, unknown>(
    Object.entries(options?.storageData ?? {}),
  );

  const storageSet = vi.fn((key: string, value: unknown) => {
    storageMap.set(key, value);
  });
  const storageGet = vi.fn((key: string, defaultValue?: unknown) => {
    return storageMap.has(key) ? storageMap.get(key) : defaultValue;
  });
  const storageRemove = vi.fn((key: string) => {
    storageMap.delete(key);
  });

  const saveServerConfig = vi.fn();
  const getServerConfig = vi
    .fn()
    .mockReturnValue(options?.storedConfig ?? null);
  const getSessionPassword = vi.fn().mockReturnValue(options?.sessionPassword);

  const mockRegisterPlayer = vi.fn().mockResolvedValue({
    token: "test-token",
    mac: "02:00:00:aa:bb:cc",
    playerName: "Test Player",
  });
  const mockOpenEventStream = vi.fn().mockReturnValue(() => {});
  const mockPlayerCommand = vi.fn().mockResolvedValue(undefined);
  const mockBrowse = vi.fn().mockResolvedValue({ item_loop: [] });
  const mockTrackDone = vi.fn().mockResolvedValue(undefined);
  const mockTrackStarted = vi.fn().mockResolvedValue(undefined);
  const browseCacheData = new Map(
    Object.entries(options?.browseCacheData ?? {}),
  );
  const mockBrowseCacheLoadContext = vi.fn(
    async (context: string, staleMarker: number) => {
      const record = browseCacheData.get(context);
      if (!record || record.staleMarker !== staleMarker) {
        return {};
      }

      return record.entries;
    },
  );
  const mockBrowseCachePutEntry = vi.fn(
    async (
      context: string,
      staleMarker: number,
      queryKey: string,
      result: unknown,
    ) => {
      const existing = browseCacheData.get(context);
      const entries = { ...(existing?.entries ?? {}), [queryKey]: result };
      browseCacheData.set(context, { staleMarker, entries });
    },
  );
  const mockBrowseCacheDeleteContext = vi.fn(async (context: string) => {
    browseCacheData.delete(context);
  });

  vi.doMock("@services/bridge-client", () => ({
    bridgeClient: {
      registerPlayer: mockRegisterPlayer,
      openEventStream: mockOpenEventStream,
      playerCommand: mockPlayerCommand,
      browse: mockBrowse,
      trackDone: mockTrackDone,
      trackStarted: mockTrackStarted,
    },
  }));

  vi.doMock("./storage", () => ({
    storage: {
      set: storageSet,
      get: storageGet,
      remove: storageRemove,
      saveServerConfig,
      getServerConfig,
      getSessionPassword,
    },
  }));

  vi.doMock("./browse-cache-store", () => ({
    browseCacheStore: {
      loadContext: mockBrowseCacheLoadContext,
      putEntry: mockBrowseCachePutEntry,
      deleteContext: mockBrowseCacheDeleteContext,
    },
  }));

  const subject = await import("./lms-connection");

  return {
    ...subject,
    mockRegisterPlayer,
    mockOpenEventStream,
    mockPlayerCommand,
    mockBrowse,
    mockTrackDone,
    mockTrackStarted,
    saveServerConfig,
    getServerConfig,
    storageSet,
    storageGet,
    storageRemove,
    storageMap,
    mockBrowseCacheLoadContext,
    mockBrowseCachePutEntry,
    mockBrowseCacheDeleteContext,
    browseCacheData,
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
      false,
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

  it("surfaces bridge network errors from register (e.g. bad LMS URL host)", async () => {
    const { lmsConnection, mockRegisterPlayer } = await loadSubject();

    mockRegisterPlayer.mockRejectedValueOnce(
      new Error("connect ENETUNREACH 0.0.0.199:3483"),
    );

    await expect(
      lmsConnection.connect("http://0.0.0.199:9000", "SlimpMP3", "hiwiccp"),
    ).rejects.toThrow("connect ENETUNREACH 0.0.0.199:3483");

    expect(lmsConnection.getState()).toEqual(
      expect.objectContaining({
        status: CONNECTION_STATUS_VALUES.ERROR,
        error: "connect ENETUNREACH 0.0.0.199:3483",
      }),
    );
  });

  it("persists rememberPassword preference when connect opts in", async () => {
    const { lmsConnection, saveServerConfig } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
      true,
    );

    expect(saveServerConfig).toHaveBeenCalledWith(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
      true,
    );
  });

  it("surfaces auth failures when register returns LMS 401", async () => {
    const { lmsConnection, mockRegisterPlayer } = await loadSubject();

    mockRegisterPlayer.mockRejectedValueOnce(
      new Error("LMS JSON-RPC failed with status 401"),
    );

    await expect(
      lmsConnection.connect("http://localhost:9000", "SlimpMP3", "wrong"),
    ).rejects.toThrow("LMS JSON-RPC failed with status 401");

    expect(lmsConnection.getState()).toEqual(
      expect.objectContaining({
        status: CONNECTION_STATUS_VALUES.ERROR,
        error: "LMS JSON-RPC failed with status 401",
      }),
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
      sessionPassword: "hiwiccp",
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

  it("returns false from restoreConnection when username exists but session password is missing", async () => {
    const storedConfig = {
      serverUrl: "http://localhost:9000",
      username: "SlimpMP3",
      playerName: "Saved Player",
    };
    const { lmsConnection, mockRegisterPlayer } = await loadSubject({
      storedConfig,
      sessionPassword: undefined,
    });

    const result = await lmsConnection.restoreConnection();

    expect(result).toBe(false);
    expect(mockRegisterPlayer).not.toHaveBeenCalled();
  });

  it("browses library using active session credentials", async () => {
    const { lmsConnection, mockBrowse } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    await lmsConnection.browseMenu({ itemId: "myapps", quantity: 50 });

    expect(mockBrowse).toHaveBeenCalledWith(
      {
        serverUrl: "http://localhost:9000",
        username: "SlimpMP3",
        password: "hiwiccp",
        playerName: "My Player",
        token: "test-token",
        playerId: "02:00:00:aa:bb:cc",
      },
      {
        itemId: "myapps",
        start: 0,
        quantity: 50,
        search: undefined,
      },
    );
  });

  it("uses cached browse results for repeated identical queries", async () => {
    const { lmsConnection, mockBrowse } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    await lmsConnection.browseMenu({ itemId: "myapps", quantity: 50 });
    await lmsConnection.browseMenu({ itemId: "myapps", quantity: 50 });

    expect(mockBrowse).toHaveBeenCalledTimes(1);
  });

  it("fetches again after marking browse cache as stale", async () => {
    const { lmsConnection, mockBrowse } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    await lmsConnection.browseMenu({ itemId: "myapps", quantity: 50 });
    lmsConnection.markBrowseCacheStale();
    await lmsConnection.browseMenu({ itemId: "myapps", quantity: 50 });

    expect(mockBrowse).toHaveBeenCalledTimes(2);
  });

  it("hydrates browse cache from storage after reconnect", async () => {
    const playerId = "02:00:00:aa:bb:cc";
    const cacheContext = `http://localhost:9000::${playerId}`;
    const cachedResult = {
      item_loop: [{ id: "myapps", text: "My Apps" }],
    };

    const { lmsConnection, mockBrowse } = await loadSubject({
      storageData: {
        browseCacheStaleMarker: 0,
      },
      browseCacheData: {
        [cacheContext]: {
          staleMarker: 0,
          entries: {
            '{"itemId":"myapps","start":0,"quantity":50}': cachedResult,
          },
        },
      },
    });

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    const result = await lmsConnection.browseMenu({
      itemId: "myapps",
      quantity: 50,
    });

    expect(result).toEqual(cachedResult);
    expect(mockBrowse).not.toHaveBeenCalled();
  });

  it("warms browse cache in the background in artists, albums, tracks, playlists order", async () => {
    const { lmsConnection, mockBrowse } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    await lmsConnection.warmBrowseCacheInBackground();

    expect(mockBrowse.mock.calls.map(([, query]) => query.itemId)).toEqual([
      "section:artists",
      "section:albums",
      "section:tracks",
      "section:playlists",
    ]);
  });

  it("warms additional browse pages until a section is fully cached", async () => {
    const { lmsConnection, mockBrowse } = await loadSubject();

    mockBrowse
      .mockResolvedValueOnce({
        item_loop: Array.from({ length: 100 }, (_, index) => ({
          id: `artist:${index + 1}`,
          text: `Artist ${index + 1}`,
        })),
        count: 150,
      })
      .mockResolvedValueOnce({
        item_loop: Array.from({ length: 50 }, (_, index) => ({
          id: `artist:${index + 101}`,
          text: `Artist ${index + 101}`,
        })),
        count: 150,
      })
      .mockResolvedValue({ item_loop: [], count: 0 });

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    await lmsConnection.warmBrowseCacheInBackground();

    expect(mockBrowse).toHaveBeenCalledTimes(5);

    expect(mockBrowse.mock.calls[0]?.[1]).toEqual({
      itemId: "section:artists",
      start: 0,
      quantity: 100,
      search: undefined,
    });
    expect(mockBrowse.mock.calls[1]?.[1]).toEqual({
      itemId: "section:artists",
      start: 100,
      quantity: 100,
      search: undefined,
    });
  });

  it("plays browse item via playlistcontrol load command", async () => {
    const { lmsConnection, mockPlayerCommand } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    await lmsConnection.playBrowseItem("track:123");

    expect(mockPlayerCommand).toHaveBeenCalledWith(
      {
        serverUrl: "http://localhost:9000",
        username: "SlimpMP3",
        password: "hiwiccp",
        playerName: "My Player",
        token: "test-token",
        playerId: "02:00:00:aa:bb:cc",
      },
      "playlistcontrol",
      ["cmd:load", "track_id:123"],
    );
  });

  it("queues browse item next via playlistcontrol insert command", async () => {
    const { lmsConnection, mockPlayerCommand } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    await lmsConnection.addNextBrowseItem("track:456");

    expect(mockPlayerCommand).toHaveBeenCalledWith(
      {
        serverUrl: "http://localhost:9000",
        username: "SlimpMP3",
        password: "hiwiccp",
        playerName: "My Player",
        token: "test-token",
        playerId: "02:00:00:aa:bb:cc",
      },
      "playlistcontrol",
      ["cmd:insert", "track_id:456"],
    );
  });

  it("queues browse item at end via playlistcontrol add command", async () => {
    const { lmsConnection, mockPlayerCommand } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    await lmsConnection.addToEndBrowseItem("track:789");

    expect(mockPlayerCommand).toHaveBeenCalledWith(
      {
        serverUrl: "http://localhost:9000",
        username: "SlimpMP3",
        password: "hiwiccp",
        playerName: "My Player",
        token: "test-token",
        playerId: "02:00:00:aa:bb:cc",
      },
      "playlistcontrol",
      ["cmd:add", "track_id:789"],
    );
  });

  it("sets auth error state when LMS command returns 401", async () => {
    const { lmsConnection, mockPlayerCommand } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "bad-password",
      "My Player",
    );

    mockPlayerCommand.mockRejectedValueOnce(
      new Error("LMS JSON-RPC failed with status 401"),
    );

    lmsConnection.play();
    await Promise.resolve();

    expect(lmsConnection.getState()).toEqual(
      expect.objectContaining({
        status: CONNECTION_STATUS_VALUES.ERROR,
        error:
          "LMS authentication failed (401). Reconnect and enter valid LMS credentials.",
      }),
    );
  });

  it("keeps the current stream URL when a stop event arrives before the next stream", async () => {
    const { lmsConnection, mockOpenEventStream } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    const onEvent = mockOpenEventStream.mock.calls[0]?.[1] as
      | ((event: { type: string; url?: string; mimeType?: string }) => void)
      | undefined;

    expect(onEvent).toBeTypeOf("function");

    onEvent?.({
      type: "stream",
      url: "http://localhost:5174/api/stream?token=test-token&rev=1",
      mimeType: "audio/mpeg",
    });

    onEvent?.({ type: "stop" });

    expect(lmsConnection.getState()).toEqual(
      expect.objectContaining({
        streamUrl: "http://localhost:5174/api/stream?token=test-token&rev=1",
        playbackStatus: "stopped",
      }),
    );
  });

  it("forwards trackStarted to bridge with elapsed seconds", async () => {
    const { lmsConnection, mockTrackStarted } = await loadSubject();

    await lmsConnection.connect(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "My Player",
    );

    lmsConnection.trackStarted(12.345);
    await Promise.resolve();

    expect(mockTrackStarted).toHaveBeenCalledWith("test-token", 12.345);
  });
});
