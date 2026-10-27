// Vérifie le poids du premier chargement de l'app de la voix (après `npm run build`).
// Objectif : utilisable en moins de 3 s en 3G (spec §10). Échoue si le budget est dépassé.
//
// On compte index.html + les fichiers JS et CSS qu'il charge directement, compressés en gzip
// (les pages chargées à part, comme la page de preuve, ne comptent pas).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 120;
const dist = join(import.meta.dirname, '..', 'apps', 'voix', 'dist');

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);

const files = ['index.html', ...assets];
let total = 0;
for (const file of files) {
  const size = gzipSync(readFileSync(join(dist, file)), { level: 9 }).byteLength;
  total += size;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} Ko  ${file}`);
}

const totalKb = total / 1024;
console.log(`${totalKb.toFixed(1).padStart(7)} Ko  TOTAL (budget : ${BUDGET_KB} Ko)`);
if (totalKb > BUDGET_KB) {
  console.error(`Budget dépassé de ${(totalKb - BUDGET_KB).toFixed(1)} Ko.`);
  process.exit(1);
}
