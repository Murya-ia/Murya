// Essais de bout en bout (spec §9) : le parcours complet d'une voix, dans un vrai navigateur,
// avec un micro simulé (un fichier WAV : silence, « voix », silence). L'API est remplacée par
// un faux serveur dans l'essai : on vérifie l'appli, ses écrans et ses envois.
//
//   npx playwright install chromium   (une seule fois)
//   npm run e2e

import { defineConfig, devices } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 3 s de micro simulé à 48 kHz : 0,8 s de silence léger, 1,4 s de « voix », 0,8 s de silence. */
function fakeMicrophone(): string {
  const rate = 48_000;
  const samples = rate * 3;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const voice = t > 0.8 && t < 2.2;
    const value = voice ? 0.3 * Math.sin(2 * Math.PI * 220 * t) : (Math.random() - 0.5) * 0.001;
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  const path = join(tmpdir(), 'murya-micro-essai.wav');
  writeFileSync(path, buffer);
  return path;
}

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Pixel 7'],
    permissions: ['microphone'],
    // En local : le Chrome de l'ordinateur. Dans la CI : le Chromium installé par Playwright.
    channel: process.env.CI ? undefined : 'chrome',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${fakeMicrophone()}`,
      ],
    },
  },
  webServer: {
    command: 'npm run dev -w @murya/voix',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_API_URL: 'https://api.essai' },
  },
});
