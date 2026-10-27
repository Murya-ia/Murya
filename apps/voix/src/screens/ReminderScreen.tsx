// Écran de rappel du consentement, à chaque retour de la voix (décision du 27/10/2026).

import { useState } from 'react';
import { Logo } from '@murya/commun/logo';
import type { Api } from '../data/api';
import { consentAudio, consentText } from '../data/consent';
import { isOffline, type Session } from '../data/session';
import { useLanguage, useT } from '../i18n/i18n';
import { ErrorMessage } from '../ui/ErrorMessage';
import { ListenButton } from '../ui/ListenButton';

export function ReminderScreen({
  api,
  session,
  onDone,
}: {
  api: Api;
  session: Session;
  onDone: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function confirm() {
    setBusy(true);
    try {
      await api.post('/voix/rappel', { langue_interface: language });
      onDone();
    } catch (e) {
      // Sans réseau, la voix peut continuer : son consentement complet est déjà enregistré,
      // et le rappel sera de nouveau proposé au prochain retour.
      if (isOffline(e)) onDone();
      else {
        setError(e);
        setBusy(false);
      }
    }
  }

  return (
    <main className="page centre-vertical">
      <Logo size={44} />
      <h1>{t('rappel.titre')}</h1>
      <ListenButton src={consentAudio(session, language, 'rappel')} />
      <p className="texte-long">{consentText(session, language).rappel ?? t('rappel.texte')}</p>
      <ErrorMessage error={error} />
      <button onClick={() => void confirm()} disabled={busy}>
        {t('rappel.continuer')}
      </button>
    </main>
  );
}
