// Essai de diagnostic : les mêmes appels à la base que voix.js, mais envoyés directement à
// Supabase, SANS passer par l'API Cloudflare ni déposer de fichier. Si Supabase tient seul,
// la lenteur vient de l'API ; sinon, de Supabase.
//
//   k6 run -e SUPABASE_URL=… -e SUPABASE_SECRET_KEY=… -e VOIX=500 -e PALIER=5m infra/charge/direct.js

import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import exec from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const URL = __ENV.SUPABASE_URL;
const KEY = __ENV.SUPABASE_SECRET_KEY;
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
  summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
};

const confirmed = new Counter('audios_envoyes');
let hash = null;
let queue = [];

function rpc(fn, args, tag) {
  return http.post(`${URL}/rest/v1/rpc/${fn}`, JSON.stringify(args), {
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    tags: { etape: tag },
  });
}

function openApp() {
  check(rpc('voice_session', { p_token_hash: hash }, 'session'), {
    'session 200': (r) => r.status === 200,
  });
  const lot = rpc('voice_sentences', { p_token_hash: hash }, 'phrases');
  if (lot.status === 200) queue = lot.json('phrases').filter((p) => !p.enregistree);
}

export default function () {
  if (hash === null) {
    hash = crypto.sha256(TOKENS[(exec.vu.idInTest - 1) % TOKENS.length], 'hex');
    openApp();
    sleep(Math.random() * 5);
  }
  if (queue.length === 0) {
    openApp();
    if (queue.length === 0) return sleep(10);
  }
  const sentence = queue.shift();
  const id = uuidv4();
  sleep(6 + Math.random() * 4);
  const prepared = rpc(
    'voice_prepare_upload',
    { p_token_hash: hash, p_recording_id: id, p_sentence_id: sentence.id },
    'preparer',
  );
  if (!check(prepared, { 'preparer 200': (r) => r.status === 200 })) return;
  sleep(1); // le temps du dépôt dans R2
  const done = rpc(
    'voice_confirm_upload',
    {
      p_token_hash: hash,
      p_recording_id: id,
      p_size_bytes: 96044,
      p_duration_ms: 3000,
      p_sample_rate: 16000,
    },
    'confirmer',
  );
  if (check(done, { 'confirmer 200': (r) => r.status === 200 })) confirmed.add(1);
}
