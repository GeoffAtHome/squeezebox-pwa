/**
 * App Shell - Main application container
 */

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./connection-dialog";
import "./player-controls";
import "./browse-library";
import { lmsConnection, type ConnectionState } from "@services/lms-connection";
import { CONNECTION_STATUS_VALUES } from "@utils/types";

@customElement("app-shell")
export class AppShell extends LitElement {
  private static readonly APP_VERSION =
    typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  private static readonly BUILD_STAMP =
    typeof __BUILD_STAMP__ !== "undefined" ? __BUILD_STAMP__ : "unknown";

  @state()
  connectionState: ConnectionState = lmsConnection.getState();

  @state()
  showPlayer = false;

  private unsubscribeConnection: (() => void) | null = null;
  private installPromptEvent: BeforeInstallPromptEvent | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #000;
      color: #fff;
      font-family:
        -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu,
        Cantarell, sans-serif;
    }

    .container {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 1rem;
    }

    .header {
      padding: 1rem;
      border-bottom: 1px solid #333;
      text-align: center;
    }

    .header-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.45rem;
      font-size: 0.74rem;
      color: #b8c0cc;
    }

    .badge {
      border: 1px solid #3b414b;
      border-radius: 999px;
      background: #1a1f28;
      color: #e2e8f0;
      font-weight: 600;
      letter-spacing: 0.02em;
      padding: 0.16rem 0.5rem;
    }

    .header h1 {
      font-size: 1.5rem;
      margin: 0;
    }

    .main {
      flex: 1;
      overflow: auto;
      padding: 1rem;
    }

    .connected-view {
      display: grid;
      gap: 1rem;
    }

    .footer {
      padding: 1rem;
      border-top: 1px solid #333;
    }

    .error {
      background: #8b0000;
      color: #fff;
      padding: 1rem;
      border-radius: 4px;
      margin: 1rem 0;
    }

    .status {
      text-align: center;
      color: #888;
      font-size: 0.9rem;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    this.unsubscribeConnection = lmsConnection.onStateChange((state) => {
      this.connectionState = state;
      if (state.status === CONNECTION_STATUS_VALUES.CONNECTED) {
        this.showPlayer = true;
      } else if (state.status === CONNECTION_STATUS_VALUES.ERROR) {
        this.showPlayer = false;
      }
    });

    window.addEventListener("beforeinstallprompt", this.handleInstallPrompt);
    window.addEventListener("appinstalled", this.handleAppInstalled);

    lmsConnection
      .restoreConnection()
      .then((restored) => {
        if (restored) {
          void lmsConnection.warmBrowseCacheInBackground();
        }
      })
      .catch(() => {
        this.showPlayer = false;
      });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this.unsubscribeConnection) this.unsubscribeConnection();
    window.removeEventListener("beforeinstallprompt", this.handleInstallPrompt);
    window.removeEventListener("appinstalled", this.handleAppInstalled);
  }

  private handleInstallPrompt = (event: Event) => {
    const installEvent = event as BeforeInstallPromptEvent;
    installEvent.preventDefault();
    this.installPromptEvent = installEvent;
  };

  private handleAppInstalled = () => {
    this.installPromptEvent = null;
  };

  private handleConnectionSuccess = async (
    serverUrl: string,
    username?: string,
    password?: string,
    playerName?: string,
    rememberPassword?: boolean,
  ) => {
    try {
      await lmsConnection.connect(
        serverUrl,
        username,
        password,
        playerName,
        rememberPassword,
      );
      void lmsConnection.warmBrowseCacheInBackground();
      if (this.installPromptEvent) this.installPromptEvent.prompt();
    } catch (error) {
      console.error("Connection failed:", error);
    }
  };

  render() {
    const buildDate = new Date(AppShell.BUILD_STAMP);
    const buildLabel = Number.isNaN(buildDate.getTime())
      ? AppShell.BUILD_STAMP
      : buildDate.toLocaleString();

    return html`
      <div class="container">
        <div class="header">
          <h1>PWA Squeezebox</h1>
          <div class="header-badge" title="Build information">
            <span class="badge">v${AppShell.APP_VERSION}</span>
            <span>${buildLabel}</span>
          </div>
        </div>

        <div class="main">
          ${this.connectionState.status === CONNECTION_STATUS_VALUES.ERROR
            ? html`<div class="error">
                Error: ${this.connectionState.error}
              </div>`
            : ""}
          ${this.showPlayer
            ? html`<div class="connected-view">
                <player-controls></player-controls>
                <browse-library></browse-library>
              </div>`
            : html`<connection-dialog
                @connect=${(e: CustomEvent) =>
                  this.handleConnectionSuccess(
                    e.detail.serverUrl,
                    e.detail.username,
                    e.detail.password,
                    e.detail.playerName,
                    e.detail.rememberPassword,
                  )}
              ></connection-dialog>`}
        </div>

        <div class="footer">
          <div class="status">
            ${this.connectionState.status === CONNECTION_STATUS_VALUES.CONNECTED
              ? `Connected as ${this.connectionState.playerId ?? ""}`
              : this.connectionState.status ===
                  CONNECTION_STATUS_VALUES.CONNECTING
                ? "Connecting..."
                : "Not connected"}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "app-shell": AppShell;
  }
}
