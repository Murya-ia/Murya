// Bouton « Écouter » : lit un texte enregistré par l'équipe (consentement, rappel), pour les
// personnes qui lisent peu (spec §3.2). Masqué tant que l'audio n'existe pas.

import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n/i18n';
import { Icon } from './icons';

export function ListenButton({ src }: { src: string | undefined }) {
  const t = useT();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => audio.current?.pause(), []);
  if (!src) return null;

  function toggle() {
    if (!audio.current) {
      audio.current = new Audio(src);
      audio.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      void audio.current.play();
      setPlaying(true);
    }
  }

  return (
    <button type="button" className="secondaire avec-icone" onClick={toggle}>
      <Icon name={playing ? 'stop' : 'ecouter'} />
      {playing ? t('commun.arreter') : t('commun.ecouter')}
    </button>
  );
}
