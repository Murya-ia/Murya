// Tutoriel (spec §3.4) : courte vidéo en zarma (à venir) et conseils illustrés.
// La vidéo n'est jamais lancée toute seule : elle coûte des données mobiles.

import { useState } from 'react';
import { Logo } from '@murya/commun/logo';
import type { Api } from '../data/api';
import { useT } from '../i18n/i18n';
import { ErrorMessage } from '../ui/ErrorMessage';
import { Icon } from '../ui/icons';

/** Adresse de la vidéo du tutoriel, quand elle existera (ex. https://…/tutoriel-dje.mp4).
 * Les sous-titres seront intégrés à la vidéo (aucun fichier de plus à télécharger). */
const VIDEO_URL = import.meta.env.VITE_TUTORIAL_VIDEO_URL;

export function TutorialScreen({ api, onDone }: { api: Api; onDone: () => void }) {
  const t = useT();
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
      {VIDEO_URL ? (
        <video className="video" src={VIDEO_URL} controls preload="none" playsInline></video>
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
