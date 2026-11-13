// IndexedDB adapter for the dedup store. The only DOM-dependent file in src/mesh/.
// Uses its own database so it does not interfere with the schema version in src/store.ts.
import type { SeenBackend, SeenEntry } from './dedup';

const DB_NAME = 'lifeline-mesh';
const STORE = 'seen';

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'msgId' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Create a SeenBackend on top of IndexedDB. Failures (e.g. private mode) reject; callers may fall back to memory. */
export function createIdbSeenBackend(factory: IDBFactory = indexedDB): SeenBackend {
  let dbPromise: Promise<IDBDatabase> | undefined;
  const db = () => (dbPromise ??= openDb(factory));
  return {
    async loadAll() {
      const tx = (await db()).transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      await done(tx);
      return req.result as SeenEntry[];
    },
    async put(entry) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ msgId: entry.msgId, firstSeenMs: entry.firstSeenMs });
      await done(tx);
    },
    async remove(msgIds) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      const os = tx.objectStore(STORE);
      for (const id of msgIds) os.delete(id);
      await done(tx);
    },
  };
}
