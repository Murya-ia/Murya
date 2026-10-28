// Après consentement, fiche et tutoriel : choisit entre test, attente, lot, phrases à refaire
// et fin, selon la réponse du serveur (ou la dernière connue, sans réseau).

import { useCallback, useEffect, useState } from 'react';
import type { Api } from '../data/api';
import type { QueueState, UploadQueue } from '../data/queue';
import { cache, isOffline, type Sentences, type Session } from '../data/session';
import { useT } from '../i18n/i18n';
import { ErrorMessage } from '../ui/ErrorMessage';
import { ListenButton } from '../ui/ListenButton';
import { MessageScreen } from './MessageScreen';
import { RecordScreen } from './RecordScreen';
import { useScrollToTop } from '../ui/useScrollToTop';

export function RecordingFlow({
  token,
  api,
  queue,
  queueState,
  session,
}: {
  token: string;
  api: Api;
  queue: UploadQueue;
  queueState: QueueState;
  session: Session;
}) {
  const t = useT();
  const [data, setData] = useState<Sentences | null>(() => cache.sentences());
  const [error, setError] = useState<unknown>(null);
  // Fini sur ce téléphone, même si des audios attendent encore leur envoi.
  const [finishedLocally, setFinishedLocally] = useState(false);
  useScrollToTop(`${data?.etape ?? 'chargement'}-${finishedLocally}`);

  const load = useCallback(async () => {
    try {
      const fresh = await api.get<Sentences>('/voix/phrases');
      cache.saveSentences(fresh);
      setData(fresh);
      setError(null);
      setFinishedLocally(false);
    } catch (e) {
      // Sans réseau, on garde le dernier lot connu : la voix peut continuer à enregistrer.
      if (!isOffline(e) || !cache.sentences()) setError(e);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const finished = useCallback(() => setFinishedLocally(true), []);
  // Voix principale : audio de référence écouté pour cette séance (mémorisé dans le téléphone).
  const [, setReferenceHeard] = useState(0);

  if (!data) {
    return error ? (
      <MessageScreen
        icon="attention"
        action={{ label: t('commun.reessayer'), onClick: () => void load() }}
      >
        <ErrorMessage error={error} />
      </MessageScreen>
    ) : (
      <MessageScreen>{t('commun.chargement')}</MessageScreen>
    );
  }

  const redo = data.a_refaire ?? [];
  const settings = session.reglages;
  const principal = session.voix?.principale ?? false;
  const common = {
    token,
    api,
    queue,
    settings,
    principal,
    repetition: session.voix?.repetition ?? false,
    queuePending: queueState.pending,
    onFinished: finished,
  };

  if (data.etape === 'attente' || (data.etape === 'test' && finishedLocally)) {
    return <WaitingScreen onRefresh={() => void load()} />;
  }
  if (data.etape === 'sans_modele') {
    return (
      <MessageScreen
        icon="valider"
        title={t('repetition.sans_modele_titre')}
        action={{ label: t('attente.verifier'), onClick: () => void load() }}
      >
        <p>{t('repetition.sans_modele')}</p>
      </MessageScreen>
    );
  }
  // Voix principale : séance finie, l'équipe vérifie avant d'ouvrir la suivante.
  const sessionNumber = data.seance?.numero;
  if (
    data.etape === 'verification' ||
    (finishedLocally && data.etape === 'lot' && sessionNumber !== undefined)
  ) {
    return (
      <MessageScreen
        icon="valider"
        title={t('verification.titre', { n: sessionNumber ?? '' })}
        action={{ label: t('attente.verifier'), onClick: () => void load() }}
      >
        <p>{t('verification.texte')}</p>
        {queueState.pending > 0 && <p className="message alerte">{t('fin.envois_restants')}</p>}
      </MessageScreen>
    );
  }
  if (
    data.etape === 'lot' &&
    sessionNumber !== undefined &&
    data.seance?.reference_url &&
    !referenceHeard(sessionNumber)
  ) {
    return (
      <MessageScreen
        icon="ecouter"
        title={t('seance.titre', { n: sessionNumber })}
        action={{
          label: t('seance.commencer'),
          onClick: () => {
            markReferenceHeard(sessionNumber);
            setReferenceHeard((n) => n + 1);
          },
        }}
      >
        <p className="texte-long">{t('seance.reference')}</p>
        <ListenButton src={data.seance.reference_url} />
      </MessageScreen>
    );
  }
  if (data.etape === 'fin' || (finishedLocally && data.etape === 'lot')) {
    if (redo.length > 0 && !finishedLocally) {
      return <RecordScreen key="refaire" mode="refaire" sentences={redo} {...common} />;
    }
    const total =
      (data.total ?? 0) || data.phrases.filter((p) => p.enregistree).length + queueState.pending;
    return (
      <MessageScreen icon="valider" title={t('fin.titre')}>
        <p>{t('fin.texte', { n: total })}</p>
        {queueState.pending > 0 && <p className="message alerte">{t('fin.envois_restants')}</p>}
      </MessageScreen>
    );
  }
  if (data.etape === 'test') {
    return (
      <>
        {session.voix?.statut === 'test_a_refaire' && (
          <TestFeedback message={session.voix.message_test} />
        )}
        <RecordScreen key="test" mode="test" sentences={data.phrases} {...common} />
      </>
    );
  }
  // Lot : les phrases à refaire d'abord, puis le lot (sans doublon).
  const redoIds = new Set(redo.map((s) => s.id));
  const sentences = [...redo, ...data.phrases.filter((p) => !redoIds.has(p.id))];
  return <RecordScreen key="lot" mode="lot" sentences={sentences} {...common} />;
}

const referenceKey = (session: number) => `murya-reference-seance-${session}`;

function referenceHeard(session: number): boolean {
  try {
    return localStorage.getItem(referenceKey(session)) === '1';
  } catch {
    return false;
  }
}

function markReferenceHeard(session: number): void {
  try {
    localStorage.setItem(referenceKey(session), '1');
  } catch {
    // Stockage indisponible : l'écran de référence reviendra à la prochaine ouverture.
  }
}

function WaitingScreen({ onRefresh }: { onRefresh: () => void }) {
  const t = useT();
  return (
    <MessageScreen
      icon="valider"
      title={t('attente.titre')}
      action={{ label: t('attente.verifier'), onClick: onRefresh }}
    >
      <p>{t('attente.texte')}</p>
    </MessageScreen>
  );
}

function TestFeedback({ message }: { message: string | null }) {
  const t = useT();
  return (
    <div className="message alerte">
      <p>
        <strong>{t('attente.refaire')}</strong>
      </p>
      {message && (
        <p>
          {t('attente.message')} {message}
        </p>
      )}
    </div>
  );
}
