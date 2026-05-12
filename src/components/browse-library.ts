import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { lmsConnection } from "@services/lms-connection";
import type { BrowseItem } from "@services/bridge-client";
import type { ItemId, ArtworkUrl } from "@utils/types";

type LibraryEntry = {
  id?: ItemId;
  title: string;
  subtitle?: string;
  meta?: string;
  artworkUrl?: ArtworkUrl;
  canOpen: boolean;
  canPlay: boolean;
  canQueue: boolean;
  disabled: boolean;
};

@customElement("browse-library")
export class BrowseLibrary extends LitElement {
  private static readonly PAGE_SIZE = 100;

  @query(".carousel")
  private carouselEl?: HTMLElement;

  @query(".load-sentinel")
  private loadSentinelEl?: HTMLElement;

  @query(".filter-input")
  private filterInputEl?: HTMLInputElement;

  @state()
  private entries: LibraryEntry[] = [];

  @state()
  private loadingMenu = false;

  @state()
  private loadingMore = false;

  @state()
  private performingAction = false;

  @state()
  private error = "";

  @state()
  private path: Array<{ id?: ItemId; label: string }> = [{ label: "Library" }];

  @state()
  private currentItemId?: ItemId;

  private previousPath: Array<{ id?: ItemId; label: string }> | null = null;
  private previousItemId?: ItemId;

  @state()
  private totalCount = 0;

  @state()
  private lastPageSize = 0;

  @state()
  private filterText = "";

