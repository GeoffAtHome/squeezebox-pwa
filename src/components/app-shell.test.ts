import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { html } from "lit";
import { render, getByShadow, setupTestCleanup } from "../../test/test-harness";

import { lmsConnection } from "@services/lms-connection";
import "./app-shell";

setupTestCleanup();

describe("app-shell", () => {
  let connectionStateListener:
    | ((state: ReturnType<typeof lmsConnection.getState>) => void)
    | undefined;

  beforeEach(() => {
    vi.spyOn(lmsConnection, "getState").mockReturnValue({
      status: "idle",
    });

    vi.spyOn(lmsConnection, "restoreConnection").mockResolvedValue(false);
    vi.spyOn(lmsConnection, "warmBrowseCacheInBackground").mockResolvedValue(
      undefined,
    );

    vi.spyOn(lmsConnection, "onStateChange").mockImplementation((listener) => {
      connectionStateListener = listener;
      return () => {
        connectionStateListener = undefined;
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the connection dialog by default", async () => {
    const el = await render<HTMLElement>(html`<app-shell></app-shell>`);

    const dialog = getByShadow(el, "connection-dialog");
    expect(dialog).toBeInstanceOf(HTMLElement);

    expect(el.shadowRoot?.textContent).toContain("Not connected");
    expect(el.shadowRoot?.querySelector("player-controls")).toBeNull();
  });

  it("shows player-controls after successful connection", async () => {
    vi.spyOn(lmsConnection, "connect").mockImplementation(async () => {
      connectionStateListener?.({
        status: "connected",
        serverUrl: "http://localhost:9000",
        playerId: "02:ab:cd:ef:01:23",
      });
    });

    const el = await render<HTMLElement>(html`<app-shell></app-shell>`);

    const dialog = getByShadow(el, "connection-dialog");

    dialog.dispatchEvent(
      new CustomEvent("connect", {
        detail: {
          serverUrl: "http://localhost:9000",
          username: "SlimpMP3",
          password: "hiwiccp",
          playerName: "My Squeezebox",
        },
        bubbles: true,
        composed: true,
      }),
    );

    await (el as any).updateComplete;

    expect(el.shadowRoot?.querySelector("connection-dialog")).toBeNull();
    expect(getByShadow(el, "player-controls")).toBeInstanceOf(HTMLElement);
    expect(el.shadowRoot?.textContent).toContain("Connected");
  });

  it("shows an error banner and keeps the dialog visible after a failed connection", async () => {
    const connectSpy = vi
      .spyOn(lmsConnection, "connect")
      .mockImplementation(async () => {
        connectionStateListener?.({
          status: "error",
          error: "Authentication failed",
          serverUrl: "http://localhost:9000",
        });
        throw new Error("Authentication failed");
      });

    vi.spyOn(console, "error").mockImplementation(() => {});

    const el = await render<HTMLElement>(html`<app-shell></app-shell>`);

    const dialog = getByShadow(el, "connection-dialog");

    dialog.dispatchEvent(
      new CustomEvent("connect", {
        detail: {
          serverUrl: "http://localhost:9000",
          username: "wrong-user",
          password: "wrong-pass",
          playerName: "Squeezebox PWA",
        },
        bubbles: true,
        composed: true,
      }),
    );

    await (el as any).updateComplete;

    expect(connectSpy).toHaveBeenCalled();
    expect(getByShadow(el, "connection-dialog")).toBeInstanceOf(HTMLElement);
    expect(el.shadowRoot?.querySelector("player-controls")).toBeNull();
    expect(el.shadowRoot?.textContent).toContain("Error: Authentication failed");
  });

  it("passes rememberPassword through connect event", async () => {
    const connectSpy = vi.spyOn(lmsConnection, "connect").mockResolvedValue();

    const el = await render<HTMLElement>(html`<app-shell></app-shell>`);

    const dialog = getByShadow(el, "connection-dialog");

    dialog.dispatchEvent(
      new CustomEvent("connect", {
        detail: {
          serverUrl: "http://localhost:9000",
          username: "SlimpMP3",
          password: "hiwiccp",
          playerName: "Squeezebox PWA",
          rememberPassword: true,
        },
        bubbles: true,
        composed: true,
      }),
    );

    await (el as any).updateComplete;

    expect(connectSpy).toHaveBeenCalledWith(
      "http://localhost:9000",
      "SlimpMP3",
      "hiwiccp",
      "Squeezebox PWA",
      true,
    );
  });

  it("starts background browse warming after a successful connection", async () => {
    vi.spyOn(lmsConnection, "connect").mockResolvedValue();
    const warmSpy = vi.spyOn(lmsConnection, "warmBrowseCacheInBackground");

    const el = await render<HTMLElement>(html`<app-shell></app-shell>`);

    const dialog = getByShadow(el, "connection-dialog");

    dialog.dispatchEvent(
      new CustomEvent("connect", {
        detail: {
          serverUrl: "http://localhost:9000",
          username: "SlimpMP3",
          password: "hiwiccp",
          playerName: "Squeezebox PWA",
        },
        bubbles: true,
        composed: true,
      }),
    );

    await Promise.resolve();

    expect(warmSpy).toHaveBeenCalledOnce();
  });

  it("starts background browse warming after restoring a saved connection", async () => {
    vi.spyOn(lmsConnection, "restoreConnection").mockResolvedValue(true);
    const warmSpy = vi.spyOn(lmsConnection, "warmBrowseCacheInBackground");

    const el = await render<HTMLElement>(html`<app-shell></app-shell>`);

    await Promise.resolve();

    expect(warmSpy).toHaveBeenCalledOnce();
  });
});
