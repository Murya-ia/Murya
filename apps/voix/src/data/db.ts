// Petit accès à IndexedDB, la base de données du navigateur. C'est là que chaque audio validé
// attend son envoi : il survit à une coupure réseau, à la fermeture de l'onglet et au
// redémarrage du téléphone (spec §3.8).

const DB_NAME = 'murya';
const DB_VERSION = 1;
export type StoreName = 'envois' | 'etat';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('envois'))
        db.createObjectStore('envois', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('etat')) db.createObjectStore('etat');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    // On attend la fin de la transaction : la donnée est alors vraiment écrite sur le téléphone.
    transaction.oncomplete = () => resolve(request.result as T);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const idb = {
  all: <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll()),
  get: <T>(store: StoreName, key: IDBValidKey) =>
    run<T | undefined>(store, 'readonly', (s) => s.get(key)),
  put: (store: StoreName, value: unknown, key?: IDBValidKey) =>
    run<IDBValidKey>(store, 'readwrite', (s) => s.put(value, key)),
  delete: (store: StoreName, key: IDBValidKey) =>
    run<undefined>(store, 'readwrite', (s) => s.delete(key)),
};

/** Demande au navigateur de ne pas effacer nos données s'il manque de place (iPhone surtout). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
