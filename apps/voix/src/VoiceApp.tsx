// Parcours complet d'une voix (spec §3) : langue → consentement (ou rappel) → fiche →
// tutoriel → test → enregistrement. Chaque étape est décidée par la réponse du serveur ;
// sans réseau, l'app reprend la dernière réponse connue.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createApi } from './data/api';
import { cache, isOffline, readLanguage, saveLanguage, type Session } from './data/session';
import { useUploadQueue } from './data/useUploadQueue';
import { LanguageProvider, translate, type UiLanguage } from './i18n/i18n';
import { ConsentScreen } from './screens/ConsentScreen';
import { LanguageScreen } from './screens/LanguageScreen';
import { MessageScreen } from './screens/MessageScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { RecordingFlow } from './screens/RecordingFlow';
import { ReminderScreen } from './screens/ReminderScreen';
import { TutorialScreen } from './screens/TutorialScreen';
import { Banner } from './ui/Banner';
import { ErrorMessage } from './ui/ErrorMessage';

export function VoiceApp({ token }: { token: string }) {
  const [language, setLanguage] = useState<UiLanguage | null>(readLanguage);
  const api = useMemo(() => createApi(token), [token]);
  const [session, setSession] = useState<Session | null>(() => cache.session());
  const [error, setError] = useState<unknown>(null);
  // Le rappel du consentement est montré une fois par ouverture de l'app.
  const [reminderSeen, setReminderSeen] = useState(false);

  const load = useCallback(async () => {
    try {
      const fresh = await api.get<Session>('/voix/session');
      cache.saveSession(fresh);
      setSession(fresh);
      setError(null);
    } catch (e) {
      // Sans réseau, on garde la dernière session connue (si elle existe).
      if (!isOffline(e) || !cache.session()) setError(e);
    }
  }, [api]);

  // Le statut de la voix change quand le serveur confirme un envoi (ex. test terminé).
  const { queue, state: queueState } = useUploadQueue(
    useCallback(
      (status: string) => {
        if (session?.voix && status !== session.voix.statut) void load();
      },
      [session, load],
    ),
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!language) {
    return (
      <LanguageScreen
        onChoose={(l) => {
          saveLanguage(l);
          setLanguage(l);
        }}
      />
    );
  }

  return (
    <LanguageProvider language={language}>
      <Banner queue={queueState} />
      {renderStep()}
    </LanguageProvider>
  );

  function renderStep() {
    const t = (key: Parameters<typeof translate>[1]) => translate(language!, key);
    if (error && !session) {
      return (
        <MessageScreen
          icon="attention"
          action={{ label: t('commun.reessayer'), onClick: () => void load() }}
        >
          <ErrorMessage error={error} />
        </MessageScreen>
      );
    }
    if (!session) return <MessageScreen>{t('commun.chargement')}</MessageScreen>;
    if (!session.consentement) {
      return (
        <MessageScreen icon="attention">{t('erreur.consentement_indisponible')}</MessageScreen>
      );
    }
    const voice = session.voix;
    const reload = () => void load();
    if (!voice || !voice.consentement_a_jour) {
      return <ConsentScreen api={api} session={session} onDone={reload} />;
    }
    if (voice.rappel_requis && !reminderSeen) {
      return <ReminderScreen api={api} session={session} onDone={() => setReminderSeen(true)} />;
    }
    if (!voice.fiche_remplie) return <ProfileScreen api={api} onDone={reload} />;
    if (!voice.tutoriel_vu) return <TutorialScreen api={api} onDone={reload} />;
    return (
      <RecordingFlow
        token={token}
        api={api}
        queue={queue}
        queueState={queueState}
        session={session}
      />
    );
  }
}
