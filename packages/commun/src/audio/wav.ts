// Encodage et lecture de fichiers WAV PCM 16 bits mono.
// Format choisi pour toute la collecte (spec §4) : identique sur tous les navigateurs,
// aucune conversion côté serveur.

const WAV_HEADER_BYTES = 44;

/** Encode des échantillons flottants (entre -1 et 1) en WAV PCM 16 bits mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // taille du bloc « fmt »
  view.setUint16(20, 1, true); // 1 = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // octets par seconde
  view.setUint16(32, 2, true); // octets par échantillon
  view.setUint16(34, 16, true); // bits par échantillon
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(
      WAV_HEADER_BYTES + i * 2,
      s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff),
      true,
    );
  }
  return new Uint8Array(buffer);
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** 1 = PCM entier */
  audioFormat: number;
  dataOffset: number;
  dataBytes: number;
  durationMs: number;
}

/**
 * Lit l'en-tête d'un fichier WAV. Parcourt les blocs un par un, car certains
 * logiciels ajoutent des blocs (« LIST »…) entre « fmt » et « data ».
 * Lève une erreur si le fichier n'est pas un WAV lisible.
 */
export function parseWavHeader(bytes: Uint8Array): WavInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || readAscii(view, 0) !== 'RIFF' || readAscii(view, 8) !== 'WAVE') {
    throw new Error('Pas un fichier WAV');
  }

  let fmt: Pick<WavInfo, 'audioFormat' | 'channels' | 'sampleRate' | 'bitsPerSample'> | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = readAscii(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('Bloc « fmt » manquant avant « data »');
      // On ne compte que ce qui est vraiment présent (fichier tronqué = durée réelle).
      const dataBytes = Math.min(size, bytes.byteLength - body);
      const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
      return {
        ...fmt,
        dataOffset: body,
        dataBytes,
        durationMs: bytesPerSecond > 0 ? Math.round((dataBytes / bytesPerSecond) * 1000) : 0,
      };
    }
    offset = body + size + (size % 2); // les blocs sont alignés sur 2 octets
  }
  throw new Error('Bloc « data » introuvable');
}

/** Relit les échantillons d'un WAV PCM 16 bits mono en flottants (entre -1 et 1). */
export function decodeWavPcm16(bytes: Uint8Array): { samples: Float32Array; info: WavInfo } {
  const info = parseWavHeader(bytes);
  if (info.audioFormat !== 1 || info.bitsPerSample !== 16 || info.channels !== 1) {
    throw new Error('Seul le WAV PCM 16 bits mono est accepté');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataBytes);
  const samples = new Float32Array(Math.floor(info.dataBytes / 2));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return { samples, info };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function readAscii(view: DataView, offset: number): string {
  let text = '';
  for (let i = 0; i < 4; i++) text += String.fromCharCode(view.getUint8(offset + i));
  return text;
}
