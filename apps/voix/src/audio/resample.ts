// Conversion de fréquence d'échantillonnage (ex. 48 kHz → 16 kHz) dans le navigateur.
// On laisse le moteur audio du navigateur faire le calcul (OfflineAudioContext) :
// il applique le filtrage nécessaire pour éviter les sons parasites (repliement).

export async function resample(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Promise<Float32Array> {
  if (fromRate === toRate || samples.length === 0) return samples;
  const length = Math.ceil((samples.length * toRate) / fromRate);
  const offline = new OfflineAudioContext(1, length, toRate);
  const buffer = offline.createBuffer(1, samples.length, fromRate);
  buffer.getChannelData(0).set(samples);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice();
}
