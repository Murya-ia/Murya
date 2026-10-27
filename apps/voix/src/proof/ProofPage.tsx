// Page de preuve audio (J1), réservée à l'équipe : vérifier sur de vrais téléphones que
// « enregistrer → WAV → envoi direct dans R2 » fonctionne, et mesurer ce que chaque
// téléphone produit (fréquence, niveau, réglages du micro) pour régler les seuils du J2.

import { useEffect, useRef, useState } from 'react';
import {
  analyzeSamples,
  clientProblems,
  encodeWav,
  newUuid,
  type AudioMetrics,
  type ClientProblem,
} from '@murya/commun';
import { Logo } from '@murya/commun/logo';
import { MicrophoneError, Recorder, type MicrophoneProblem } from '../audio/recorder';
import { resample } from '../audio/resample';
import { LevelMeter } from '../ui/LevelMeter';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
const MAX_SECONDS = 20;
const CODE_STORAGE_KEY = 'murya-preuve-code';

type Phase = 'pret' | 'ouverture' | 'enregistrement' | 'traitement' | 'enregistre' | 'envoi';
type Mode = 'varie' | 'principale';

interface Take {
  wav: Uint8Array<ArrayBuffer>;
  url: string;
  sampleRate: number;
  metrics: AudioMetrics;
  problems: ClientProblem[];
}

interface UploadResult {
  ok: boolean;
  message: string;
  details?: unknown;
  durationMs?: number;
}

const PROBLEM_TEXT: Record<ClientProblem, string> = {
  trop_court: 'Trop court, recommencez',
  inaudible: 'On ne vous entend pas',
  sature: 'Trop fort, éloignez un peu le téléphone',
  coupe: 'Attendez une seconde avant de parler',
};

const MIC_TEXT: Record<MicrophoneProblem, string> = {
  refuse:
    "L'accès au micro a été refusé. Android : touchez le cadenas à gauche de l'adresse > Autorisations > Micro. iPhone : Réglages > Safari > Micro.",
  absent: 'Aucun micro trouvé sur cet appareil.',
  non_supporte:
    "Ce navigateur ne permet pas d'enregistrer. Essayez Chrome (Android) ou Safari (iPhone).",
  autre:
    "Impossible d'ouvrir le micro. Fermez les autres applications qui l'utilisent et réessayez.",
};

export default function ProofPage() {
  const [code, setCode] = useState(
    () => new URLSearchParams(location.search).get('code') ?? readStored(CODE_STORAGE_KEY) ?? '',
  );
  const [mode, setMode] = useState<Mode>('varie');
  const [phase, setPhase] = useState<Phase>('pret');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [micProblem, setMicProblem] = useState<MicrophoneProblem | null>(null);
  const [copied, setCopied] = useState(false);

  const recorder = useRef<Recorder | null>(null);
  const recording = useRef(false);
  const startedAt = useRef(0);

  // Libère le micro en quittant la page.
  useEffect(() => () => void recorder.current?.close(), []);

  // Chronomètre affiché pendant l'enregistrement.
  useEffect(() => {
    if (phase !== 'enregistrement') return;
    const timer = setInterval(
      () => setElapsed((performance.now() - startedAt.current) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, [phase]);

  // Libère l'ancien fichier audio en mémoire quand on en crée un nouveau.
  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url);
    },
    [take],
  );

  async function startRecording() {
    setMicProblem(null);
    setUpload(null);
    setTake(null);
    try {
      if (!recorder.current) {
        setPhase('ouverture');
        recorder.current = await Recorder.open(setLevel);
      }
      startedAt.current = performance.now();
      setElapsed(0);
      recording.current = true;
      recorder.current.start(MAX_SECONDS, () => void stopRecording());
      setPhase('enregistrement');
    } catch (error) {
      setMicProblem(error instanceof MicrophoneError ? error.problem : 'autre');
      setPhase('pret');
    }
  }

  async function stopRecording() {
    const rec = recorder.current;
    // Évite un double arrêt (bouton Stop pile au moment de l'arrêt automatique).
    if (!rec || !recording.current) return;
    recording.current = false;
    setPhase('traitement');

    const raw = await rec.stop();
    const rate = mode === 'varie' ? 16_000 : rec.sampleRate;
    const samples = await resample(raw, rec.sampleRate, rate);
    const metrics = analyzeSamples(samples, rate);
    const wav = encodeWav(samples, rate);
    setTake({
      wav,
      url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })),
      sampleRate: rate,
      metrics,
      problems: clientProblems(metrics),
    });
    setPhase('enregistre');
  }

  async function send() {
    if (!take) return;
    store(CODE_STORAGE_KEY, code);
    setPhase('envoi');
    const id = newUuid();
    const t0 = performance.now();
    try {
      const { url } = await postJson<{ url: string }>('/preuve/url-envoi', { code, id });
      // Le fichier part directement vers R2, sans passer par l'API.
      const put = await fetch(url, {
        method: 'PUT',
        body: take.wav,
        headers: { 'Content-Type': 'audio/wav' },
      });
      if (!put.ok) throw new Error(`R2 a refusé l'envoi (code ${put.status})`);
      const details = await postJson('/preuve/confirmer', { code, id });
      setUpload({
        ok: true,
        message: 'Reçu et vérifié par le serveur',
        details,
        durationMs: Math.round(performance.now() - t0),
      });
    } catch (error) {
      setUpload({ ok: false, message: (error as Error).message });
    }
    setPhase('enregistre');
  }

  const report = buildReport(recorder.current, mode, take, upload);

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers indisponible : le rapport reste lisible plus bas, à copier à la main.
    }
  }

  const busy = phase === 'ouverture' || phase === 'traitement' || phase === 'envoi';

  return (
    <main className="page">
      <header className="entete">
        <Logo size={32} />
        <span className="etiquette">Preuve audio</span>
      </header>

      <p className="consigne">
        Lisez une phrase à voix haute, par exemple :<br />
        <strong>« Bonjour, je teste l'enregistrement de Murya. »</strong>
      </p>

      <fieldset className="choix" disabled={phase === 'enregistrement' || busy}>
        <legend>Qualité</legend>
        <label>
          <input type="radio" checked={mode === 'varie'} onChange={() => setMode('varie')} /> Voix
          variées (16 kHz)
        </label>
        <label>
          <input
            type="radio"
            checked={mode === 'principale'}
            onChange={() => setMode('principale')}
          />{' '}
          Voix principale (fréquence du téléphone)
        </label>
      </fieldset>

      <LevelMeter rms={level} active={phase === 'enregistrement'} />

      <div className="centre">
        {phase === 'enregistrement' ? (
          <button
            className="bouton-rond stop"
            onClick={() => void stopRecording()}
            aria-label="Stop"
          >
            <span className="carre" />
          </button>
        ) : (
          <button
            className="bouton-rond"
            onClick={() => void startRecording()}
            disabled={busy}
            aria-label="Enregistrer"
          >
            <MicIcon />
          </button>
        )}
        <p className="chrono">
          {phase === 'enregistrement'
            ? `${elapsed.toFixed(1)} s / ${MAX_SECONDS} s`
            : phase === 'ouverture'
              ? 'Ouverture du micro…'
              : phase === 'traitement'
                ? 'Préparation du fichier…'
                : 'Touchez pour enregistrer'}
        </p>
      </div>

      {micProblem && <p className="message erreur">{MIC_TEXT[micProblem]}</p>}

      {take && (
        <section className="carte">
          <audio controls src={take.url} />
          {take.problems.length > 0 ? (
            <p className="message alerte">⚠ {PROBLEM_TEXT[take.problems[0]!]}</p>
          ) : (
            <p className="message succes">✓ Enregistrement correct</p>
          )}
          <MetricsTable take={take} />

          <label htmlFor="code">Code de la page de preuve</label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button onClick={() => void send()} disabled={busy || !code}>
            {phase === 'envoi' ? 'Envoi…' : 'Envoyer au serveur'}
          </button>
          {upload && (
            <p className={`message ${upload.ok ? 'succes' : 'erreur'}`}>
              {upload.ok ? '✓' : '✗'} {upload.message}
              {upload.durationMs !== undefined && ` (${upload.durationMs} ms)`}
            </p>
          )}
        </section>
      )}

      <section className="carte">
        <button className="secondaire" onClick={() => void copyReport()}>
          {copied ? 'Rapport copié ✓' : 'Copier le rapport pour l’équipe'}
        </button>
        <details>
          <summary>Voir le rapport technique</summary>
          <pre>{JSON.stringify(report, null, 2)}</pre>
        </details>
      </section>
    </main>
  );
}

