// Écran d'enregistrement (spec §3.6), utilisé pour le test, le lot et les phrases à refaire.
//   - la phrase en très gros, un gros bouton Enregistrer / Stop, une barre de niveau ;
//   - arrêt automatique à 20 s ;
//   - après Stop : Réécouter, Recommencer, Valider ; vérifications instantanées (§6.1) ;
//   - Valider range l'audio dans le téléphone et passe tout de suite à la phrase suivante :
//     l'envoi se fait en arrière-plan (file d'envoi) ;
//   - pause conseillée toutes les 50 phrases.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeSamples,
  clientProblems,
  DEFAULT_CLIENT_CHECKS,
  encodeWav,
  newUuid,
  type AudioMetrics,
  type ClientProblem,
} from '@murya/commun';
import { MicrophoneError, Recorder, type MicrophoneProblem } from '../audio/recorder';
import { resample } from '../audio/resample';
import type { Api } from '../data/api';
import type { UploadQueue } from '../data/queue';
import { isOffline, type Sentence, type Session } from '../data/session';
import { useT, type TextKey } from '../i18n/i18n';
import { Icon } from '../ui/icons';
import { LevelMeter } from '../ui/LevelMeter';

/** Fréquence des voix variées (spec §4.1). La voix principale garde celle du téléphone (§4.2). */
const VARIED_RATE = 16_000;
/** Après ce nombre d'essais refusés sur une phrase, on propose « Valider quand même ». */
const ATTEMPTS_BEFORE_OVERRIDE = 2;

type Phase = 'pret' | 'ouverture' | 'enregistrement' | 'traitement' | 'resultat' | 'pause';
export type RecordMode = 'test' | 'lot' | 'refaire';

interface Take {
  wav: Uint8Array<ArrayBuffer>;
  url: string;
  metrics: AudioMetrics;
  problems: ClientProblem[];
}

