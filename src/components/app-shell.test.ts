import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lmsConnection } from "@services/lms-connection";
import { CONNECTION_STATUS_VALUES, makeServerUrl } from "@utils/types";
import "./app-shell";

const getRequiredElement = <T extends Element>(
  root: ShadowRoot | null,
  selector: string,
): T => {
  const element = root?.querySelector<T>(selector);

  expect(element).not.toBeNull();
  return element as T;
};

describe("app-shell", () => {
  let connectionStateListener:
    | ((state: ReturnType<typeof lmsConnection.getState>) => void)
    | undefined;

  beforeEach(() => {
    vi.spyOn(lmsConnection, "getState").mockReturnValue({
      status: CONNECTION_STATUS_VALUES.IDLE,
    });
    vi.spyOn(lmsConnection, "restoreConnection").mockResolvedValue(false);
    vi.spyOn(lmsConnection, "onStateChange").mockImplementation((listener) => {
      connectionStateListener = listener;
      return () => {
        connectionStateListener = undefined;
      };
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows the connection dialog by default", async () => {
    const element = document.createElement("app-shell");

    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const root = element.shadowRoot;

    expect(root?.textContent).toContain("Squeezebox");
    expect(getRequiredElement(root, "connection-dialog")).toBeInstanceOf(
      HTMLElement,
    );
    expect(root?.querySelector("player-controls")).toBeNull();
    expect(root?.textContent).toContain("Not connected");
  });

  it("shows player-controls after successful connection", async () => {
    const serverUrl = makeServerUrl("http://localhost:9000");

    vi.spyOn(lmsConnection, "connect").mockImplementation(async () => {
      connectionStateListener?.({
        status: CONNECTION_STATUS_VALUES.CONNECTED,
        serverUrl,
        playerId: "02:ab:cd:ef:01:23",
      });
    });

    const element = document.createElement("app-shell");

    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const root = element.shadowRoot;
    const dialog = getRequiredElement(root, "connection-dialog");

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

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(root?.querySelector("connection-dialog")).toBeNull();
    expect(getRequiredElement(root, "player-controls")).toBeInstanceOf(
      HTMLElement,
    );
    expect(root?.textContent).toContain("Connected");
  });

  it("shows an error banner and keeps the dialog visible after a failed connection", async () => {
    const serverUrl = makeServerUrl("http://localhost:9000");
    const connectSpy = vi
      .spyOn(lmsConnection, "connect")
      .mockImplementation(async () => {
        connectionStateListener?.({
          status: CONNECTION_STATUS_VALUES.ERROR,
          error: "Authentication failed",
          serverUrl,
        });
        throw new Error("Authentication failed");
      });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const element = document.createElement("app-shell");

    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const root = element.shadowRoot;
    const dialog = getRequiredElement(root, "connection-dialog");

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

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(connectSpy).toHaveBeenCalledWith(
      "http://localhost:9000",
      "wrong-user",
      "wrong-pass",
      "Squeezebox PWA",
    );
    expect(getRequiredElement(root, "connection-dialog")).toBeInstanceOf(
      HTMLElement,
    );
    expect(root?.querySelector("player-controls")).toBeNull();
    expect(root?.textContent).toContain("Error: Authentication failed");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