function MetricsTable({ take }: { take: Take }) {
  const m = take.metrics;
  const rows: [string, string][] = [
    ['Durée', `${(m.durationMs / 1000).toFixed(2)} s`],
    ['Fréquence', `${take.sampleRate} Hz`],
    ['Taille', `${Math.round(take.wav.byteLength / 1024)} Ko`],
    ['Niveau de la voix', `${m.speechRmsDbfs.toFixed(1)} dB`],
    ['Bruit de fond', `${m.noiseDbfs.toFixed(1)} dB`],
    ['Saturation', `${(m.clippedRatio * 100).toFixed(2)} %`],
    [
      'Silence avant / après',
      `${Math.round(m.leadingSilenceMs)} / ${Math.round(m.trailingSilenceMs)} ms`,
    ],
  ];
  return (
    <table className="mesures">
      <tbody>
        {rows.map(([name, value]) => (
          <tr key={name}>
            <th>{name}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MicIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
    </svg>
  );
}

/** Rapport à coller dans le groupe de l'équipe : aucun identifiant d'appareil ni donnée personnelle. */
function buildReport(
  rec: Recorder | null,
  mode: Mode,
  take: Take | null,
  upload: UploadResult | null,
) {
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } })
    .connection;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    date: new Date().toISOString(),
    navigateur: navigator.userAgent,
    ecran: `${window.innerWidth}x${window.innerHeight}`,
    reseau: connection?.effectiveType ?? 'inconnu',
    audio_worklet: typeof AudioWorkletNode !== 'undefined',
    frequence_native: rec?.sampleRate ?? null,
    reglages_micro: rec?.micSettings ?? null,
    mode,
    fichier: take && {
      frequence: take.sampleRate,
      octets: take.wav.byteLength,
      duree_ms: Math.round(take.metrics.durationMs),
      voix_dbfs: round(take.metrics.speechRmsDbfs),
      bruit_dbfs: round(take.metrics.noiseDbfs),
      crete: round(take.metrics.peak * 100) / 100,
      saturation: take.metrics.clippedRatio,
      silence_avant_ms: Math.round(take.metrics.leadingSilenceMs),
      silence_apres_ms: Math.round(take.metrics.trailingSilenceMs),
      problemes: take.problems,
    },
    envoi: upload,
  };
}

async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { erreur?: string };
  if (!response.ok) throw new Error(`Serveur : ${data.erreur ?? response.status}`);
  return data as T;
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible (navigation privée) : sans importance ici.
  }
}