  private loadMoreObserver: IntersectionObserver | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    void this.loadMenu();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.loadMoreObserver?.disconnect();
    this.loadMoreObserver = null;
  }

  firstUpdated(): void {
    this.updateLoadMoreObserver();
  }

  updated(): void {
    this.updateLoadMoreObserver();
  }

  static styles = css`
    :host {
      display: block;
      margin-top: 1rem;
    }

    .panel {
      background: #141414;
      border: 1px solid #2b2b2b;
      border-radius: 8px;
      padding: 1rem;
    }

    /* ── Header ──────────────────────────────────── */

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }

    h2 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      flex-shrink: 0;
    }

    .header > div:last-child {
      display: flex;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    .path {
      color: #9aa0a6;
      font-size: 0.8rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 0.75rem;
    }

    .nav-btn {
      border: 1px solid #3a3a3a;
      background: #1e1e1e;
      color: #fff;
      border-radius: 6px;
      padding: 0.35rem 0.6rem;
      cursor: pointer;
      font-size: 0.8rem;
    }

    .nav-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .filter-input {
      flex: 1;
      padding: 0.5rem 0.75rem;
      border: 1px solid #3a3a3a;
      background: #1e1e1e;
      color: #fff;
      border-radius: 6px;
      font-size: 0.9rem;
      min-width: 150px;
    }

    .filter-input::placeholder {
      color: #6a6a6a;
    }

    .filter-input:focus {
      outline: none;
      border-color: #4a4a4a;
      background: #252530;
    }

    .error {
      color: #ff7c7c;
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
    }

    .empty {
      color: #9aa0a6;
      font-size: 0.9rem;
      padding: 0.5rem 0;
    }

    /* ── Carousel ────────────────────────────────── */

    .carousel {
      list-style: none;
      margin: 0;
      padding: 0.25rem 0 0.5rem;
      display: flex;
      flex-wrap: nowrap;
      gap: 0.6rem;
      overflow-x: auto;
      overflow-y: hidden;
      touch-action: pan-x;
      overscroll-behavior-x: contain;
      -webkit-overflow-scrolling: touch;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
    }

    .carousel::-webkit-scrollbar {
      display: none;
    }

    .carousel-wrapper {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: stretch;
      gap: 0.5rem;
    }

    .carousel-btn {
      border: 1px solid #3a3a3a;
      background: #1e1e1e;
      color: #fff;
      border-radius: 999px;
      width: 2rem;
      height: 2rem;
      cursor: pointer;
      font-size: 1.2rem;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      flex-shrink: 0;
    }

    .carousel-btn:hover {
      background: #2f3440;
    }

    .carousel-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .carousel li {
      flex: 0 0 min(68vw, 220px);
      scroll-snap-align: start;
    }

    .load-sentinel-item {
      flex: 0 0 2rem;
      display: flex;
      align-items: stretch;
    }

    .load-sentinel {
      width: 2rem;
      min-height: 280px;
      display: grid;
      place-items: center;
    }

    .load-indicator {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      border: 2px solid #2f3440;
      border-top-color: #dfe6ef;
      animation: spin 0.9s linear infinite;
    }

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    /* ── Card ────────────────────────────────────── */

    .card {
      min-height: 280px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 42%),
        #1a1c20;
      border: 1px solid #31343b;
      border-radius: 18px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.24);
    }

    .card-media,
    .card-media-btn {
      all: unset;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      min-height: 132px;
      padding: 0.9rem;
      box-sizing: border-box;
      color: #fff;
      width: 100%;
      background:
        radial-gradient(
          circle at top left,
          rgba(255, 184, 77, 0.3),
          transparent 48%
        ),
        linear-gradient(160deg, #2a2d35, #17191d 68%);
      position: relative;
    }

    .card-media-btn {
      cursor: pointer;
    }

    .card-media-btn:hover {
      filter: brightness(1.06);
    }

    .card-media-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .artwork {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      overflow: hidden;
      background: rgba(255, 255, 255, 0.03);
    }

    .artwork img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .artwork-placeholder {
      font-size: 2rem;
      color: rgba(255, 255, 255, 0.88);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      z-index: 0;
    }

    .card-overlay {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 0.25rem;
      margin-top: auto;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.65);
    }

    .card-type {
      font-size: 0.68rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #d7dee7;
      opacity: 0.84;
    }

    .card-title {
      font-size: 1rem;
      font-weight: 700;
      line-height: 1.2;
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .card-subtitle,
    .card-meta {
      font-size: 0.8rem;
      line-height: 1.3;
      color: #d5d8de;
      display: -webkit-box;
      overflow: hidden;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
    }

    .card-meta {
      color: #9aa3af;
    }

    .card-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      padding: 0.9rem;
      border-top: 1px solid #2d3138;
      background: #17191d;
    }

    .card-actions button {
      all: unset;
      flex: 1 1 calc(50% - 0.3rem);
      text-align: center;
      padding: 0.55rem 0.6rem;
      font-size: 0.74rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #e4e8ee;
      cursor: pointer;
      border-radius: 999px;
      background: #252932;
    }

    .card-actions button:hover {
      background: #2f3440;
    }

    .card-actions button:active {
      background: #3a4150;
    }

    .card-actions button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .action-btn {
      display: inline-flex !important;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
    }

    .action-icon {
      width: 0.85rem;
      height: 0.85rem;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.9;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* ── Scroll nav (progressive enhancement) ───── */
  `;

  private async loadMenu(
    itemId?: ItemId,
    nextLabel?: string,
    forceRefresh = false,
    search?: string,
  ): Promise<void> {
    this.loadingMenu = true;
    this.error = "";

    try {
      const searchTerm = search?.trim();
      const result = await lmsConnection.browseMenu({
        itemId: searchTerm ? undefined : itemId,
        start: 0,
        quantity: BrowseLibrary.PAGE_SIZE,
        forceRefresh,
        search: searchTerm,
      });
      const items = result.item_loop ?? [];
      this.entries = items.map((item, index) => this.toEntry(item, index));
      this.currentItemId = searchTerm ? undefined : itemId;
      this.totalCount = Number(result.count ?? items.length);
      this.lastPageSize = items.length;

      if (searchTerm) {
        this.path = [{ label: `Search: ${searchTerm}` }];
      } else if (itemId && nextLabel) {
        this.path = [...this.path, { id: itemId, label: nextLabel }];
      } else if (!itemId) {
        this.path = [{ label: "Library" }];
      }
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to load library";
      this.entries = [];
    } finally {
      this.loadingMenu = false;
    }
  }

  private get hasMoreEntries(): boolean {
    if (this.filterText.trim()) {
      return this.lastPageSize > 0;
    }

    if (!this.currentItemId) {
      return false;
    }

    // Keep paging until we receive an empty page. LMS count values can be
    // inconsistent for some browse contexts and may under-report totals.
    return this.lastPageSize > 0;
  }

  private async handleLoadMore(): Promise<void> {
    if (this.loadingMenu || this.loadingMore || !this.hasMoreEntries) {
      return;
    }

    this.loadingMore = true;

    try {
      const start = this.entries.length;
      const result = await lmsConnection.browseMenu({
        itemId: this.filterText.trim() ? undefined : this.currentItemId,
        start,
        quantity: BrowseLibrary.PAGE_SIZE,
        search: this.filterText.trim() || undefined,
      });

      const items = result.item_loop ?? [];
      const mapped = items.map((item, index) =>
        this.toEntry(item, start + index),
      );

      const existingKeys = new Set(
        this.entries.map((entry) => `${entry.id ?? ""}|${entry.title}`),
      );
      const uniqueMapped = mapped.filter(
        (entry) => !existingKeys.has(`${entry.id ?? ""}|${entry.title}`),
      );

      if (uniqueMapped.length === 0) {
        // Some LMS contexts ignore `start` and repeat the same page forever.
        // Mark pagination complete to stop observer-triggered loops.
        this.lastPageSize = 0;
        return;
      }

      this.entries = [...this.entries, ...uniqueMapped];
      this.totalCount = Math.max(
        this.totalCount,
        Number(result.count ?? this.entries.length),
      );
      this.lastPageSize = uniqueMapped.length;
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to load more entries";
    } finally {
      this.loadingMore = false;
    }
  }

  private handleCarouselScroll = (event: Event): void => {
    if (!this.hasMoreEntries || this.loadingMenu || this.loadingMore) {
      return;
    }

    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    const remaining =
      target.scrollWidth - (target.scrollLeft + target.clientWidth);
    if (remaining <= 220) {
      void this.handleLoadMore();
    }
  };

  private handleCarouselWheel = (event: WheelEvent): void => {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.scrollWidth <= target.clientWidth) {
      return;
    }

    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }

    target.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  private updateLoadMoreObserver(): void {
    this.loadMoreObserver?.disconnect();
    this.loadMoreObserver = null;

    if (
      typeof IntersectionObserver === "undefined" ||
      !this.hasMoreEntries ||
      !this.carouselEl ||
      !this.loadSentinelEl
    ) {
      return;
    }

    this.loadMoreObserver = new IntersectionObserver(
      (entries) => {
        const sentinelVisible = entries.some((entry) => entry.isIntersecting);
        if (sentinelVisible) {
          void this.handleLoadMore();
        }
      },
      {
        root: this.carouselEl,
        rootMargin: "0px 240px 0px 0px",
        threshold: 0.01,
      },
    );

    this.loadMoreObserver.observe(this.loadSentinelEl);
  }

  private toEntry(item: BrowseItem, index: number): LibraryEntry {
    const id =
      typeof item.id === "string"
        ? (item.id as ItemId)
        : typeof item.id === "number"
          ? (String(item.id) as ItemId)
          : undefined;

    const rawLabel = item.text ?? item.name;
    const title =
      typeof rawLabel === "string" && rawLabel.trim()
        ? rawLabel.trim()
        : `Item ${index + 1}`;

    const hasChildren = item.hasitems === true || Number(item.hasitems) > 0;
    const canOpen = item.canOpen ?? hasChildren;
    const canPlay = item.canPlay ?? Boolean(id && item.type !== "section");
    const canQueue = item.canQueue ?? Boolean(id && item.type !== "section");
    const disabled = !id;

    return {
      id,
      title,
      subtitle: item.subtitle,
      meta: item.meta,
      artworkUrl: item.artworkUrl,
      canOpen,
      canPlay,
      canQueue,
      disabled,
    };
  }

  private handleEntryClick(entry: LibraryEntry): void {
    if (!entry.id || this.loadingMenu || this.performingAction) return;

    if (entry.canOpen) {
      void this.loadMenu(entry.id, entry.title);
      return;
    }

    if (entry.canPlay) {
      void this.playItem(entry.id);
    }
  }

  private async playItem(itemId: ItemId): Promise<void> {
    this.performingAction = true;
    this.error = "";
    try {
      await lmsConnection.playBrowseItem(itemId);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to play item";
    } finally {
      this.performingAction = false;
    }
  }

  private async addToEndItem(itemId: ItemId): Promise<void> {
    this.error = "";
    try {
      await lmsConnection.addToEndBrowseItem(itemId);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to queue item";
    }
  }

  private handleBack(): void {
    if (this.loadingMenu) return;

    if (this.isSearchActive) {
      const restoreItemId = this.previousItemId;
      const restorePath = this.previousPath;
      this.previousItemId = undefined;
      this.previousPath = null;
      this.filterText = "";
      if (restorePath) {
        this.path = restorePath;
      }
      void this.loadMenu(restoreItemId, undefined, true).then(() =>
        this.filterInputEl?.focus(),
      );
      return;
    }

    if (this.path.length <= 1) return;

    const previousPath = this.path.slice(0, -1);
    const target = previousPath[previousPath.length - 1];
    this.path = previousPath;

    void this.loadMenu(target.id);
  }

  private handleRefresh(): void {
    const current = this.path[this.path.length - 1];
    void this.loadMenu(
      this.isSearchActive ? undefined : current.id,
      undefined,
      true,
      this.filterText.trim() || undefined,
    );
  }

  private get isSearchActive(): boolean {
    return this.filterText.trim().length > 0;
  }

  private getFilteredEntries(): LibraryEntry[] {
    if (!this.isSearchActive) {
      return this.entries;
    }

    const query = this.filterText.toLowerCase().trim();
    return this.entries.filter((entry) =>
      entry.title.toLowerCase().startsWith(query),
    );
  }

  private handleFilterChange = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const newText = input.value;
    const hadSearch = this.isSearchActive;
    this.filterText = newText;
    const searchTerm = newText.trim();

    if (searchTerm) {
      if (!hadSearch) {
        this.previousPath = this.path;
        this.previousItemId = this.currentItemId;
      }
      void this.loadMenu(undefined, undefined, true, searchTerm).then(() =>
        this.filterInputEl?.focus(),
      );
      return;
    }

    if (hadSearch) {
      const restoreItemId = this.previousItemId;
      const restorePath = this.previousPath;
      this.previousItemId = undefined;
      this.previousPath = null;
      if (restorePath) {
        this.path = restorePath;
      }
      void this.loadMenu(restoreItemId, undefined, true).then(() =>
        this.filterInputEl?.focus(),
      );
    }
  };

  private handleMarkStale(): void {
    lmsConnection.markBrowseCacheStale();
    const current = this.path[this.path.length - 1];
    void this.loadMenu(
      this.isSearchActive ? undefined : current.id,
      undefined,
      true,
      this.filterText.trim() || undefined,
    );
  }

  private handleCarouselPrev(): void {
    if (this.carouselEl) {
      this.carouselEl.scrollBy({ left: -220, behavior: "smooth" });
    }
  }

  private handleCarouselNext(): void {
    if (this.carouselEl) {
      this.carouselEl.scrollBy({ left: 220, behavior: "smooth" });
    }
  }

  private renderArtwork(entry: LibraryEntry) {
    if (entry.artworkUrl) {
      return html`<img .src=${entry.artworkUrl} alt="${entry.title}" />`;
    }

    const initials = entry.title
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();

    return html`<span class="artwork-placeholder">${initials || "♪"}</span>`;
  }

  private renderIcon(kind: "open" | "play" | "queue" | "more") {
    if (kind === "open") {
      return html`<svg
        class="action-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M5 12h14"></path>
        <path d="m13 6 6 6-6 6"></path>
      </svg>`;
    }

    if (kind === "play") {
      return html`<svg
        class="action-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M8 5v14l11-7z"></path>
      </svg>`;
    }

    if (kind === "queue") {
      return html`<svg
        class="action-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M4 7h10"></path>
        <path d="M4 12h10"></path>
        <path d="M4 17h10"></path>
        <path d="M18 12h2"></path>
        <path d="M19 11v2"></path>
      </svg>`;
    }

    return html`<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14"></path>
      <path d="M5 12h14"></path>
    </svg>`;
  }

  render() {
    const breadcrumb = this.path.map((segment) => segment.label).join(" / ");

    return html`
      <div class="panel">
        <div class="header">
          <h2>Browse Library</h2>
          <input
            type="text"
            class="filter-input"
            placeholder="Filter entries…"
            .value=${this.filterText}
            @input=${this.handleFilterChange}
            ?disabled=${this.loadingMenu && !this.isSearchActive}
          />
          <div>
            <button
              class="nav-btn"
              @click=${this.handleBack}
              ?disabled=${!(this.isSearchActive || this.path.length > 1) ||
              this.loadingMenu}
            >
              ← Back
            </button>
            <button
              class="nav-btn"
              @click=${this.handleRefresh}
              ?disabled=${this.loadingMenu}
            >
              ↺
            </button>
            <button
              class="nav-btn"
              @click=${this.handleMarkStale}
              ?disabled=${this.loadingMenu}
              title="Mark library cache as stale and reload"
            >
              ✦
            </button>
          </div>
        </div>

        <div class="path">${breadcrumb}</div>

        ${this.error ? html`<div class="error">${this.error}</div>` : ""}
        ${this.loadingMenu ? html`<div class="empty">Loading…</div>` : ""}
        ${!this.loadingMenu && this.entries.length === 0
          ? html`<div class="empty">No entries available.</div>`
          : this.getFilteredEntries().length === 0
            ? html`<div class="empty">No entries match your filter.</div>`
            : html`
                <div class="carousel-wrapper">
                  <button
                    class="carousel-btn"
                    @click=${this.handleCarouselPrev}
                    title="Scroll left"
                    aria-label="Previous"
                  >
                    ‹
                  </button>
                  <ul
                    class="carousel"
                    @scroll=${this.handleCarouselScroll}
                    @wheel=${this.handleCarouselWheel}
                  >
                    ${this.getFilteredEntries().map(
                      (entry) => html`
                        <li>
                          <div class="card">
                            ${entry.canOpen || entry.canPlay
                              ? html`
                                  <button
                                    class="card-media-btn"
                                    @click=${() => this.handleEntryClick(entry)}
                                    ?disabled=${entry.disabled ||
                                    this.loadingMenu ||
                                    this.performingAction}
                                    title=${entry.canOpen
                                      ? `Open ${entry.title}`
                                      : `Play ${entry.title}`}
                                  >
                                    <div class="artwork">
                                      ${this.renderArtwork(entry)}
                                    </div>
                                    <div class="card-overlay">
                                      <span class="card-type"
                                        >${entry.canOpen
                                          ? "Browse"
                                          : "Play"}</span
                                      >
                                      <span class="card-title"
                                        >${entry.title}</span
                                      >
                                      ${entry.subtitle
                                        ? html`<span class="card-subtitle"
                                            >${entry.subtitle}</span
                                          >`
                                        : ""}
                                      ${entry.meta
                                        ? html`<span class="card-meta"
                                            >${entry.meta}</span
                                          >`
                                        : ""}
                                    </div>
                                  </button>
                                `
                              : html`
                                  <div class="card-media">
                                    <div class="artwork">
                                      ${this.renderArtwork(entry)}
                                    </div>
                                    <div class="card-overlay">
                                      <span class="card-type">Unavailable</span>
                                      <span class="card-title"
                                        >${entry.title}</span
                                      >
                                    </div>
                                  </div>
                                `}
                            <div class="card-actions">
                              ${entry.canOpen && entry.id
                                ? html`<button
                                    class="action-btn"
                                    title="Open ${entry.title}"
                                    ?disabled=${this.loadingMenu ||
                                    this.performingAction}
                                    @click=${() => this.handleEntryClick(entry)}
                                  >
                                    ${this.renderIcon("open")} Open
                                  </button>`
                                : ""}
                              ${entry.canPlay && entry.id
                                ? html`<button
                                    class="action-btn"
                                    title="Play ${entry.title}"
                                    ?disabled=${this.loadingMenu ||
                                    this.performingAction}
                                    @click=${() => this.playItem(entry.id!)}
                                  >
                                    ${this.renderIcon("play")} Play
                                  </button>`
                                : ""}
                              ${entry.canQueue && entry.id
                                ? html`<button
                                    class="action-btn"
                                    title="Queue ${entry.title}"
                                    ?disabled=${this.loadingMenu ||
                                    this.performingAction}
                                    @click=${() => this.addToEndItem(entry.id!)}
                                  >
                                    ${this.renderIcon("queue")} Queue
                                  </button>`
                                : ""}
                            </div>
                          </div>
                        </li>
                      `,
                    )}
                    ${this.hasMoreEntries
                      ? html`<li class="load-sentinel-item">
                          <div class="load-sentinel" aria-hidden="true">
                            ${this.loadingMore
                              ? html`<span class="load-indicator"></span>`
                              : html`<span></span>`}
                          </div>
                        </li>`
                      : ""}
                  </ul>
                  <button
                    class="carousel-btn"
                    @click=${this.handleCarouselNext}
                    title="Scroll right"
                    aria-label="Next"
                  >
                    ›
                  </button>
                </div>
              `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "browse-library": BrowseLibrary;
  }
}
