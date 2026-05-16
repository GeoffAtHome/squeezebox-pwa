import { describe, it, expect, vi } from "vitest";
import { html } from "lit";
import { render, getByShadow, setupTestCleanup } from "../../test/test-harness";

import { storage } from "../services/storage";
import { type ServerUrl, type Username } from "@utils/types";
import "./connection-dialog";

setupTestCleanup();

describe("connection-dialog", () => {
  it("renders the LMS connection form", async () => {
    const el = await render<HTMLElement>(html`<connection-dialog></connection-dialog>`);

    const serverUrl = getByShadow(el, "#server-url");
    const username = getByShadow(el, "#username");
    const password = getByShadow(el, "#password");
    const button = getByShadow<HTMLElement>(el, "md-filled-button");

    expect(el.shadowRoot?.textContent).toContain("Connect to LMS");
    expect(serverUrl).toBeInstanceOf(HTMLElement);
    expect(username).toBeInstanceOf(HTMLElement);
    expect(password).toBeInstanceOf(HTMLElement);
    expect(button).toBeInstanceOf(HTMLElement);
  });

  it("dispatches a connect event with trimmed values", async () => {
    const handler = vi.fn();
    const el = await render<HTMLElement>(html`<connection-dialog></connection-dialog>`);
    el.addEventListener("connect", handler);

    const serverUrl = getByShadow<HTMLInputElement>(el, "#server-url");
    const username = getByShadow<HTMLInputElement>(el, "#username");
    const password = getByShadow<HTMLInputElement>(el, "#password");
    const button = getByShadow<HTMLElement>(el, "md-filled-button");

    serverUrl.value = "  http://localhost:9000  ";
    username.value = "admin";
    password.value = "secret";

    serverUrl.dispatchEvent(new Event("input"));
    username.dispatchEvent(new Event("input"));
    password.dispatchEvent(new Event("input"));

    button.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({
      serverUrl: "http://localhost:9000",
      username: "admin",
      password: "secret",
      playerName: "Squeezebox PWA",
      rememberPassword: false,
    });
  });

  it("dispatches rememberPassword=true when checkbox is selected", async () => {
    const handler = vi.fn();
    const el = await render<HTMLElement>(html`<connection-dialog></connection-dialog>`);
    el.addEventListener("connect", handler);

    const serverUrl = getByShadow<HTMLInputElement>(el, "#server-url");
    const remember = getByShadow<any>(el, "#remember-password");
    const button = getByShadow<HTMLElement>(el, "md-filled-button");

    serverUrl.value = "http://localhost:9000";
    serverUrl.dispatchEvent(new Event("input"));

    remember.checked = true;
    remember.dispatchEvent(new Event("change"));

    button.click();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail.rememberPassword).toBe(true);
  });

  it("shows a validation error and does not dispatch when server URL is empty", async () => {
    const handler = vi.fn();
    const el = await render<HTMLElement>(html`<connection-dialog></connection-dialog>`);
    el.addEventListener("connect", handler);

    const button = getByShadow<HTMLElement>(el, "md-filled-button");
    button.click();

    await (el as any).updateComplete;

    expect(handler).not.toHaveBeenCalled();
    expect(el.shadowRoot?.textContent).toContain("Please enter a server URL");
  });

  it("prefills saved server configuration", async () => {
    vi.spyOn(storage, "getServerConfig").mockReturnValue({
      serverUrl: "http://saved-host:9000" as ServerUrl,
      username: "saved-user" as Username,
    });
    vi.spyOn(storage, "getRememberPassword").mockReturnValue(true);

    const el = await render<HTMLElement>(html`<connection-dialog></connection-dialog>`);

    const serverUrl = getByShadow<HTMLInputElement>(el, "#server-url");
    const username = getByShadow<HTMLInputElement>(el, "#username");
    const remember = getByShadow<any>(el, "#remember-password");

    expect(serverUrl.value).toBe("http://saved-host:9000");
    expect(username.value).toBe("saved-user");
    expect(remember.checked).toBe(true);
  });
});
