// Petit bandeau discret en haut de l'écran : réseau absent, audios en attente d'envoi (spec §3.8).

import { useEffect, useState } from 'react';
import type { QueueState } from '../data/queue';
import { useT } from '../i18n/i18n';
import { Icon } from './icons';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function Banner({ queue }: { queue: QueueState }) {
  const t = useT();
  const online = useOnline();
  const sending = queue.pending - queue.blocked;
  if (online && sending === 0 && queue.blocked === 0) return null;
  return (
    <div className="bandeau" role="status">
      {!online && (
        <p>
          <Icon name="hors_ligne" size={20} /> {t('commun.hors_ligne')}
        </p>
      )}
      {sending > 0 && (
        <p>
          <Icon name="envoi" size={20} /> {t('commun.en_attente', { n: sending })}
        </p>
      )}
      {queue.blocked > 0 && (
        <p>
          <Icon name="attention" size={20} /> {t('commun.envoi_bloque', { n: queue.blocked })}
        </p>
      )}
    </div>
  );
}
