import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from './env';
import { processPendingErasures } from './erasure';
import { downloads } from './exports';
import { checkR2Credentials } from './r2';
import { proof } from './routes/proof';
import { team } from './routes/team';
import { voice } from './routes/voice';
import { allowedOrigins } from './util';

const app = new Hono<{ Bindings: Env }>();

app.use('*', (c, next) =>
  cors({
    origin: (origin) => (allowedOrigins(c.env.ALLOWED_ORIGINS).includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  })(c, next),
);
// Le jeton des voix est dans l'URL de l'app : aucun « Referer » ne doit le transmettre ailleurs.
app.use('*', secureHeaders({ referrerPolicy: 'no-referrer' }));

// Routes hors parcours des voix (celles-ci ont leur propre limite, par jeton et par adresse) :
// limite par adresse IP, pour freiner les essais en série et les envois répétés.
const limitByIp: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'inconnue';
  const result = await c.env.RL_TEAM?.limit({ key: ip });
  if (result?.success === false) return c.json({ erreur: 'trop_de_requetes' }, 429);
  await next();
};
for (const path of ['/sante', '/telechargement/*', '/preuve/*', '/equipe/*']) {
  app.use(path, limitByIp);
}

// Page de santé (spec §10, observabilité).
// `/sante?verifier=r2` vérifie en plus les clés R2 (une lecture, sans rien créer).
app.get('/sante', async (c) => {
  const health = { environnement: c.env.ENVIRONMENT, heure: new Date().toISOString() };
  if (c.req.query('verifier') !== 'r2') return c.json({ ok: true, ...health });
  const r2 = await checkR2Credentials(c.env);
  return c.json({ ok: r2 === 'ok', ...health, r2 }, r2 === 'ok' ? 200 : 503);
});

app.route('/telechargement', downloads);
app.route('/preuve', proof);
app.route('/voix', voice);
app.route('/equipe', team);

app.notFound((c) => c.json({ erreur: 'introuvable' }, 404));

app.onError((error, c) => {
  // Jamais de donnée personnelle ni de jeton dans les journaux : seulement le message d'erreur.
  console.error(`${c.req.method} ${new URL(c.req.url).pathname} : ${error.message}`);
  return c.json({ erreur: 'erreur_interne' }, 500);
});

export default {
  fetch: app.fetch,
  // Tâche planifiée (wrangler.toml, « crons ») : reprend les effacements de fichiers en attente.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      processPendingErasures(env).then(({ faites, echecs }) => {
        if (faites || echecs) console.log(`effacements repris : ${faites} faits, ${echecs} échecs`);
      }),
    );
  },
  // Pour les tests : `app.request(chemin, options, env)`.
  request: app.request,
};
