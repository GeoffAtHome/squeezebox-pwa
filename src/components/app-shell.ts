/**
 * App Shell - Main application container
 */

import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./connection-dialog";
import "./player-controls";
import { lmsConnection, type ConnectionState } from "@services/lms-connection";
import { CONNECTION_STATUS_VALUES } from "@utils/types";

@customElement("app-shell")
export class AppShell extends LitElement {
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

    .header h1 {
      font-size: 1.5rem;
      margin: 0;
    }

    .main {
      flex: 1;
      overflow: auto;
      padding: 1rem;
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
      }
    });

    window.addEventListener("beforeinstallprompt", this.handleInstallPrompt);
    window.addEventListener("appinstalled", this.handleAppInstalled);

    lmsConnection.restoreConnection().catch(() => {
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
  ) => {
    try {
      await lmsConnection.connect(serverUrl, username, password, playerName);
      if (this.installPromptEvent) this.installPromptEvent.prompt();
    } catch (error) {
      console.error("Connection failed:", error);
    }
  };

  render() {
    return html`
      <div class="container">
        <div class="header">
          <h1>PWA Squeezebox</h1>
        </div>

        <div class="main">
          ${this.connectionState.status === CONNECTION_STATUS_VALUES.ERROR
            ? html`<div class="error">
                Error: ${this.connectionState.error}
              </div>`
            : ""}
          ${this.showPlayer
            ? html`<player-controls></player-controls>`
            : html`<connection-dialog
                @connect=${(e: CustomEvent) =>
                  this.handleConnectionSuccess(
                    e.detail.serverUrl,
                    e.detail.username,
                    e.detail.password,
                    e.detail.playerName,
                  )}
              ></connection-dialog>`}
        </div>

        <div class="footer">
          <div class="status">
            ${this.connectionState.status === CONNECTION_STATUS_VALUES.CONNECTED
              ? `âœ“ Connected as ${this.connectionState.playerId ?? ""}`
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
