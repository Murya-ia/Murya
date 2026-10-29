// Filme video.html image par image (30 images/s) avec Chrome, puis écrit le calage des voix.
//   node filmer.cjs                  toute la vidéo → images/
//   node filmer.cjs --apercu 3,20,45 quelques images seulement → apercu/ (pour vérifier)
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = createRequire(path.join(__dirname, '../../../package.json'))(
  '@playwright/test',
);

const DIR = __dirname;
const ROOT = path.join(DIR, '../../..');
const FPS = 30;

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  // Logo officiel et police Manrope, pris directement dans le projet.
  const paths = fs.readFileSync(path.join(ROOT, 'packages/commun/src/logo-paths.ts'), 'utf8');
  const get = (name) => paths.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`))[1];
  const logo = {
    sv: get('SYMBOL_VIEWBOX'),
    sp: get('SYMBOL_PATH'),
    wv: get('WORDMARK_VIEWBOX'),
    wp: get('WORDMARK_PATH'),
  };
  fs.copyFileSync(
    path.join(
      ROOT,
      'node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2',
    ),
    path.join(DIR, 'manrope.woff2'),
  );
  const json = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
  await page.addInitScript(
    `window.LOGO = ${JSON.stringify(logo)}; window.ECRANS = ${json('ecrans.json')};` +
      `window.TEXTES = ${json('textes.json')}; window.DUREES = ${json('durees.json')};`,
  );
  await page.goto('file:///' + path.join(DIR, 'video.html').replaceAll('\\', '/'));
  await page.evaluate(() => document.fonts.ready);
  // Toutes les captures chargées avant de filmer.
  await page.evaluate(() =>
    Promise.all(
      [...document.images].map((i) => (i.complete ? null : i.decode().catch(() => null))),
    ),
  );
  await page.evaluate(() => new Promise((r) => setTimeout(r, 500)));
  const total = await page.evaluate(() => window.TOTAL);
  const voix = await page.evaluate(() => window.VOIX);
  fs.writeFileSync(path.join(DIR, 'voix.json'), JSON.stringify({ total, voix }, null, 1));

  const i = process.argv.indexOf('--apercu');
  if (i > 0) {
    const out = path.join(DIR, 'apercu');
    fs.mkdirSync(out, { recursive: true });
    for (const t of process.argv[i + 1].split(',').map(Number)) {
      await page.evaluate((x) => window.seek(x), t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      await page.screenshot({
        path: path.join(out, `t${String(t).replace('.', '_')}.jpg`),
        type: 'jpeg',
        quality: 85,
      });
    }
    console.log(`aperçu : ${process.argv[i + 1]} (durée totale ${total.toFixed(1)} s)`);
    await browser.close();
    return;
  }

  const out = path.join(DIR, 'images');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const last = Math.round(total * FPS);
  for (let f = 0; f < last; f++) {
    await page.evaluate((x) => window.seek(x), f / FPS);
    await page.screenshot({
      path: path.join(out, `${String(f).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: 90,
    });
    if (f % 300 === 0) console.log(`${(f / FPS).toFixed(0)} s / ${total.toFixed(0)} s`);
  }
  await browser.close();
  console.log(`terminé : ${last} images, durée ${total.toFixed(1)} s`);
})();
