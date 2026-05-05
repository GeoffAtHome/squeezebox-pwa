import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/dom";

import { storage } from "../services/storage";
import "./connection-dialog";

const getRequiredElement = <T extends Element>(
  root: ShadowRoot | null,
  selector: string,
): T => {
  const element = root?.querySelector<T>(selector);

  expect(element).not.toBeNull();
  return element as T;
};

describe("connection-dialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the LMS connection form", async () => {
    const element = document.createElement("connection-dialog");

    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const root = element.shadowRoot;

    expect(root).not.toBeNull();
    expect(root?.textContent).toContain("Connect to LMS");
    expect(
      getRequiredElement<HTMLInputElement>(root, "#server-url"),
    ).toBeInstanceOf(HTMLInputElement);
    expect(
      getRequiredElement<HTMLInputElement>(root, "#username"),
    ).toBeInstanceOf(HTMLInputElement);
    expect(
      getRequiredElement<HTMLInputElement>(root, "#password"),
    ).toBeInstanceOf(HTMLInputElement);
    expect(
      getRequiredElement<HTMLButtonElement>(root, "button.primary"),
    ).toBeInstanceOf(HTMLButtonElement);
  });

  it("dispatches a connect event with trimmed values", async () => {
    const element = document.createElement("connection-dialog");
    const handleConnect = vi.fn();

    element.addEventListener("connect", handleConnect);
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const root = element.shadowRoot;
    const serverUrlInput = getRequiredElement<HTMLInputElement>(
      root,
      "#server-url",
    );
    const usernameInput = getRequiredElement<HTMLInputElement>(
      root,
      "#username",
    );
    const passwordInput = getRequiredElement<HTMLInputElement>(
      root,
      "#password",
    );
    const connectButton = getRequiredElement<HTMLButtonElement>(
      root,
      "button.primary",
    );

    serverUrlInput.value = "  http://localhost:9000  ";
    usernameInput.value = "admin";
    passwordInput.value = "secret";

    fireEvent.input(serverUrlInput);
    fireEvent.input(usernameInput);
    fireEvent.input(passwordInput);
    fireEvent.click(connectButton);

    expect(handleConnect).toHaveBeenCalledTimes(1);
    expect(handleConnect.mock.calls[0][0].detail).toEqual({
      serverUrl: "http://localhost:9000",
      username: "admin",
      password: "secret",
      playerName: "Squeezebox PWA",
      rememberPassword: false,
    });
  });

  it("dispatches rememberPassword=true when checkbox is selected", async () => {
    const element = document.createElement("connection-dialog");
    const handleConnect = vi.fn();

    element.addEventListener("connect", handleConnect);
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const root = element.shadowRoot;
    const serverUrlInput = getRequiredElement<HTMLInputElement>(
      root,
      "#server-url",
    );
    const rememberPasswordInput = getRequiredElement<HTMLInputElement>(
      root,
      "#remember-password",
    );
    const connectButton = getRequiredElement<HTMLButtonElement>(
      root,
      "button.primary",
    );

    serverUrlInput.value = "http://localhost:9000";
    fireEvent.input(serverUrlInput);
    rememberPasswordInput.checked = true;
    fireEvent.change(rememberPasswordInput);
    fireEvent.click(connectButton);

    expect(handleConnect).toHaveBeenCalledTimes(1);
    expect(handleConnect.mock.calls[0][0].detail).toEqual(
      expect.objectContaining({
        rememberPassword: true,
      }),
    );
  });

  it("shows a validation error and does not dispatch when server URL is empty", async () => {
    const element = document.createElement("connection-dialog");
    const handleConnect = vi.fn();

    element.addEventListener("connect", handleConnect);
    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const root = element.shadowRoot;
    const connectButton = getRequiredElement<HTMLButtonElement>(
      root,
      "button.primary",
    );

    fireEvent.click(connectButton);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(handleConnect).not.toHaveBeenCalled();
    expect(root?.textContent).toContain("Please enter a server URL");
  });

  it("prefills saved server configuration", async () => {
    vi.spyOn(storage, "getServerConfig").mockReturnValue({
      serverUrl: "http://saved-host:9000",
      username: "saved-user",
    });
    vi.spyOn(storage, "getRememberPassword").mockReturnValue(true);

    const element = document.createElement("connection-dialog");

    document.body.appendChild(element);
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const root = element.shadowRoot;
    const serverUrlInput = getRequiredElement<HTMLInputElement>(
      root,
      "#server-url",
    );
    const usernameInput = getRequiredElement<HTMLInputElement>(
      root,
      "#username",
    );
    const rememberPasswordInput = getRequiredElement<HTMLInputElement>(
      root,
      "#remember-password",
    );

    expect(serverUrlInput.value).toBe("http://saved-host:9000");
    expect(usernameInput.value).toBe("saved-user");
    expect(rememberPasswordInput.checked).toBe(true);
  });
});
