// Génère les icônes des apps à partir du logo officiel (packages/commun/src/logo-paths.ts) :
//   apps/voix/public/icons/*.png  (écran d'accueil du téléphone, PWA)
//   apps/*/public/favicon.svg     (onglet du navigateur)
// À relancer seulement si le logo change :  node scripts/icones.mjs

import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const VERT = '#0F3D2E';
const IVOIRE = '#F7F4EA';

// On relit les tracés dans le module TypeScript pour n'avoir qu'une seule source.
const paths = readFileSync(join(root, 'packages/commun/src/logo-paths.ts'), 'utf8');
const SYMBOL = paths.match(/SYMBOL_PATH =\s*'([^']+)'/)[1];
const [sx, sy, sw, sh] = paths
  .match(/SYMBOL_VIEWBOX = '([^']+)'/)[1]
  .split(' ')
  .map(Number);

/**
 * Icône carrée : symbole ivoire sur fond vert.
 * `zone` = part de l'icône occupée par le symbole (Android découpe les icônes « maskable »
 * en cercle : le symbole doit rester dans les 60 % centraux).
 */
function iconSvg({ zone, rounded }) {
  const size = 1000;
  const scale = (size * zone) / Math.max(sw, sh);
  const x = (size - sw * scale) / 2 - sx * scale;
  const y = (size - sh * scale) / 2 - sy * scale;
  const radius = rounded ? 220 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${VERT}"/>
  <path transform="translate(${x} ${y}) scale(${scale})" fill="${IVOIRE}" fill-rule="evenodd" d="${SYMBOL}"/>
</svg>`;
}

function favicon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sx - 20} ${sy - 20} ${sw + 40} ${sh + 40}">
  <path fill="${VERT}" fill-rule="evenodd" d="${SYMBOL}"/>
</svg>
`;
}

await initWasm(readFileSync(join(root, 'node_modules/@resvg/resvg-wasm/index_bg.wasm')));

function png(svg, width) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
}

const icons = join(root, 'apps/voix/public/icons');
mkdirSync(icons, { recursive: true });
writeFileSync(join(icons, 'icon-192.png'), png(iconSvg({ zone: 0.62, rounded: true }), 192));
writeFileSync(join(icons, 'icon-512.png'), png(iconSvg({ zone: 0.62, rounded: true }), 512));
writeFileSync(
  join(icons, 'icon-maskable-512.png'),
  png(iconSvg({ zone: 0.5, rounded: false }), 512),
);
writeFileSync(
  join(icons, 'apple-touch-icon.png'),
  png(iconSvg({ zone: 0.6, rounded: false }), 180),
);
for (const app of ['voix', 'equipe']) {
  writeFileSync(join(root, 'apps', app, 'public/favicon.svg'), favicon());
}
console.log('Icônes générées.');
