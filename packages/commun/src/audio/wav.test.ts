import { describe, expect, it } from 'vitest';
import { decodeWavPcm16, encodeWav, parseWavHeader } from './wav';

describe('encodeWav', () => {
  it('écrit un en-tête WAV PCM 16 bits mono valide', () => {
    const bytes = encodeWav(new Float32Array(16_000), 16_000); // 1 seconde
    const info = parseWavHeader(bytes);
    expect(info).toMatchObject({
      audioFormat: 1,
      channels: 1,
      sampleRate: 16_000,
      bitsPerSample: 16,
      dataOffset: 44,
      dataBytes: 32_000,
      durationMs: 1000,
    });
    expect(bytes.byteLength).toBe(44 + 32_000); // ~32 Ko par seconde, comme prévu par la spec
  });

  it('borne les valeurs hors de [-1, 1] au lieu de déborder', () => {
    const bytes = encodeWav(Float32Array.from([2, -2, 1, -1, 0]), 16_000);
    const view = new DataView(bytes.buffer, 44);
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(i * 2, true))).toEqual([
      32767, -32768, 32767, -32768, 0,
    ]);
  });

  it('se relit à l’identique (à la précision 16 bits près)', () => {
    const original = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10) * 0.5);
    const { samples, info } = decodeWavPcm16(encodeWav(original, 48_000));
    expect(info.sampleRate).toBe(48_000);
    expect(samples.length).toBe(original.length);
    samples.forEach((s, i) => expect(s).toBeCloseTo(original[i]!, 4));
  });
});

describe('parseWavHeader', () => {
  it('refuse un fichier qui n’est pas un WAV', () => {
    expect(() => parseWavHeader(new TextEncoder().encode('bonjour, ceci est du texte'))).toThrow(
      'Pas un fichier WAV',
    );
  });

  it('saute les blocs supplémentaires entre « fmt » et « data »', () => {
    const plain = encodeWav(new Float32Array(100), 16_000);
    // On insère un bloc « LIST » de 4 octets après le bloc « fmt » (qui finit à l'octet 36).
    const extra = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4]);
    const withList = new Uint8Array(plain.byteLength + extra.byteLength);
    withList.set(plain.subarray(0, 36), 0);
    withList.set(extra, 36);
    withList.set(plain.subarray(36), 36 + extra.byteLength);

    const info = parseWavHeader(withList);
    expect(info.dataOffset).toBe(44 + extra.byteLength);
    expect(info.dataBytes).toBe(200);
  });

  it('calcule la durée réelle d’un fichier tronqué', () => {
    const bytes = encodeWav(new Float32Array(16_000), 16_000).subarray(0, 44 + 16_000);
    expect(parseWavHeader(bytes).durationMs).toBe(500);
  });
});
