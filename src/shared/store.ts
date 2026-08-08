import { ExtractionData } from "./messages";

const DB_NAME = "fb-page-scraper";
const DB_VERSION = 1;
const LEADS_STORE = "leads";
const RUNS_STORE = "runs";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEADS_STORE)) {
        const s = db.createObjectStore(LEADS_STORE, { keyPath: "pageUrl" });
        s.createIndex("scrapedAt", "scrapedAt");
      }
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        db.createObjectStore(RUNS_STORE, { keyPath: "runId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const s = tx.objectStore(store);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLead(data: ExtractionData): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(LEADS_STORE, "readwrite");
        tx.objectStore(LEADS_STORE).put(data);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
      .catch(reject);
  });
}

export async function leadExists(pageUrl: string): Promise<boolean> {
  try {
    const found = await withStore<ExtractionData | undefined>(
      LEADS_STORE,
      "readonly",
      (s) => s.get(pageUrl) as IDBRequest<ExtractionData | undefined>,
    );
    return !!found;
  } catch {
    return false;
  }
}

export async function countLeads(): Promise<number> {
  try {
    return await withStore<number>(LEADS_STORE, "readonly", (s) => s.count() as IDBRequest<number>);
  } catch {
    return 0;
  }
}

export async function getAllLeads(): Promise<ExtractionData[]> {
  return new Promise((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(LEADS_STORE, "readonly");
        const req = tx.objectStore(LEADS_STORE).getAll() as IDBRequest<ExtractionData[]>;
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
      .catch(reject);
  });
}

export async function recordRun(run: { runId: string; startedAt: string; finishedAt: string; pages: number; errors: number }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    openDb()
      .then((db) => {
        const tx = db.transaction(RUNS_STORE, "readwrite");
        tx.objectStore(RUNS_STORE).put(run);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
      .catch(reject);
  });
}