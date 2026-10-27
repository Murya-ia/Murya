// Processeur audio (AudioWorklet) : tourne dans un fil séparé, reçoit le son du micro
// par blocs de 128 échantillons, et renvoie au fil principal :
//   - le niveau sonore, en continu (pour la barre qui bouge) ;
//   - les échantillons bruts, seulement pendant l'enregistrement.
// On regroupe les échantillons par paquets d'environ 40 ms pour limiter les messages.

const CHUNK_SIZE = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  private recording = false;
  private chunk = new Float32Array(CHUNK_SIZE);
  private filled = 0;
  private levelSum = 0;
  private levelCount = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<'start' | 'stop'>) => {
      if (event.data === 'start') {
        this.filled = 0;
        this.recording = true;
      } else if (event.data === 'stop') {
        this.recording = false;
        this.flush();
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      const s = input[i]!;
      this.levelSum += s * s;
      if (this.recording) {
        this.chunk[this.filled++] = s;
        if (this.filled === CHUNK_SIZE) this.flush();
      }
    }

    this.levelCount += input.length;
    if (this.levelCount >= CHUNK_SIZE) {
      this.port.postMessage({ type: 'level', rms: Math.sqrt(this.levelSum / this.levelCount) });
      this.levelSum = 0;
      this.levelCount = 0;
    }
    return true; // continuer à recevoir le son
  }

  private flush(): void {
    if (this.filled === 0) return;
    const samples = this.chunk.slice(0, this.filled);
    this.port.postMessage({ type: 'chunk', samples }, [samples.buffer]);
    this.filled = 0;
  }
}

registerProcessor('murya-capture', CaptureProcessor);
