// Mode « écouter puis répéter » (personnes qui ne lisent pas) : fait entendre la phrase, lue
// par une autre voix (de préférence la voix principale), avant que la personne la dise.

import { useEffect, useRef, useState } from 'react';
import type { Api } from '../data/api';
import { useT } from '../i18n/i18n';
import { Icon } from './icons';

export function ModelButton({ api, sentenceId }: { api: Api; sentenceId: number }) {
  const t = useT();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<'pret' | 'chargement' | 'lecture' | 'absent'>('pret');

  // Nouvelle phrase : on oublie l'audio de la précédente.
  useEffect(() => {
    setState('pret');
    return () => {
      audio.current?.pause();
      audio.current = null;
    };
  }, [sentenceId]);

  async function play() {
    if (state === 'lecture') {
      audio.current?.pause();
      setState('pret');
      return;
    }
    try {
      if (!audio.current) {
        setState('chargement');
        const { url } = await api.get<{ url: string }>(`/voix/modele/${sentenceId}`);
        audio.current = new Audio(url);
        audio.current.onended = () => setState('pret');
      }
      setState('lecture');
      await audio.current.play();
    } catch {
      setState('absent');
    }
  }

  return (
    <div className="modele">
      <button
        type="button"
        className="bouton-modele avec-icone"
        onClick={() => void play()}
        disabled={state === 'chargement'}
      >
        <Icon name={state === 'lecture' ? 'stop' : 'ecouter'} />
        {state === 'lecture'
          ? t('commun.arreter')
          : state === 'chargement'
            ? t('commun.chargement')
            : t('repetition.ecouter')}
      </button>
      {state === 'absent' && <p className="aide">{t('repetition.absent')}</p>}
    </div>
  );
}
