import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from './env';
import { proof } from './routes/proof';
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

// Page de santé (spec §10, observabilité).
app.get('/sante', (c) =>
  c.json({ ok: true, environnement: c.env.ENVIRONMENT, heure: new Date().toISOString() }),
);

app.route('/preuve', proof);

app.notFound((c) => c.json({ erreur: 'introuvable' }, 404));

app.onError((error, c) => {
  // Jamais de donnée personnelle ni de jeton dans les journaux : seulement le message d'erreur.
  console.error(`${c.req.method} ${new URL(c.req.url).pathname} : ${error.message}`);
  return c.json({ erreur: 'erreur_interne' }, 500);
});

export default app;
