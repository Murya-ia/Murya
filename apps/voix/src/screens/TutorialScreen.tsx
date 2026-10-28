// Tutoriel (spec §3.4) : courte vidéo (1 min, sous-titrée) et conseils illustrés.
// La vidéo n'est jamais lancée toute seule : elle coûte des données mobiles (2 Mo).

import { useState } from 'react';
import { Logo } from '@murya/commun/logo';
import type { Api } from '../data/api';
import { useLanguage, useT, type UiLanguage } from '../i18n/i18n';
import { ErrorMessage } from '../ui/ErrorMessage';
import { Icon } from '../ui/icons';

/** Vidéo du tutoriel par langue d'interface (fichiers de apps/voix/public, jamais mis en
 * cache d'avance). Sous-titres intégrés à l'image. Version zarma : à ajouter quand la voix off
 * aura été enregistrée par l'équipe ; en attendant, la version française. */
const VIDEOS: Partial<Record<UiLanguage, string>> = { fr: '/tutoriel-fr.mp4' };

export function TutorialScreen({ api, onDone }: { api: Api; onDone: () => void }) {
  const t = useT();
  const video = VIDEOS[useLanguage()] ?? VIDEOS.fr;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function done() {
    setBusy(true);
    try {
      await api.post('/voix/tutoriel');
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Logo size={36} />
      <h1>{t('tutoriel.titre')}</h1>
      {video ? (
        <video
          className="video"
          src={video}
          poster="/tutoriel-affiche.jpg"
          controls
          preload="none"
          playsInline
        ></video>
      ) : (
        <p className="aide">{t('tutoriel.video_absente')}</p>
      )}
      <ul className="conseils">
        <li>
          <Icon name="ecouter" /> {t('tutoriel.conseil_calme')}
        </li>
        <li>
          <Icon name="micro" /> {t('tutoriel.conseil_distance')}
        </li>
        <li>
          <Icon name="lecture" /> {t('tutoriel.conseil_attendre')}
        </li>
        <li>
          <Icon name="valider" /> {t('tutoriel.conseil_naturel')}
        </li>
      </ul>
      <ErrorMessage error={error} />
      <button onClick={() => void done()} disabled={busy}>
        {t('tutoriel.passer')}
      </button>
    </main>
  );
}
