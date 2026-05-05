import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { lmsConnection } from "@services/lms-connection";
import type { BrowseItem } from "@services/bridge-client";

type LibraryEntry = {
  id?: string;
  label: string;
  action: "open" | "play" | "disabled";
};

@customElement("browse-library")
export class BrowseLibrary extends LitElement {
  @state()
  private entries: LibraryEntry[] = [];

  @state()
  private loading = false;

  @state()
  private error = "";

  @state()
  private path: Array<{ id?: string; label: string }> = [{ label: "Library" }];

  connectedCallback(): void {
    super.connectedCallback();
    void this.loadMenu();
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
      gap: 0.6rem;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
      /* reserve space for ::scroll-button() when supported */
      scroll-marker-group: after;
    }

    .carousel::-webkit-scrollbar {
      display: none;
    }

    .carousel li {
      flex: 0 0 min(42vw, 140px);
      scroll-snap-align: start;
    }

    /* ── Card ────────────────────────────────────── */

    .card {
      height: 110px;
      background: #1e1e1e;
      border: 1px solid #2b2b2b;
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Folder card: entire card is a button */
    .card-folder-btn {
      all: unset;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 0.65rem 0.65rem 0.5rem;
      height: 100%;
      box-sizing: border-box;
      cursor: pointer;
      color: #fff;
      width: 100%;
    }

    .card-folder-btn:hover {
      background: #252525;
    }

    .card-folder-btn:active {
      background: #2e2e2e;
    }

    .card-folder-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .card-label {
      font-size: 0.82rem;
      font-weight: 500;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      line-height: 1.3;
    }

    .card-arrow {
      font-size: 1.1rem;
      color: #9aa0a6;
      align-self: flex-end;
    }

    /* Leaf card: label + action row */
    .leaf-label {
      flex: 1;
      font-size: 0.82rem;
      font-weight: 500;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      line-height: 1.3;
      padding: 0.65rem 0.65rem 0.4rem;
    }

    .leaf-actions {
      display: flex;
      border-top: 1px solid #2b2b2b;
    }

    .leaf-actions button {
      all: unset;
      flex: 1;
      text-align: center;
      padding: 0.3rem 0;
      font-size: 0.72rem;
      color: #ccc;
      cursor: pointer;
      border-right: 1px solid #2b2b2b;
    }

    .leaf-actions button:last-child {
      border-right: none;
    }

    .leaf-actions button:hover {
      background: #252525;
      color: #fff;
    }

    .leaf-actions button:active {
      background: #2e2e2e;
    }

    .leaf-actions button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* ── Scroll nav (progressive enhancement) ───── */

    @supports (scroll-marker-group: after) {
      .carousel::scroll-button(left),
      .carousel::scroll-button(right) {
        border: 1px solid #3a3a3a;
        background: #1e1e1e;
        color: #fff;
        border-radius: 50%;
        width: 28px;
        height: 28px;
        cursor: pointer;
      }

      .carousel::scroll-button(left) {
        content: "\2039" / "Previous";
      }

      .carousel::scroll-button(right) {
        content: "\203a" / "Next";
      }

      .carousel li::scroll-marker {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #3a3a3a;
        border: none;
        margin: 0 3px;
      }

      .carousel li::scroll-marker:target-current {
        background: #7c3aed;
      }
    }
  `;

  private async loadMenu(
    itemId?: string,
    nextLabel?: string,
    forceRefresh = false,
  ): Promise<void> {
    this.loading = true;
    this.error = "";

    try {
      const result = await lmsConnection.browseMenu({
        itemId,
        quantity: 100,
        forceRefresh,
      });
      const items = result.item_loop ?? [];
      this.entries = items.map((item, index) => this.toEntry(item, index));

      if (itemId && nextLabel) {
        this.path = [...this.path, { id: itemId, label: nextLabel }];
      } else if (!itemId) {
        this.path = [{ label: "Library" }];
      }
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to load library";
      this.entries = [];
    } finally {
      this.loading = false;
    }
  }

  private toEntry(item: BrowseItem, index: number): LibraryEntry {
    const id =
      typeof item.id === "string"
        ? item.id
        : typeof item.id === "number"
          ? String(item.id)
          : undefined;

    const rawLabel = item.text ?? item.name;
    const label =
      typeof rawLabel === "string" && rawLabel.trim()
        ? rawLabel.trim()
        : `Item ${index + 1}`;

    const hasChildren = item.hasitems === true || Number(item.hasitems) > 0;
    const action = !id ? "disabled" : hasChildren ? "open" : "play";

    return { id, label, action };
  }

  private handleEntryClick(entry: LibraryEntry): void {
    if (!entry.id || this.loading) return;

    if (entry.action === "open") {
      void this.loadMenu(entry.id, entry.label);
      return;
    }

    if (entry.action === "play") {
      void this.playItem(entry.id);
    }
  }

  private async playItem(itemId: string): Promise<void> {
    this.loading = true;
    this.error = "";
    try {
      await lmsConnection.playBrowseItem(itemId);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to play item";
    } finally {
      this.loading = false;
    }
  }

  private async addNextItem(itemId: string): Promise<void> {
    this.error = "";
    try {
      await lmsConnection.addNextBrowseItem(itemId);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to queue item";
    }
  }

  private async addToEndItem(itemId: string): Promise<void> {
    this.error = "";
    try {
      await lmsConnection.addToEndBrowseItem(itemId);
    } catch (error) {
      this.error =
        error instanceof Error ? error.message : "Failed to queue item";
    }
  }

  private handleBack(): void {
    if (this.path.length <= 1 || this.loading) return;

    const previousPath = this.path.slice(0, -1);
    const target = previousPath[previousPath.length - 1];
    this.path = previousPath;

    void this.loadMenu(target.id);
  }

  private handleRefresh(): void {
    const current = this.path[this.path.length - 1];
    void this.loadMenu(current.id, undefined, true);
  }

  private handleMarkStale(): void {
    lmsConnection.markBrowseCacheStale();
    const current = this.path[this.path.length - 1];
    void this.loadMenu(current.id, undefined, true);
  }

  render() {
    const breadcrumb = this.path.map((segment) => segment.label).join(" / ");

    return html`
      <div class="panel">
        <div class="header">
          <h2>Browse Library</h2>
          <div>
            <button
              class="nav-btn"
              @click=${this.handleBack}
              ?disabled=${this.path.length <= 1 || this.loading}
            >
              ← Back
            </button>
            <button
              class="nav-btn"
              @click=${this.handleRefresh}
              ?disabled=${this.loading}
            >
              ↺
            </button>
            <button
              class="nav-btn"
              @click=${this.handleMarkStale}
              ?disabled=${this.loading}
              title="Mark library cache as stale and reload"
            >
              ✦
            </button>
          </div>
        </div>

        <div class="path">${breadcrumb}</div>

        ${this.error ? html`<div class="error">${this.error}</div>` : ""}
        ${this.loading ? html`<div class="empty">Loading…</div>` : ""}
        ${!this.loading && this.entries.length === 0
          ? html`<div class="empty">No entries available.</div>`
          : html`
              <ul class="carousel">
                ${this.entries.map(
                  (entry) => html`
                    <li>
                      <div class="card">
                        ${entry.action === "play" && entry.id
                          ? html`
                              <span class="leaf-label">${entry.label}</span>
                              <div class="leaf-actions">
                                <button
                                  title="Play ${entry.label}"
                                  ?disabled=${this.loading}
                                  @click=${() => this.playItem(entry.id!)}
                                >
                                  ▶
                                </button>
                                <button
                                  title="Add next: ${entry.label}"
                                  ?disabled=${this.loading}
                                  @click=${() => this.addNextItem(entry.id!)}
                                >
                                  +Next
                                </button>
                                <button
                                  title="Add to end: ${entry.label}"
                                  ?disabled=${this.loading}
                                  @click=${() => this.addToEndItem(entry.id!)}
                                >
                                  +End
                                </button>
                              </div>
                            `
                          : html`
                              <button
                                class="card-folder-btn"
                                @click=${() => this.handleEntryClick(entry)}
                                ?disabled=${entry.action === "disabled" ||
                                this.loading}
                                title=${entry.action === "open"
                                  ? `Open ${entry.label}`
                                  : entry.label}
                              >
                                <span class="card-label">${entry.label}</span>
                                ${entry.action === "open"
                                  ? html`<span class="card-arrow">›</span>`
                                  : ""}
                              </button>
                            `}
                      </div>
                    </li>
                  `,
                )}
              </ul>
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
