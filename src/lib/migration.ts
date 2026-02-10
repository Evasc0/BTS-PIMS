const openIndexedDb = (name: string, version?: number): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
};

const readStore = (db: IDBDatabase, storeName: string): Promise<unknown[]> => {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
};

export async function exportLegacyIndexedDbDump(dbName = 'bts-inventory-db') {
  const db = await openIndexedDb(dbName);
  const storeNames = Array.from(db.objectStoreNames);
  const dump: Record<string, unknown[]> = {};

  for (const storeName of storeNames) {
    dump[storeName] = await readStore(db, storeName);
  }

  db.close();
  return dump;
}

export const downloadJson = (data: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export async function importLegacyDump(dump: unknown) {
  if (!window.api?.migration?.importLegacyDump) {
    throw new Error('Migration API is not available.');
  }
  await window.api.migration.importLegacyDump(dump);
}
