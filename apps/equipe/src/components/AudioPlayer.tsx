// Lecteur d'un audio de la collecte, avec sa forme d'onde (spec §5.4).
// L'audio est téléchargé une seule fois (adresse signée de 15 min), décodé avec notre propre
// lecteur WAV (packages/commun), puis lu depuis la mémoire du navigateur. Il est amplifié pour
// l'écoute seulement : le fichier gardé dans le stockage reste brut.

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { amplify, decodeWavPcm16, encodeWav, listeningGain } from '@murya/commun';
import { audioUrl } from '../lib/api';
import { useTeam } from '../lib/team';

const BARS = 400;

export interface PlayerControl {
  toggle(): void;
}

export function AudioPlayer({
  recordingId,
  controlRef,
  compact = false,
}: {
  recordingId: string;
  controlRef?: MutableRefObject<PlayerControl | null>;
  compact?: boolean;
}) {
  const { session } = useTeam();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(false);
  const [gain, setGain] = useState(1);

  // Téléchargement et décodage.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setPeaks(null);
    setBlobUrl(null);
    setError(false);
    setProgress(0);
    (async () => {
      try {
        const response = await fetch(await audioUrl(session, recordingId));
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        const { samples, info } = decodeWavPcm16(bytes);
        const factor = listeningGain(samples);
        setGain(factor);
        setPeaks(computePeaks(samples));
        // Version amplifiée pour les haut-parleurs ; l'original n'est pas modifié.
        const playable =
          factor > 1.05 ? encodeWav(amplify(samples, factor), info.sampleRate) : bytes;
        objectUrl = URL.createObjectURL(new Blob([playable], { type: 'audio/wav' }));
        setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [recordingId, session]);

  // Dessin de la forme d'onde et de la position de lecture.
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context || !peaks) return;
    const { width, height } = element;
    const style = getComputedStyle(element);
    context.clearRect(0, 0, width, height);
    const barWidth = width / BARS;
    for (let i = 0; i < BARS; i++) {
      const h = Math.max(2, peaks[i]! * height * 0.95);
      context.fillStyle =
        i / BARS < progress
          ? style.getPropertyValue('--vert')
          : style.getPropertyValue('--bordure');
      context.fillRect(i * barWidth, (height - h) / 2, Math.max(1, barWidth - 1), h);
    }
  }, [peaks, progress]);

  // Suivi fluide de la lecture.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const a = audio.current;
      if (a && a.duration) setProgress(a.currentTime / a.duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function toggle() {
    const a = audio.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  if (controlRef) controlRef.current = { toggle };

  function seek(event: React.MouseEvent<HTMLCanvasElement>) {
    const a = audio.current;
    if (!a || !a.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    a.currentTime = ((event.clientX - rect.left) / rect.width) * a.duration;
    setProgress(a.currentTime / a.duration);
  }

  if (error) return <p className="message erreur">Impossible de charger cet audio.</p>;

  return (
    <div className={`lecteur ${compact ? 'compact' : ''}`}>
      <button
        className="lecture"
        onClick={toggle}
        disabled={!blobUrl}
        aria-label={playing ? 'Pause' : 'Lecture'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      {peaks ? (
        <canvas
          ref={canvas}
          width={800}
          height={compact ? 48 : 96}
          onClick={seek}
          className="onde"
        />
      ) : (
        <div className="onde chargement">Chargement…</div>
      )}
      {gain > 1.05 && !compact && (
        <span className="gain" title="Le fichier d'origine n'est pas modifié">
          Volume ×{Math.round(gain)} pour l'écoute (niveau d'origine {gain > 10 ? 'très ' : ''}bas)
        </span>
      )}
      {blobUrl && (
        <audio
          ref={audio}
          src={blobUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setProgress(1);
          }}
        />
      )}
    </div>
  );
}

/** Amplitude maximale de chaque tranche du son, entre 0 et 1. */
function computePeaks(samples: Float32Array): Float32Array {
  const peaks = new Float32Array(BARS);
  const size = Math.max(1, Math.floor(samples.length / BARS));
  let max = 0;
  for (let i = 0; i < BARS; i++) {
    let peak = 0;
    for (let j = i * size; j < Math.min((i + 1) * size, samples.length); j++) {
      peak = Math.max(peak, Math.abs(samples[j]!));
    }
    peaks[i] = peak;
    max = Math.max(max, peak);
  }
  // Mise à l'échelle : les micros « bruts » enregistrent bas, la forme doit rester lisible.
  if (max > 0) for (let i = 0; i < BARS; i++) peaks[i] = peaks[i]! / max;
  return peaks;
}
