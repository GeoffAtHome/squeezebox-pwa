/**
 * Local Storage abstraction service
 * Handles persistent data storage for the PWA
 */

export interface StorageData {
  serverUrl?: string;
  username?: string;
  playerId?: string;
  playerState?: Record<string, any>;
}

class StorageService {
  private prefix = "squeezebox_";

  /**
   * Set a value in storage
   */
  set(key: string, value: any): void {
    try {
      const fullKey = this.prefix + key;
      localStorage.setItem(fullKey, JSON.stringify(value));
    } catch (error) {
      console.error("Storage set error:", error);
    }
  }

  /**
   * Get a value from storage
   */
  get<T = any>(key: string, defaultValue?: T): T | undefined {
    try {
      const fullKey = this.prefix + key;
      const item = localStorage.getItem(fullKey);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.error("Storage get error:", error);
      return defaultValue;
    }
  }

  /**
   * Remove a value from storage
   */
  remove(key: string): void {
    try {
      const fullKey = this.prefix + key;
      localStorage.removeItem(fullKey);
    } catch (error) {
      console.error("Storage remove error:", error);
    }
  }

  /**
   * Clear all storage
   */
  clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.error("Storage clear error:", error);
    }
  }

  /**
   * Get server configuration from storage
   */
  getServerConfig(): {
    serverUrl: string;
    username?: string;
    playerName?: string;
  } | null {
    const serverUrl = this.get<string>("serverUrl");
    if (!serverUrl) {
      return null;
    }

    return {
      serverUrl,
      username: this.get<string>("username"),
      playerName: this.get<string>("playerName"),
    };
  }

  /**
   * Save server configuration to storage.
   * The password is stored only in sessionStorage (cleared on browser close)
   * so it survives page reloads and backgrounding but is never persisted long-term.
   */
  saveServerConfig(
    serverUrl: string,
    username?: string,
    password?: string,
    playerName?: string,
    rememberPassword = false,
  ): void {
    this.set("serverUrl", serverUrl);
    if (username) this.set("username", username);
    if (playerName) this.set("playerName", playerName);
    this.set("rememberPassword", rememberPassword);

    // Password in sessionStorage survives reloads for this browser session.
    if (password) {
      try {
        sessionStorage.setItem(this.prefix + "password", password);
      } catch {
        // sessionStorage unavailable — proceed without caching
      }

      if (rememberPassword) {
        this.set("savedPassword", password);
      } else {
        this.remove("savedPassword");
      }
    } else {
      try {
        sessionStorage.removeItem(this.prefix + "password");
      } catch {
        // sessionStorage unavailable
      }

      if (!rememberPassword) {
        this.remove("savedPassword");
      }
    }
  }

  getRememberPassword(): boolean {
    return this.get<boolean>("rememberPassword", false) ?? false;
  }

  /**
   * Retrieve the session-scoped password (not persisted across browser close).
   */
  getSessionPassword(): string | undefined {
    try {
      const sessionPassword =
        sessionStorage.getItem(this.prefix + "password") ?? undefined;
      if (sessionPassword) return sessionPassword;
    } catch {
      // sessionStorage unavailable
    }

    if (this.getRememberPassword()) {
      return this.get<string>("savedPassword") ?? undefined;
    }

    try {
      return undefined;
    } catch {
      return undefined;
    }
  }
}

export const storage = new StorageService();
