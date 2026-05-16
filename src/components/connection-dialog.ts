/**
 * Connection Dialog Component
 * Allows user to enter LMS server URL and credentials
 */

import { LitElement, html, css, PropertyValues } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import "@material/web/textfield/filled-text-field.js";
import "@material/web/checkbox/checkbox.js";
import "@material/web/button/filled-button.js";
import "@material/web/button/text-button.js";
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
      margin: 2rem auto;
      padding: 2rem;
      background: #1a1a1a;
      border-radius: 8px;
      border: 1px solid #333;
    }

    md-filled-text-field {
      width: 100%;
      --md-theme-primary: #0066cc;
    }

    md-checkbox {
      --md-theme-primary: #0066cc;
      margin-right: 0.5rem;
    }

    .button-group {
      display: flex;
      gap: 1rem;
      margin-top: 2rem;
    }

    md-filled-button {
      flex: 1;
    }

    md-text-button {
      flex: 1;
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
    const target = e.target as HTMLInputElement & { value: string };
    this.serverUrl = target.value;
  };

  private handleUsernameChange = (e: Event) => {
    const target = e.target as HTMLInputElement & { value: string };
    this.username = target.value;
  };

  private handlePasswordChange = (e: Event) => {
    const target = e.target as HTMLInputElement & { value: string };
    this.password = target.value;
  };

  private handlePlayerNameChange = (e: Event) => {
    const target = e.target as HTMLInputElement & { value: string };
    this.playerName = target.value;
  };

  private handleRememberPasswordChange = (e: Event) => {
    const target = e.target as HTMLInputElement & { checked: boolean };
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

            <md-filled-text-field
              id="server-url"
              type="text"
              label="Server URL"
              placeholder="http://lms.example.com:9000"
              .value=${this.serverUrl}
              @input=${this.handleServerUrlChange}
              @keypress=${this.handleKeyPress}
              ?disabled=${this.isConnecting}
            ></md-filled-text-field>
            <div class="info">e.g., http://192.168.1.100:9000</div>
            <md-filled-text-field
              id="player-name"
              type="text"
              label="Player Name"
              placeholder="Squeezebox PWA"
              .value=${this.playerName}
              @input=${this.handlePlayerNameChange}
              @keypress=${this.handleKeyPress}
              ?disabled=${this.isConnecting}
            ></md-filled-text-field>
            <div class="info">How this player appears in LMS</div>
          </div>

            <md-filled-text-field
              id="username"
              type="text"
              label="Username (optional)"
              placeholder="admin"
              .value=${this.username}
              @input=${this.handleUsernameChange}
              @keypress=${this.handleKeyPress}
              ?disabled=${this.isConnecting}
            ></md-filled-text-field>
            <md-filled-text-field
              id="password"
              type="password"
              label="Password (optional)"
              placeholder="••••••••"
              .value=${this.password}
              @input=${this.handlePasswordChange}
              @keypress=${this.handleKeyPress}
              ?disabled=${this.isConnecting}
            ></md-filled-text-field>

            <div class="checkbox-group">
              <md-checkbox
                id="remember-password"
                .checked=${this.rememberPassword}
                @change=${this.handleRememberPasswordChange}
                ?disabled=${this.isConnecting}
              ></md-checkbox>
              <label for="remember-password">Remember password on this device</label>
            </div>
          </div>

          <div class="button-group">
            <md-filled-button
              @click=${this.handleConnect}
              ?disabled=${this.isConnecting}
            >
              ${this.isConnecting ? "Connecting..." : "Connect"}
            </md-filled-button>
          </div>
      </dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "connection-dialog": ConnectionDialog;
  }
}
