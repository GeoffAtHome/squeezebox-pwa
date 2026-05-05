import { afterEach, describe, expect, it, vi } from "vitest";

import { lmsConnection } from "@services/lms-connection";
import "./browse-library";

describe("browse-library", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("loads and renders root library entries", async () => {
    vi.spyOn(lmsConnection, "browseMenu").mockResolvedValue({
      item_loop: [{ id: "myapps", text: "My Apps", hasitems: 1 }],
    });

    const element = document.createElement("browse-library");
    document.body.appendChild(element);

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;
    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(element.shadowRoot?.textContent).toContain("Browse Library");
    expect(element.shadowRoot?.textContent).toContain("My Apps");
    expect(lmsConnection.browseMenu).toHaveBeenCalledWith({
      itemId: undefined,
      quantity: 100,
      forceRefresh: false,
    });
  });

  it("opens nested menu when an entry is clicked", async () => {
    vi.spyOn(lmsConnection, "browseMenu")
      .mockResolvedValueOnce({
        item_loop: [{ id: "myapps", text: "My Apps", hasitems: 1 }],
      })
      .mockResolvedValueOnce({
        item_loop: [{ id: "plugin-1", text: "Radio" }],
      });

    const element = document.createElement("browse-library");
    document.body.appendChild(element);

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;
    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const firstEntryButton = element.shadowRoot?.querySelector(
      "button.card-folder-btn",
    ) as HTMLButtonElement;

    expect(firstEntryButton).toBeTruthy();
    firstEntryButton.click();

    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(lmsConnection.browseMenu).toHaveBeenNthCalledWith(2, {
      itemId: "myapps",
      quantity: 100,
      forceRefresh: false,
    });
    expect(element.shadowRoot?.textContent).toContain("Radio");
  });

  it("plays a leaf item when the play button is clicked", async () => {
    vi.spyOn(lmsConnection, "browseMenu").mockResolvedValue({
      item_loop: [{ id: "track-1", text: "Track 1", hasitems: 0 }],
    });
    const playSpy = vi
      .spyOn(lmsConnection, "playBrowseItem")
      .mockResolvedValue(undefined);

    const element = document.createElement("browse-library");
    document.body.appendChild(element);

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;
    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const playBtn = Array.from(
      element.shadowRoot?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.trim() === "\u25b6") as HTMLButtonElement;

    expect(playBtn).toBeTruthy();
    playBtn.click();

    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(playSpy).toHaveBeenCalledWith("track-1");
  });

  it("queues a leaf item next when +Next is clicked", async () => {
    vi.spyOn(lmsConnection, "browseMenu").mockResolvedValue({
      item_loop: [{ id: "track-2", text: "Track 2", hasitems: 0 }],
    });
    const addNextSpy = vi
      .spyOn(lmsConnection, "addNextBrowseItem")
      .mockResolvedValue(undefined);

    const element = document.createElement("browse-library");
    document.body.appendChild(element);

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;
    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const addNextBtn = Array.from(
      element.shadowRoot?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.trim() === "+Next") as HTMLButtonElement;

    expect(addNextBtn).toBeTruthy();
    addNextBtn.click();

    await Promise.resolve();

    expect(addNextSpy).toHaveBeenCalledWith("track-2");
  });

  it("queues a leaf item at end when +End is clicked", async () => {
    vi.spyOn(lmsConnection, "browseMenu").mockResolvedValue({
      item_loop: [{ id: "track-3", text: "Track 3", hasitems: 0 }],
    });
    const addToEndSpy = vi
      .spyOn(lmsConnection, "addToEndBrowseItem")
      .mockResolvedValue(undefined);

    const element = document.createElement("browse-library");
    document.body.appendChild(element);

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;
    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const addToEndBtn = Array.from(
      element.shadowRoot?.querySelectorAll("button") ?? [],
    ).find((b) => b.textContent?.trim() === "+End") as HTMLButtonElement;

    expect(addToEndBtn).toBeTruthy();
    addToEndBtn.click();

    await Promise.resolve();

    expect(addToEndSpy).toHaveBeenCalledWith("track-3");
  });

  it("marks cache stale and reloads when library updated is clicked", async () => {
    const browseSpy = vi.spyOn(lmsConnection, "browseMenu").mockResolvedValue({
      item_loop: [{ id: "myapps", text: "My Apps" }],
    });
    const staleSpy = vi
      .spyOn(lmsConnection, "markBrowseCacheStale")
      .mockImplementation(() => {});

    const element = document.createElement("browse-library");
    document.body.appendChild(element);

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;
    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    const actionButtons = Array.from(
      element.shadowRoot?.querySelectorAll(".header button") ?? [],
    );
    const libraryUpdatedButton = actionButtons[2] as HTMLButtonElement;

    expect(libraryUpdatedButton).toBeTruthy();
    libraryUpdatedButton.click();

    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(staleSpy).toHaveBeenCalledOnce();
    expect(browseSpy).toHaveBeenNthCalledWith(2, {
      itemId: undefined,
      quantity: 100,
      forceRefresh: true,
    });
  });
});
