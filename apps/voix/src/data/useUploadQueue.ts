// Branche la file d'envoi (queue.ts) sur IndexedDB, l'API et R2, et l'expose aux écrans.

import { useEffect, useRef, useState } from 'react';
import { ApiError, createApi } from './api';
import { idb, requestPersistentStorage } from './db';
import { UploadQueue, type QueueState, type UploadItem, type UploadTransport } from './queue';

const store = {
  all: () => idb.all<UploadItem>('envois'),
  put: async (item: UploadItem) => void (await idb.put('envois', item)),
  remove: async (id: string) => void (await idb.delete('envois', id)),
};

const transport: UploadTransport = {
  async prepare(item) {
    const result = await createApi(item.token).post<{ url?: string; deja_recu: boolean }>(
      '/voix/envoi/preparer',
      { id: item.id, phrase_id: item.sentenceId },
    );
    return { url: result.deja_recu ? undefined : result.url };
  },
  async upload(url, wav) {
    // Envoi direct dans R2 avec l'URL signée : le fichier ne passe pas par l'API.
    const response = await fetch(url, {
      method: 'PUT',
      body: wav,
      headers: { 'Content-Type': 'audio/wav' },
    });
    if (!response.ok) throw new ApiError(response.status, `r2_${response.status}`);
  },
  confirm(item) {
    return createApi(item.token).post('/voix/envoi/confirmer', {
      id: item.id,
      phrase_id: item.sentenceId,
      mesures: item.metrics,
      micro: item.mic,
    });
  },
};

export function useUploadQueue(onVoiceStatus: (status: string) => void) {
  const [state, setState] = useState<QueueState>({ pending: 0, blocked: 0, paused: null });
  // La file est créée une seule fois ; on appelle toujours la dernière version du rappel.
  const statusCallback = useRef(onVoiceStatus);
  statusCallback.current = onVoiceStatus;
  const [queue] = useState(
    () => new UploadQueue(store, transport, setState, (s) => statusCallback.current(s)),
  );

  useEffect(() => {
    void requestPersistentStorage();
    void queue.start();
    // Le réseau revient : on renvoie tout de suite au lieu d'attendre le prochain essai.
    const retry = () => queue.retryNow();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [queue]);

  return { queue, state };
}
