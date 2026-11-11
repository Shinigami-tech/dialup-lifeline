// Tiny IndexedDB store for heard messages, so cases survive a reload or a dead battery swap.
import type { Msg } from './ui/sos';

const DB = 'lifeline', STORE = 'messages';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMsg(m: Msg & { status?: string }): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...m, key: `${m.kind}:${m.id}` });
  } catch { /* private mode: keep in memory only */ }
}

export async function loadMsgs(): Promise<(Msg & { status?: string })[]> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as (Msg & { status?: string })[]);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}
