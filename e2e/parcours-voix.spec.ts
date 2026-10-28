// Parcours complet d'une voix (spec §3) : lien d'invitation → langue → accord → fiche →
// tutoriel → test de 5 phrases enregistrées au micro → envoi → attente de l'équipe.
// Le faux serveur ci-dessous joue le rôle de l'API et de R2, et garde ce qu'il reçoit.

import { expect, test, type Page, type Route } from '@playwright/test';

const TOKEN = 'E2eJetonDessai_0123456789abcdefghijklmnopqr'; // 43 caractères
const TEST_SENTENCES = [1, 2, 3, 4, 5].map((n) => ({
  id: n,
  code: `TEST0${n}`,
  texte: `Phrase de test numéro ${n}.`,
  version: 1,
}));

interface Server {
  consent: Record<string, unknown> | null;
  profile: Record<string, unknown> | null;
  tutorial: boolean;
  deposits: string[];
  confirmed: Record<string, unknown>[];
  authorizations: Set<string>;
}

async function fakeServer(page: Page): Promise<Server> {
  const server: Server = {
    consent: null,
    profile: null,
    tutorial: false,
    deposits: [],
    confirmed: [],
    authorizations: new Set(),
  };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(body),
    });

  await page.route('https://r2.essai/**', async (route) => {
    if (route.request().method() === 'PUT') server.deposits.push(route.request().url());
    await route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
  });

  await page.route('https://api.essai/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Allow-Methods': 'GET, POST',
        },
      });
    }
    server.authorizations.add(request.headers()['authorization'] ?? '');
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON() as Record<string, unknown> | null;
    const recorded = new Set(server.confirmed.map((c) => c.phrase_id));

    switch (path) {
      case '/voix/session':
        return json(route, {
          langue: 'dje',
          consentement: {
            id: 1,
            version: 1,
            points: ['enregistrement', 'majeur'],
            textes: {
              fr: {
                intro: 'Accord de test.',
                points: { enregistrement: 'J’accepte d’être enregistré.', majeur: 'J’ai 18 ans.' },
              },
            },
            audios: {},
          },
          reglages: { verifications: null, duree_max_s: 20, pause_toutes: 50 },
          voix: server.consent && {
            numero: 'V042',
            statut: recorded.size >= 5 ? 'test_en_attente' : 'inscrite',
            consentement_a_jour: true,
            rappel_requis: false,
            fiche_remplie: server.profile !== null,
            tutoriel_vu: server.tutorial,
            message_test: null,
            principale: false,
          },
        });
      case '/voix/consentement':
        server.consent = body;
        return json(route, { ok: true });
      case '/voix/fiche':
        server.profile = body;
        return json(route, { ok: true });
      case '/voix/tutoriel':
        server.tutorial = true;
        return json(route, { ok: true });
      case '/voix/phrases':
        return recorded.size >= 5
          ? json(route, { etape: 'attente', phrases: [] })
          : json(route, {
              etape: 'test',
              phrases: TEST_SENTENCES.map((s) => ({ ...s, enregistree: recorded.has(s.id) })),
            });
      case '/voix/envoi/preparer':
        return json(route, {
          url: `https://r2.essai/dje/varie/V042/${String(body?.id)}.wav`,
          cle: `dje/varie/V042/${String(body?.id)}.wav`,
          prise: 1,
          deja_recu: false,
          jeton_envoi: `jeton-${String(body?.id)}`,
        });
      case '/voix/envoi/confirmer':
        server.confirmed.push(body ?? {});
        return json(route, {
          statut_voix: server.confirmed.length >= 5 ? 'test_en_attente' : 'inscrite',
          deja_recu: false,
        });
      default:
        return json(route, { erreur: 'introuvable' }, 404);
    }
  });
  return server;
}

/** Enregistre la phrase affichée : enregistrer, parler (2 s comptées), arrêter, valider. */
async function recordSentence(page: Page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    // Premier essai : le gros bouton ; ensuite, « Recommencer » relance l'enregistrement.
    await (
      attempt === 0
        ? page.getByRole('button', { name: 'Touchez pour enregistrer' })
        : page.getByRole('button', { name: 'Recommencer' })
    ).click();
    await expect(page.getByText(/Parlez maintenant… [2-9] \//)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Parlez maintenant…' }).click();
    const validate = page.getByRole('button', { name: 'Valider', exact: true });
    const anyway = page.getByRole('button', { name: 'Valider quand même' });
    const again = page.getByRole('button', { name: 'Recommencer' });
    await expect(validate.or(again).first()).toBeVisible();
    if (await validate.isVisible()) return validate.click();
    if (await anyway.isVisible()) return anyway.click();
  }
  throw new Error('enregistrement refusé à chaque essai');
}

test("parcours d'une nouvelle voix, du lien jusqu'à l'envoi du test", async ({ page }) => {
  const server = await fakeServer(page);
  await page.goto(`/i/${TOKEN}`);

  // Le jeton quitte aussitôt la barre d'adresse.
  await expect(page).toHaveURL('http://localhost:5173/');
  await page.getByRole('button', { name: 'Français' }).click();

  // Accord : bouton désactivé tant que tout n'est pas coché et le nom rempli.
  await expect(page.getByRole('heading', { name: 'Votre accord' })).toBeVisible();
  const accept = page
    .getByRole('button', { name: 'J’accepte' })
    .or(page.getByRole('button', { name: "J'accepte" }));
  await expect(accept).toBeDisabled();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByLabel('Votre nom').fill('Essai Bout-en-bout');
  await accept.click();

  // Fiche : l'écran s'ouvre en haut de la page.
  await expect(page.getByRole('heading', { name: 'Quelques questions' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByText('Une femme').click();
  await page.getByText('26 à 40 ans').click();
  await page.getByLabel('Région où vous avez grandi').selectOption({ index: 1 });
  await page.getByLabel('Votre langue maternelle').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Tutoriel.
  await expect(page.getByRole('heading', { name: 'Comment bien enregistrer' })).toBeVisible();
  await page
    .getByRole('button', { name: 'J’ai compris' })
    .or(page.getByRole('button', { name: "J'ai compris" }))
    .click();

  // Test : 5 phrases, au micro.
  for (let n = 1; n <= 5; n++) {
    await expect(page.getByText(`Phrase de test numéro ${n}.`)).toBeVisible();
    await recordSentence(page);
  }

  await expect(page.getByRole('heading', { name: 'Merci ! Votre test est terminé.' })).toBeVisible({
    timeout: 30_000,
  });
  await expect.poll(() => server.confirmed.length, { timeout: 30_000 }).toBe(5);

  // Ce que le serveur a reçu.
  expect(server.consent).toMatchObject({
    points: ['enregistrement', 'majeur'],
    nom: 'Essai Bout-en-bout',
  });
  expect(server.profile).toMatchObject({ sexe: 'femme', tranche_age: '26-40' });
  expect(server.deposits).toHaveLength(5);
  // Chaque confirmation renvoie le jeton d'envoi reçu à la préparation (un seul appel à la base).
  for (const confirmation of server.confirmed) {
    expect(confirmation.jeton_envoi).toBe(`jeton-${String(confirmation.id)}`);
  }
  expect(new Set(server.confirmed.map((c) => c.phrase_id))).toEqual(new Set([1, 2, 3, 4, 5]));
  expect([...server.authorizations]).toEqual([`Bearer ${TOKEN}`]);
});
