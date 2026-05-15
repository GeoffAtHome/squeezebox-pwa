/**
 * Connection Dialog Component
 * Allows user to enter LMS server URL and credentials
 */

import { LitElement, html, css, PropertyValues } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { storage } from "@services/storage";

@customElement("connection-dialog")
export class ConnectionDialog extends LitElement {
  @query("dialog")
  dialogElement!: HTMLDialogElement;

  @state()
  serverUrl = "";

  @state()
  username = "";

  @state()
  password = "";

  @state()
  rememberPassword = false;

  @state()
  playerName = "Squeezebox PWA";

  @state()
  isConnecting = false;

  @state()
  error = "";

  static styles = css`
    :host {
      display: block;
    }

    dialog {
      max-width: 400px;
      margin: 2rem auto; /* Adjusted margin for native dialog feel */
      padding: 2rem;
      background: #1a1a1a;
      border-radius: 8px;
      border: 1px solid #333;
    }

    .form-group {
      margin-bottom: 1.5rem;
    }

    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
      font-size: 0.9rem;
    }

    input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #333;
      border-radius: 4px;
      background: #000;
      color: #fff;
      font-size: 1rem;
      box-sizing: border-box;
    }

    input:focus {
      outline: none;
      border-color: #0066cc;
      box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.1);
    }

    .button-group {
      display: flex;
      gap: 1rem;
      margin-top: 2rem;
    }

    button {
      flex: 1;
      padding: 0.75rem;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .primary {
      background: #0066cc;
      color: #fff;
    }

    .primary:hover:not(:disabled) {
      background: #0052a3;
    }

    .secondary {
      background: #333;
      color: #fff;
    }

    .secondary:hover:not(:disabled) {
      background: #444;
    }

    .error {
      background: #8b0000;
      color: #fff;
      padding: 1rem;
      border-radius: 4px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }

    .info {
      color: #999;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }

    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.5rem;
      color: #ddd;
      font-size: 0.9rem;
    }

    .checkbox-group input {
      width: auto;
      padding: 0;
      margin: 0;
      accent-color: #0066cc;
    }

    h2 {
      margin: 0 0 1.5rem 0;
      font-size: 1.3rem;
    }
  `;

  connectedCallback() {
    super.connectedCallback();

    // Load saved configuration
    const config = storage.getServerConfig();
    if (config) {
      this.serverUrl = config.serverUrl;
      this.username = config.username || "";
      this.playerName = config.playerName || "Squeezebox PWA";
    }
    this.rememberPassword = storage.getRememberPassword();
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    super.firstUpdated(_changedProperties);

    // Open the dialog when the component is connected
    if (this.dialogElement) {
      this.dialogElement.open = true;
    }

  }

  private handleConnect = async () => {
    // Validate input
    if (!this.serverUrl.trim()) {
      this.error = "Please enter a server URL";
      return;
    }

    this.isConnecting = true;
    this.error = "";

    try {
      // Dispatch connect event
      this.dispatchEvent(
        new CustomEvent("connect", {
          detail: {
            serverUrl: this.serverUrl.trim(),
            username: this.username || undefined,
            password: this.password || undefined,
            playerName: this.playerName.trim() || "Squeezebox PWA",
            rememberPassword: this.rememberPassword,
          },
          bubbles: true,
          composed: true,
        }),
      );
      // Release local form lock immediately; app shell owns async connect state.
      this.isConnecting = false;
    } catch (err) {
      this.error = "Connection failed. Please try again.";
      this.isConnecting = false;
    }
  };

  private handleServerUrlChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.serverUrl = target.value;
  };

  private handleUsernameChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.username = target.value;
  };

  private handlePasswordChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.password = target.value;
  };

  private handlePlayerNameChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.playerName = target.value;
  };

  private handleRememberPasswordChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.rememberPassword = target.checked;
  };

  private handleKeyPress = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !this.isConnecting) {
      this.handleConnect();
    }
  };

  render() {
    return html`
      <dialog>
        <h2>Connect to LMS</h2>

        ${this.error ? html`<div class="error">${this.error}</div>` : ""}

        <form @submit=${(e: Event) => e.preventDefault()}>
          <div class="form-group">
            <label for="server-url">Server URL</label>
            <input
              id="server-url"
              type="text"
              placeholder="http://lms.example.com:9000"
              .value=${this.serverUrl}
              @input=${this.handleServerUrlChange}
              @keypress=${this.handleKeyPress}
              ?disabled=${this.isConnecting}
              autocomplete="url"
            />
            <div class="info">e.g., http://192.168.1.100:9000</div>
          </div>

          <div class="form-group">
            <label for="player-name">Player Name</label>
            <input
              id="player-name"
              type="text"
              placeholder="Squeezebox PWA"
              .value=${this.playerName}
              @input=${this.handlePlayerNameChange}
              @keypress=${this.handleKeyPress}
              ?disabled=${this.isConnecting}
              autocomplete="off"
            />
            <div class="info">How this player appears in LMS</div>
          </div>

          <div class="form-group">
            <label for="username">Username (optional)</label>
            <input
              id="username"
              type="text"
              placeholder="admin"
              .value=${this.username}
              @input=${this.handleUsernameChange}
              @keypress=${this.handleKeyPress}
              ?disabled=${this.isConnecting}
              autocomplete="username"
            />
          </div>

          <div class="form-group">
            <label for="password">Password (optional)</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              .value=${this.password}
              @input=${this.handlePasswordChange}
              @keypress=${this.handleKeyPress}
              ?disabled=${this.isConnecting}
              autocomplete="current-password"
            />
            <label class="checkbox-group" for="remember-password">
              <input
                id="remember-password"
                type="checkbox"
                .checked=${this.rememberPassword}
                @change=${this.handleRememberPasswordChange}
                ?disabled=${this.isConnecting}
              />
              Remember password on this device
            </label>
          </div>

          <div class="button-group">
            <button
              class="primary"
              @click=${this.handleConnect}
              ?disabled=${this.isConnecting}
            >
              ${this.isConnecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </form>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "connection-dialog": ConnectionDialog;
  }
}
