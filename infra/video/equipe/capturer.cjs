// Captures des vraies pages de l'espace équipe, pour la vidéo de présentation. Elles sont
// prises en mode démo (données d'exemple : aucune vraie voix, aucun vrai nom), au format
// téléphone, avec la position des éléments que la vidéo met en valeur.
//   1. lancer l'espace équipe : npm run dev:equipe   (http://localhost:5174)
//   2. depuis ce dossier : node capturer.cjs
// Résultat : ecrans/*.png et ecrans.json (taille et zones de chaque capture).
const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = createRequire(path.join(__dirname, '../../../package.json'))(
  '@playwright/test',
);

const URL = process.env.URL ?? 'http://localhost:5174';
const OUT = path.join(__dirname, 'ecrans');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const info = {};

  /** Capture de l'écran visible + zones (en pixels CSS) des éléments demandés. */
  async function shot(page, name, zones = {}) {
    await wait(500);
    const viewport = page.viewportSize();
    const rects = {};
    for (const [key, selector] of Object.entries(zones)) {
      rects[key] = await page.evaluate((sel) => {
        const e = typeof sel === 'string' ? document.querySelector(sel) : null;
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }, selector);
      if (!rects[key])
        console.warn(`  ! ${name} : élément introuvable pour « ${key} » (${selector})`);
    }
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    info[name] = { w: viewport.width, h: viewport.height, zones: rects };
    console.log(`✓ ${name}`);
  }

  const go = async (page, to) => {
    await page.evaluate((p) => {
      history.pushState({}, '', p);
      dispatchEvent(new PopStateEvent('popstate'));
    }, to);
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(1200);
  };
  const click = async (page, selector) => {
    await page.locator(selector).first().click();
    await wait(700);
  };

  // ------------------------------------------------------------------ téléphone
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-FR',
    timezoneId: 'Africa/Niamey',
  });

  // Écran de chargement (celui d'index.html, avant l'appli).
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      javaScriptEnabled: false,
    });
    const page = await ctx.newPage();
    await page.goto(URL);
    await shot(page, 'chargement', { logo: '.demarrage-logo' });
    await ctx.close();
  }

  // Page de connexion (sans mode démo). Rien n'est tapé.
  {
    const page = await phone.newPage();
    await page.goto(URL);
    await wait(1500);
    await shot(page, 'connexion', { formulaire: 'form' });
    await page.close();
  }

  const page = await phone.newPage();
  await page.goto(`${URL}/?demo`);
  await wait(2000);

  await shot(page, 'accueil', {
    principal: '.bloc-principal',
    afaire: '.accueil-grille .liste-lignes',
    tdb: '.carte-lien',
    menu: '.menu-bas',
    compte: 'button.compte',
  });
  await click(page, 'button.compte');
  await shot(page, 'compte', {
    feuille: '.feuille',
    deconnexion: '.feuille .boutons-pleins button',
  });
  await click(page, '.feuille .boutons-pleins button.secondaire');
  await shot(page, 'deconnexion', { feuille: '.feuille' });
  await click(page, '.feuille .boutons-pleins button.secondaire');
  await click(page, '.menu-bas button');
  await shot(page, 'plus', { feuille: '.feuille' });
  await page.keyboard.press('Escape');
  await wait(400);

  // Voix (recruteurs).
  await go(page, '/voix');
  await shot(page, 'voix', {
    inviter: 'button.bouton-ajout',
    onglets: '.segments',
    filtres: '.filtres',
    ligne: 'table tbody tr',
  });
  await click(page, 'button.bouton-ajout');
  await page.fill('#libelle', 'Fati');
  await click(page, 'form.ligne-formulaire button[type=submit]');
  await page.waitForSelector('.lien-cree', { timeout: 8000 });
  await shot(page, 'invitation', { formulaire: 'form.ligne-formulaire', lien: '.lien-cree' });
  await click(page, 'button.bouton-ajout');
  await page
    .locator('button', { hasText: 'Écouter puis répéter' })
    .first()
    .scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 160));
  await shot(page, 'voix-repeter', {
    repeter: 'button[title*="ne lit pas"]',
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await click(page, 'button:has-text("Écouter le test")');
  await page.locator('.panneau').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const p = document.querySelector('.panneau');
    window.scrollTo(0, window.scrollY + p.getBoundingClientRect().top - 90);
  });
  await shot(page, 'test', { panneau: '.panneau' });
  // Le bas de la fenêtre : message et décision.
  await page.evaluate(() => {
    const p = document.querySelector('.panneau');
    window.scrollTo(
      0,
      window.scrollY + p.getBoundingClientRect().bottom - window.innerHeight + 140,
    );
  });
  await shot(page, 'test-decision', { boutons: '.panneau .boutons' });
  await go(page, '/voix');
  await click(page, '.segments button:nth-child(2)');
  await shot(page, 'principale', { carte: '.contenu .carte' });

  // Écoute (vérificateurs, responsable qualité).
  await go(page, '/ecoute');
  await shot(page, 'ecoute', {
    onglets: '.segments',
    phrase: '.texte-attendu',
    lecteur: '.lecteur',
    mesures: '.mesures',
    decisions: '.decisions',
  });
  await click(page, '.mesures summary');
  await page.locator('.mesures').scrollIntoViewIfNeeded();
  await shot(page, 'ecoute-mesures', { mesures: '.mesures' });
  await go(page, '/');
  await go(page, '/ecoute');
  await click(page, '.decisions button:nth-child(2)');
  await page.locator('.complement').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  await shot(page, 'ecoute-corriger', { complement: '.complement' });
  await go(page, '/ecoute');
  await click(page, '.segments button:nth-child(2)');
  await shot(page, 'doutes', { onglets: '.segments', carte: '.verification' });
  await click(page, '.segments button:nth-child(3)');
  await shot(page, 'double', { onglets: '.segments', carte: '.verification' });

  // Phrases, tableau de bord.
  await go(page, '/phrases');
  await shot(page, 'phrases', { titre: 'h1' });
  await go(page, '/tableau-de-bord');
  await shot(page, 'tableau', { tuiles: '.tuiles' });

  // Admins : membres, activité, exports, journal.
  await go(page, '/membres');
  await shot(page, 'membres', { ajouter: 'button.bouton-ajout', liste: '.liste-lignes' });
  await click(page, '.liste-lignes .ligne:nth-child(2)');
  await click(page, '.feuille .fiche-partie button.secondaire');
  await shot(page, 'membre-fiche', {
    roles: '.feuille .choix-roles',
    mdp: '.feuille .nouveau-mdp',
  });
  await page.keyboard.press('Escape');
  await go(page, '/activite');
  await shot(page, 'activite', { chiffres: '.chiffres-equipe', carte: '.carte-membre' });
  await go(page, '/exports');
  await shot(page, 'exports', { titre: 'h1' });
  await go(page, '/journal');
  await shot(page, 'journal', { titre: 'h1' });

  // ------------------------------------------------------------------ ordinateur
  const desk = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
    locale: 'fr-FR',
    timezoneId: 'Africa/Niamey',
  });
  const dpage = await desk.newPage();
  await dpage.goto(`${URL}/?demo`);
  await wait(2000);
  await shot(dpage, 'ordinateur', { menu: '.navigation', compte: 'button.compte' });

  fs.writeFileSync(path.join(__dirname, 'ecrans.json'), JSON.stringify(info, null, 1));
  await browser.close();
  console.log(`terminé : ${Object.keys(info).length} captures`);
})();
