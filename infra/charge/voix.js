// Essai de charge (spec §9) avec k6 : des voix qui ouvrent l'app puis enregistrent leurs
// phrases, comme un vrai téléphone (session, lot, puis pour chaque phrase : préparer l'envoi,
// déposer l'audio dans R2, confirmer).
//
//   k6 run -e API=https://… -e VOIX=500 -e PALIER=5m infra/charge/voix.js
//
// Les jetons des voix d'essai sont lus dans jetons.txt (préparé par preparer.sql).

import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const API = __ENV.API;
const VOICES = Number(__ENV.VOIX || 500);
const HOLD = __ENV.PALIER || '5m';
const TOKENS = open('../../jetons.txt').split('\n').filter(Boolean);

export const options = {
  scenarios: {
    voix: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: VOICES },
        { duration: HOLD, target: VOICES },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Moins de 1 % d'erreurs, et des réponses rapides même au plus fort de la charge.
    http_req_failed: ['rate<0.01'],
    'http_req_duration{etape:session}': ['p(95)<1500'],
    'http_req_duration{etape:preparer}': ['p(95)<1500'],
    'http_req_duration{etape:depot}': ['p(95)<3000'],
    'http_req_duration{etape:confirmer}': ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
};

const uploads = new Counter('audios_envoyes');
const uploadTime = new Trend('envoi_complet_ms', true);

/** 3 secondes de WAV 16 kHz mono 16 bits (un léger bruit), comme un vrai enregistrement. */
function wav(seconds) {
  const samples = 16000 * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset, s) =>
    [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++)
    view.setInt16(44 + i * 2, Math.round((Math.random() - 0.5) * 600), true);
  return buffer;
}
const AUDIO = wav(3);

// État de chaque voix virtuelle (une par « VU ») : son jeton et les phrases qui restent.
let token = null;
let queue = [];

function headers(tag) {
  return {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    tags: { etape: tag },
  };
}

function openApp() {
  const session = http.get(`${API}/voix/session`, headers('session'));
  check(session, { 'session 200': (r) => r.status === 200 });
  const lot = http.get(`${API}/voix/phrases`, headers('phrases'));
  check(lot, { 'phrases 200': (r) => r.status === 200 });
  if (lot.status !== 200) return;
  queue = lot.json('phrases').filter((p) => !p.enregistree && !p.sautee);
}

export default function () {
  if (token === null) {
    token = TOKENS[(exec.vu.idInTest - 1) % TOKENS.length];
    openApp();
    sleep(Math.random() * 5); // les voix n'arrivent pas toutes à la même seconde
  }
  if (queue.length === 0) {
    openApp();
    if (queue.length === 0) return sleep(10);
  }
  const sentence = queue.shift();
  const id = uuidv4();

  // Lire la phrase, enregistrer, réécouter : environ 6 à 10 secondes par phrase.
  sleep(6 + Math.random() * 4);
  const started = Date.now();
  const body = JSON.stringify({ id, phrase_id: sentence.id });
  const prepared = http.post(`${API}/voix/envoi/preparer`, body, headers('preparer'));
  if (!check(prepared, { 'preparer 200': (r) => r.status === 200 })) return;
  const deposit = http.put(prepared.json('url'), AUDIO, {
    headers: { 'Content-Type': 'audio/wav' },
    tags: { etape: 'depot', name: 'depot R2' },
  });
  if (!check(deposit, { 'depot 200': (r) => r.status === 200 })) return;
  const confirmed = http.post(
    `${API}/voix/envoi/confirmer`,
    JSON.stringify({ id, phrase_id: sentence.id, mesures: { essai: true }, micro: {} }),
    headers('confirmer'),
  );
  if (check(confirmed, { 'confirmer 200': (r) => r.status === 200 })) {
    uploads.add(1);
    uploadTime.add(Date.now() - started);
  }
}
