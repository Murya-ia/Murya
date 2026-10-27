// Appels à l'API (Cloudflare Worker) avec la session du membre connecté. Les droits sont
// toujours vérifiés par la base, avec cette session.

import type { Session } from '@supabase/supabase-js';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

async function call<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${session.access_token}` },
  });
  const data = (await response.json().catch(() => ({}))) as { erreur?: string };
  if (!response.ok) throw new Error(data.erreur ?? `http_${response.status}`);
  return data as T;
}

/** Adresse d'écoute signée (valable 15 minutes) d'un audio. */
export async function audioUrl(session: Session, recordingId: string): Promise<string> {
  if (import.meta.env.DEV && session.access_token === 'demo') {
    return (await import('../demo/audio')).demoAudioUrl();
  }
  return (await call<{ url: string }>(session, `/equipe/audio/${recordingId}`)).url;
}

export function sendOralConsent(session: Session, form: FormData): Promise<{ numero: string }> {
  return call(session, '/equipe/consentement-oral', { method: 'POST', body: form });
}

/** Retrait d'une voix (admins) : la base efface tout, puis l'API efface ses fichiers. */
export async function withdrawSpeaker(
  session: Session,
  speakerId: string,
  confirmation: string,
): Promise<{ numero: string; audios: number; fichiers_effaces: boolean }> {
  if (import.meta.env.DEV && session.access_token === 'demo') {
    return { numero: confirmation, audios: 37, fichiers_effaces: true };
  }
  return call(session, `/equipe/retrait/${speakerId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation }),
  });
}
