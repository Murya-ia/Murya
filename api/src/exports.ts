// Téléchargement des exports (spec §5.9). L'archive peut peser plusieurs Go : le navigateur
// la télécharge directement par un lien, sans en-tête de session. L'API donne donc à un admin
// un lien SIGNÉ, valable 15 minutes, puis sert le fichier depuis le bucket des exports.

import { Hono } from 'hono';
import type { Env } from './env';
import { hmacHex, safeEqual } from './util';

/** Fichiers d'un export, et nom proposé au téléchargement. */
export const EXPORT_FILES = ['README.md', 'metadata.csv', 'metadata.jsonl', 'archive.zip'] as const;
export type ExportFile = (typeof EXPORT_FILES)[number];

/** Durée de validité d'un lien de téléchargement. */
export const DOWNLOAD_URL_SECONDS = 15 * 60;

const CONTENT_TYPES: Record<ExportFile, string> = {
  'README.md': 'text/markdown; charset=utf-8',
  'metadata.csv': 'text/csv; charset=utf-8',
  'metadata.jsonl': 'application/x-ndjson; charset=utf-8',
  'archive.zip': 'application/zip',
};

export function isExportFile(value: unknown): value is ExportFile {
  return EXPORT_FILES.includes(value as ExportFile);
}

// Clé de signature dérivée de la clé secrète Supabase : aucun secret de plus à gérer.
const signature = (env: Env, message: string) =>
  hmacHex(env.SUPABASE_SECRET_KEY, 'exports', message);

/** Lien signé vers un fichier d'export (`location` : dossier dans le bucket). */
export async function signedDownloadUrl(
  env: Env,
  origin: string,
  location: string,
  file: ExportFile,
  now = Date.now(),
): Promise<string> {
  const expires = Math.floor(now / 1000) + DOWNLOAD_URL_SECONDS;
  const url = new URL(`/telechargement/${file}`, origin);
  url.searchParams.set('dossier', location);
  url.searchParams.set('exp', String(expires));
  url.searchParams.set('sig', await signature(env, `${location}/${file}/${expires}`));
  return url.toString();
}

export const downloads = new Hono<{ Bindings: Env }>();

downloads.get('/:fichier', async (c) => {
  const file = c.req.param('fichier');
  const location = c.req.query('dossier') ?? '';
  const expires = Number(c.req.query('exp'));
  const sig = c.req.query('sig') ?? '';
  if (!isExportFile(file) || !/^[a-z]+\/[a-z]+\/v\d{3,}$/.test(location)) {
    return c.json({ erreur: 'introuvable' }, 404);
  }
  if (!safeEqual(sig, await signature(c.env, `${location}/${file}/${expires}`))) {
    return c.json({ erreur: 'lien_invalide' }, 403);
  }
  if (!(expires * 1000 > Date.now())) return c.json({ erreur: 'lien_expire' }, 410);

  const object = await c.env.EXPORTS.get(`${location}/${file}`);
  if (!object) return c.json({ erreur: 'introuvable' }, 404);
  const name = `murya-${location.replaceAll('/', '-')}-${file}`;
  return new Response(object.body, {
    headers: {
      'Content-Type': CONTENT_TYPES[file],
      'Content-Length': String(object.size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
