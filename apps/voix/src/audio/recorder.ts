// Enregistrement du micro en PCM brut via la Web Audio API (spec §4.1).
// On capture à la fréquence native du téléphone (souvent 48 kHz) ; la conversion
// éventuelle en 16 kHz se fait ensuite (voir resample.ts).

import processorUrl from './capture-processor.ts?worker&url';

/** Son « réel », sans traitement du téléphone (spec §4.1). Certains téléphones ignorent ces demandes :
 * on enregistre donc les réglages réellement appliqués avec chaque audio. */
export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};

export type MicrophoneProblem = 'refuse' | 'absent' | 'non_supporte' | 'autre';

export class MicrophoneError extends Error {
  constructor(readonly problem: MicrophoneProblem) {
    super(`Micro indisponible : ${problem}`);
  }
}

type ProcessorMessage =
  { type: 'level'; rms: number } | { type: 'chunk'; samples: Float32Array } | { type: 'stopped' };

export class Recorder {
  private chunks: Float32Array[] = [];
  private onStopped: (() => void) | null = null;
  private autoStopTimer: ReturnType<typeof setTimeout> | undefined;
  private maxSamples = Infinity;

  private constructor(
    private readonly context: AudioContext,
    private readonly stream: MediaStream,
    private readonly node: AudioWorkletNode,
    onLevel: (rms: number) => void,
  ) {
    node.port.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      const message = event.data;
      if (message.type === 'level') onLevel(message.rms);
      else if (message.type === 'chunk') this.chunks.push(message.samples);
      else this.onStopped?.();
    };
  }

  /** Demande l'accès au micro et prépare la capture. À appeler après un geste de l'utilisateur (iPhone). */
  static async open(onLevel: (rms: number) => void): Promise<Recorder> {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      throw new MicrophoneError('non_supporte');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    } catch (error) {
      const name = (error as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError')
        throw new MicrophoneError('refuse');
      if (name === 'NotFoundError' || name === 'OverconstrainedError')
        throw new MicrophoneError('absent');
      throw new MicrophoneError('autre');
    }

    const context = new AudioContext();
    await context.audioWorklet.addModule(processorUrl);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'murya-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit', // un micro stéréo est ramené en mono
    });
    // Certains navigateurs n'exécutent le processeur que s'il est relié à la sortie :
    // on le relie à travers un volume nul, pour ne rien entendre dans le haut-parleur.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(context.destination);
    await context.resume();
    return new Recorder(context, stream, node, onLevel);
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  /** Réglages réellement appliqués par le téléphone, sans les identifiants d'appareil. */
  get micSettings(): Record<string, unknown> {
    const {
      deviceId: _d,
      groupId: _g,
      ...settings
    } = this.stream.getAudioTracks()[0]?.getSettings() ?? {};
    return settings;
  }

  /** Démarre l'enregistrement ; `onAutoStop` est appelé si la durée maximale est atteinte. */
  start(maxSeconds: number, onAutoStop: () => void): void {
    this.chunks = [];
    this.maxSamples = Math.round(maxSeconds * this.context.sampleRate);
    this.node.port.postMessage('start');
    this.autoStopTimer = setTimeout(onAutoStop, maxSeconds * 1000);
  }

  /** Arrête l'enregistrement et renvoie les échantillons (fréquence : `sampleRate`). */
  stop(): Promise<Float32Array> {
    clearTimeout(this.autoStopTimer);
    return new Promise((resolve) => {
      this.onStopped = () => {
        this.onStopped = null;
        resolve(concat(this.chunks, this.maxSamples));
      };
      this.node.port.postMessage('stop');
    });
  }

  /** Libère le micro (le voyant d'enregistrement du téléphone s'éteint). */
  async close(): Promise<void> {
    clearTimeout(this.autoStopTimer);
    this.stream.getTracks().forEach((track) => track.stop());
    await this.context.close();
  }
}

function concat(chunks: Float32Array[], maxSamples: number): Float32Array {
  const total = Math.min(
    maxSamples,
    chunks.reduce((sum, c) => sum + c.length, 0),
  );
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    const part = chunk.subarray(0, total - offset);
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
