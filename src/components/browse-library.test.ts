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
      item_loop: [
        {
          id: "section:artists",
          text: "Artists",
          subtitle: "Browse by artist",
          hasitems: 1,
          canOpen: true,
        },
      ],
    });

    const element = document.createElement("browse-library");
    document.body.appendChild(element);

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;
    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(element.shadowRoot?.textContent).toContain("Browse Library");
    expect(element.shadowRoot?.textContent).toContain("Artists");
    expect(element.shadowRoot?.textContent).toContain("Browse by artist");
    expect(lmsConnection.browseMenu).toHaveBeenCalledWith({
      itemId: undefined,
      start: 0,
      quantity: 100,
      forceRefresh: false,
    });
  });

  it("opens nested menu when an entry is clicked", async () => {
    vi.spyOn(lmsConnection, "browseMenu")
      .mockResolvedValueOnce({
        item_loop: [
          {
            id: "myapps",
            text: "My Apps",
            subtitle: "Browse apps",
            hasitems: 1,
            canOpen: true,
            canPlay: true,
            canQueue: true,
          },
        ],
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
      'button[title="Open My Apps"]',
    ) as HTMLButtonElement;

    expect(firstEntryButton).toBeTruthy();
    firstEntryButton.click();

    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(lmsConnection.browseMenu).toHaveBeenNthCalledWith(2, {
      itemId: "myapps",
      start: 0,
      quantity: 100,
      forceRefresh: false,
    });
    expect(element.shadowRoot?.textContent).toContain("Radio");
  });

  it("plays a leaf item when the play button is clicked", async () => {
    vi.spyOn(lmsConnection, "browseMenu").mockResolvedValue({
      item_loop: [
        {
          id: "track-1",
          text: "Track 1",
          subtitle: "Artist 1",
          meta: "Album 1",
          artworkUrl: "/api/artwork?token=test&trackId=1",
          hasitems: 0,
          canPlay: true,
          canQueue: true,
        },
      ],
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

    const playBtn = element.shadowRoot?.querySelector(
      'button[title="Play Track 1"]',
    ) as HTMLButtonElement;

    expect(playBtn).toBeTruthy();
    playBtn.click();

    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(playSpy).toHaveBeenCalledWith("track-1");
  });

  it("plays a drill-down item when its play button is clicked", async () => {
    vi.spyOn(lmsConnection, "browseMenu").mockResolvedValue({
      item_loop: [
        {
          id: "album-2",
          text: "Album 2",
          subtitle: "Artist 2",
          meta: "1999",
          hasitems: 1,
          canOpen: true,
          canPlay: true,
          canQueue: true,
        },
      ],
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

    const playBtn = element.shadowRoot?.querySelector(
      'button[title="Play Album 2"]',
    ) as HTMLButtonElement;

    expect(playBtn).toBeTruthy();
    playBtn.click();

    await Promise.resolve();

    expect(playSpy).toHaveBeenCalledWith("album-2");
  });

  it("queues an item at end when Queue is clicked", async () => {
    vi.spyOn(lmsConnection, "browseMenu").mockResolvedValue({
      item_loop: [
        {
          id: "track-3",
          text: "Track 3",
          subtitle: "Artist 3",
          hasitems: 0,
          canPlay: true,
          canQueue: true,
        },
      ],
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

    const addToEndBtn = element.shadowRoot?.querySelector(
      'button[title="Queue Track 3"]',
    ) as HTMLButtonElement;

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
      start: 0,
      quantity: 100,
      forceRefresh: true,
    });
  });

  it("loads more entries when there are additional pages", async () => {
    const browseSpy = vi
      .spyOn(lmsConnection, "browseMenu")
      .mockResolvedValueOnce({
        item_loop: Array.from({ length: 100 }, (_, index) => ({
          id: `track-${index + 1}`,
          text: `Track ${index + 1}`,
          canPlay: true,
          canQueue: true,
        })),
        count: 150,
      })
      .mockResolvedValueOnce({
        item_loop: Array.from({ length: 50 }, (_, index) => ({
          id: `track-${index + 101}`,
          text: `Track ${index + 101}`,
          canPlay: true,
          canQueue: true,
        })),
        count: 150,
      });

    const element = document.createElement("browse-library");
    document.body.appendChild(element);

    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;
    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    (element as unknown as { currentItemId?: string }).currentItemId =
      "section:tracks";

    await (
      element as unknown as { handleLoadMore: () => Promise<void> }
    ).handleLoadMore();

    await Promise.resolve();
    await (element as HTMLElement & { updateComplete?: Promise<unknown> })
      .updateComplete;

    expect(browseSpy).toHaveBeenNthCalledWith(2, {
      itemId: "section:tracks",
      start: 100,
      quantity: 100,
    });
    expect(element.shadowRoot?.textContent).toContain("Track 150");
  });
});
