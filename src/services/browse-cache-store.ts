import type { BrowseResult } from "./bridge-client";

type BrowseCacheRecord = {
  cacheKey: string;
  context: string;
  staleMarker: number;
  queryKey: string;
  result: BrowseResult;
  updatedAt: number;
};

const DB_NAME = "squeezebox-browse-cache";
const DB_VERSION = 1;
const STORE_NAME = "browse-pages";

class BrowseCacheStore {
  private memoryFallback = new Map<string, BrowseCacheRecord>();

  async loadContext(
    context: string,
    staleMarker: number,
  ): Promise<Record<string, BrowseResult>> {
    const db = await this.openDb();

    if (!db) {
      return this.loadFromMemory(context, staleMarker);
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("byContext");
      const request = index.getAll(IDBKeyRange.only(context));

      request.onerror = () => {
        reject(request.error ?? new Error("Failed to load browse cache"));
      };

      request.onsuccess = () => {
        const entries: Record<string, BrowseResult> = {};
        for (const record of request.result as BrowseCacheRecord[]) {
          if (record.staleMarker === staleMarker) {
            entries[record.queryKey] = record.result;
          }
        }
        resolve(entries);
      };
    });
  }

  async putEntry(
    context: string,
    staleMarker: number,
    queryKey: string,
    result: BrowseResult,
  ): Promise<void> {
    const record: BrowseCacheRecord = {
      cacheKey: this.getCacheKey(context, queryKey),
      context,
      staleMarker,
      queryKey,
      result,
      updatedAt: Date.now(),
    };

    const db = await this.openDb();

    if (!db) {
      this.memoryFallback.set(record.cacheKey, record);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("Failed to store browse cache"));
      };

      store.put(record);
    });
  }

  async deleteContext(context: string): Promise<void> {
    const db = await this.openDb();

    if (!db) {
      for (const key of Array.from(this.memoryFallback.keys())) {
        if (this.memoryFallback.get(key)?.context === context) {
          this.memoryFallback.delete(key);
        }
      }
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index("byContext");
      const request = index.openKeyCursor(IDBKeyRange.only(context));

      request.onerror = () => {
        reject(request.error ?? new Error("Failed to delete browse cache"));
      };

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }

        store.delete(cursor.primaryKey);
        cursor.continue();
      };
    });
  }

  private loadFromMemory(
    context: string,
    staleMarker: number,
  ): Record<string, BrowseResult> {
    const entries: Record<string, BrowseResult> = {};

    for (const record of this.memoryFallback.values()) {
      if (record.context === context && record.staleMarker === staleMarker) {
        entries[record.queryKey] = record.result;
      }
    }

    return entries;
  }

  private getCacheKey(context: string, queryKey: string): string {
    return `${context}::${queryKey}`;
  }

  private async openDb(): Promise<IDBDatabase | null> {
    if (!("indexedDB" in globalThis)) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(request.error ?? new Error("Failed to open browse cache DB"));
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: "cacheKey",
        });
        store.createIndex("byContext", "context", { unique: false });
      };

      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }
}

export const browseCacheStore = new BrowseCacheStore();