export function RecordScreen({
  token,
  api,
  queue,
  mode,
  sentences,
  settings,
  principal,
  queuePending,
  onFinished,
}: {
  token: string;
  api: Api;
  queue: UploadQueue;
  mode: RecordMode;
  sentences: Sentence[];
  settings: Session['reglages'];
  principal: boolean;
  /** Nombre d'audios en attente : recalcule les phrases faites quand la file se recharge. */
  queuePending: number;
  onFinished: () => void;
}) {
  const t = useT();
  const maxSeconds = settings.duree_max_s ?? 20;
  const pauseEvery = settings.pause_toutes ?? 50;
  const thresholds = settings.verifications ?? DEFAULT_CLIENT_CHECKS;

  // Phrases faites ou sautées sur cet écran depuis son ouverture.
  const [localDone, setLocalDone] = useState<Set<number>>(() => new Set());
  // Phrases déjà faites : selon le serveur (la réponse peut arriver après l'affichage, quand
  // l'app s'ouvre d'abord avec la dernière réponse connue), en attente d'envoi, ou faites ici.
  const done = useMemo(() => {
    const recorded = queue.recordedSentenceIds;
    const ids = sentences
      .filter((s) => s.enregistree || s.sautee || recorded.has(s.id))
      .map((s) => s.id);
    return new Set([...ids, ...localDone]);
    // queuePending : la file d'envoi se recharge depuis le téléphone après le premier affichage.
  }, [sentences, localDone, queue, queuePending]);
  const current = useMemo(() => sentences.find((s) => !done.has(s.id)), [sentences, done]);

  const [phase, setPhase] = useState<Phase>('pret');
  const [take, setTake] = useState<Take | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [micProblem, setMicProblem] = useState<MicrophoneProblem | null>(null);
  const [skipError, setSkipError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [validatedHere, setValidatedHere] = useState(0);

  const recorder = useRef<Recorder | null>(null);
  const recording = useRef(false);
  const startedAt = useRef(0);
  const player = useRef<HTMLAudioElement | null>(null);

  // Tout est fait : on prévient l'écran parent.
  useEffect(() => {
    if (!current && phase !== 'pause') onFinished();
  }, [current, phase, onFinished]);

  // Libère le micro en quittant l'écran ; garde l'écran allumé pendant la séance.
  useEffect(() => {
    let wakeLock: { release(): Promise<void> } | undefined;
    void (
      navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<typeof wakeLock> } }
    ).wakeLock
      ?.request('screen')
      .then((lock) => (wakeLock = lock))
      .catch(() => {});
    return () => {
      void recorder.current?.close();
      void wakeLock?.release();
    };
  }, []);

  useEffect(() => {
    if (phase !== 'enregistrement') return;
    const timer = setInterval(
      () => setElapsed((performance.now() - startedAt.current) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url);
    },
    [take],
  );

  async function start() {
    setMicProblem(null);
    setSkipError(null);
    stopPlayback();
    setTake(null);
    try {
      if (!recorder.current) {
        setPhase('ouverture');
        recorder.current = await Recorder.open(setLevel);
      }
      startedAt.current = performance.now();
      setElapsed(0);
      recording.current = true;
      recorder.current.start(maxSeconds, () => void stop());
      setPhase('enregistrement');
    } catch (error) {
      setMicProblem(error instanceof MicrophoneError ? error.problem : 'autre');
      setPhase('pret');
    }
  }

  async function stop() {
    const rec = recorder.current;
    // Évite un double arrêt (bouton Stop pile au moment de l'arrêt automatique).
    if (!rec || !recording.current) return;
    recording.current = false;
    setPhase('traitement');
    const raw = await rec.stop();
    const rate = principal ? rec.sampleRate : VARIED_RATE;
    const samples = await resample(raw, rec.sampleRate, rate);
    const metrics = analyzeSamples(samples, rate);
    const problems = clientProblems(metrics, thresholds);
    const wav = encodeWav(samples, rate);
    if (problems.length > 0) setFailedAttempts((n) => n + 1);
    setTake({
      wav,
      url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })),
      metrics,
      problems,
    });
    setPhase('resultat');
  }

  function togglePlayback() {
    if (!take) return;
    if (player.current && !player.current.paused) return stopPlayback();
    player.current = new Audio(take.url);
    void player.current.play();
  }

  function stopPlayback() {
    player.current?.pause();
    player.current = null;
  }

  async function validate(override = false) {
    if (!take || !current || !recorder.current) return;
    stopPlayback();
    const m = take.metrics;
    await queue.add({
      id: newUuid(),
      token,
      sentenceId: current.id,
      wav: new Blob([take.wav], { type: 'audio/wav' }),
      metrics: {
        duree_ms: Math.round(m.durationMs),
        voix_dbfs: round(m.speechRmsDbfs),
        bruit_dbfs: round(m.noiseDbfs),
        saturation: m.clippedRatio,
        silence_avant_ms: Math.round(m.leadingSilenceMs),
        silence_apres_ms: Math.round(m.trailingSilenceMs),
        problemes: take.problems,
        valide_quand_meme: override,
      },
      mic: recorder.current.micSettings,
      createdAt: Date.now(),
    });
    next(current.id, validatedHere + 1);
  }

  async function skip() {
    if (!current) return;
    stopPlayback();
    try {
      await api.post('/voix/sauter', { phrase_id: current.id });
      next(current.id, validatedHere);
    } catch (error) {
      setSkipError(isOffline(error) ? t('enregistrement.sauter_hors_ligne') : t('erreur.interne'));
    }
  }

  function next(sentenceId: number, validatedCount: number) {
    setLocalDone((previous) => new Set(previous).add(sentenceId));
    setTake(null);
    setFailedAttempts(0);
    setValidatedHere(validatedCount);
    const pause = mode === 'lot' && validatedCount > 0 && validatedCount % pauseEvery === 0;
    setPhase(pause ? 'pause' : 'pret');
  }

  if (phase === 'pause') {
    return (
      <main className="page centre-vertical">
        <span className="grande-icone">
          <Icon name="valider" size={56} />
        </span>
        <h1>{t('enregistrement.pause_titre')}</h1>
        <p>{t('enregistrement.pause_texte')}</p>
        <button onClick={() => setPhase('pret')}>{t('commun.continuer')}</button>
      </main>
    );
  }
  if (!current) return null;

  const position = sentences.filter((s) => done.has(s.id)).length + 1;
  const progressKey: TextKey =
    mode === 'test'
      ? 'enregistrement.test'
      : mode === 'refaire'
        ? 'enregistrement.a_refaire'
        : 'enregistrement.progression';
  const canOverride =
    (take?.problems.length ?? 0) > 0 && failedAttempts >= ATTEMPTS_BEFORE_OVERRIDE;

  return (
    <main className="page ecran-enregistrement">
      <div className="progression">
        <span>{t(progressKey, { n: position, total: sentences.length })}</span>
        <progress max={sentences.length} value={position - 1} />
      </div>

      <p className="aide">{t('enregistrement.lisez')}</p>
      <p className="phrase" lang="dje">
        {current.texte}
      </p>

      <LevelMeter rms={level} active={phase === 'enregistrement'} />

      {phase !== 'resultat' ? (
        <div className="centre">
          {phase === 'enregistrement' ? (
            <button
              className="bouton-rond stop"
              onClick={() => void stop()}
              aria-label={t('enregistrement.en_cours')}
            >
              <span className="carre" />
            </button>
          ) : (
            <button
              className="bouton-rond"
              onClick={() => void start()}
              disabled={phase !== 'pret'}
              aria-label={t('enregistrement.toucher')}
            >
              <Icon name="micro" size={56} />
            </button>
          )}
          <p className="chrono">
            {phase === 'enregistrement'
              ? `${t('enregistrement.en_cours')} ${Math.floor(elapsed)} / ${maxSeconds} s`
              : phase === 'ouverture'
                ? t('enregistrement.ouverture_micro')
                : phase === 'traitement'
                  ? t('enregistrement.traitement')
                  : t('enregistrement.toucher')}
          </p>
        </div>
      ) : (
        take && (
          <div className="resultat">
            {take.problems.length > 0 ? (
              <p className="message alerte">
                <Icon name="attention" size={24} />{' '}
                {t(`enregistrement.probleme.${take.problems[0]!}` as TextKey)}
              </p>
            ) : (
              <p className="message succes">
                <Icon name="valider" size={24} /> {t('enregistrement.correct')}
              </p>
            )}
            <div className="boutons-resultat">
              <button className="secondaire avec-icone" onClick={togglePlayback}>
                <Icon name="lecture" /> {t('enregistrement.reecouter')}
              </button>
              <button className="secondaire avec-icone" onClick={() => void start()}>
                <Icon name="recommencer" /> {t('enregistrement.recommencer')}
              </button>
              {take.problems.length === 0 && (
                <button className="avec-icone" onClick={() => void validate()}>
                  <Icon name="valider" /> {t('enregistrement.valider')}
                </button>
              )}
            </div>
            {canOverride && (
              <button className="lien" onClick={() => void validate(true)}>
                {t('enregistrement.valider_quand_meme')}
              </button>
            )}
          </div>
        )
      )}

      {micProblem && <MicHelp problem={micProblem} />}
      {skipError && <p className="message erreur">{skipError}</p>}

      {mode === 'lot' && phase !== 'enregistrement' && (
        <button className="lien" onClick={() => void skip()}>
          {t('enregistrement.ne_peux_pas_lire')}
        </button>
      )}
    </main>
  );
}

/** Marche à suivre quand le micro est bloqué ou absent (spec §10). */
function MicHelp({ problem }: { problem: MicrophoneProblem }) {
  const t = useT();
  if (problem !== 'refuse') {
    return <p className="message erreur">{t(`micro.${problem}` as TextKey)}</p>;
  }
  return (
    <div className="message erreur">
      <p>
        <strong>{t('micro.refuse_titre')}</strong>
      </p>
      <p>{t('micro.refuse_android')}</p>
      <p>{t('micro.refuse_iphone')}</p>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
