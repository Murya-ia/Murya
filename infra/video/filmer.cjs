// Filme video.html image par image (30 images/s) avec Chrome, puis écrit le calage des voix.
//   node filmer.cjs [debut_s fin_s]   (sans arguments : toute la vidéo)
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = createRequire(path.join(__dirname, '../../package.json'))('@playwright/test');

const DIR = __dirname;
// Images et fichiers de travail : dans le dossier « travail » (ignoré par Git).
const FPS = 30;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  // Logo officiel et police Manrope, pris directement dans le projet.
  const ROOT = path.join(DIR, '../..');
  const paths = fs.readFileSync(path.join(ROOT, 'packages/commun/src/logo-paths.ts'), 'utf8');
  const get = (name) => paths.match(new RegExp(`${name}\s*=\s*'([^']+)'`))[1];
  const logo = JSON.stringify({
    sv: get('SYMBOL_VIEWBOX'),
    sp: get('SYMBOL_PATH'),
    wv: get('WORDMARK_VIEWBOX'),
    wp: get('WORDMARK_PATH'),
  });
  fs.copyFileSync(
    path.join(
      ROOT,
      'node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2',
    ),
    path.join(DIR, 'manrope.woff2'),
  );
  const durees = fs.readFileSync(path.join(DIR, 'durees.json'), 'utf8');
  await page.addInitScript(`window.LOGO = ${logo}; window.DUREES = ${durees};`);
  await page.goto('file:///' + path.join(DIR, 'video.html').replaceAll('\\', '/'));
  await page.evaluate(() => document.fonts.ready);
  const total = await page.evaluate(() => window.TOTAL);
  const voix = await page.evaluate(() => window.VOIX);
  fs.writeFileSync(path.join(DIR, 'voix.json'), JSON.stringify({ total, voix }, null, 1));

  const from = Number(process.argv[2] ?? 0);
  const to = Number(process.argv[3] ?? total);
  const out = path.join(DIR, 'images');
  fs.mkdirSync(out, { recursive: true });
  const first = Math.round(from * FPS);
  const last = Math.round(to * FPS);
  for (let i = first; i < last; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    await page.screenshot({
      path: path.join(out, `${String(i).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: 92,
    });
    if (i % 150 === 0) console.log(`${(i / FPS).toFixed(1)} s / ${total.toFixed(1)} s`);
  }
  await browser.close();
  console.log(`terminé : ${last - first} images, durée totale ${total.toFixed(1)} s`);
})();
