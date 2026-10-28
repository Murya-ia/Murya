// Après consentement, fiche et tutoriel : choisit entre test, attente, lot, phrases à refaire
// et fin, selon la réponse du serveur (ou la dernière connue, sans réseau).

import { useCallback, useEffect, useState } from 'react';
import type { Api } from '../data/api';
import type { QueueState, UploadQueue } from '../data/queue';
import { cache, isOffline, type Sentences, type Session } from '../data/session';
import { useT } from '../i18n/i18n';
import { ErrorMessage } from '../ui/ErrorMessage';
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
    queuePending: queueState.pending,
    onFinished: finished,
  };

  if (data.etape === 'attente' || (data.etape === 'test' && finishedLocally)) {
    return <WaitingScreen onRefresh={() => void load()} />;
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
