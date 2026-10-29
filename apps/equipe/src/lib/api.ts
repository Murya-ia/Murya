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

/** Audio de l'accord (admins) : la base vérifie le rôle. */
export async function sendConsentAudio(session: Session, form: FormData): Promise<void> {
  if (import.meta.env.DEV && session.access_token === 'demo') return;
  await call(session, '/equipe/accord-audio', { method: 'POST', body: form });
}

/** Adresse d'écoute (15 min) d'un audio de l'accord. */
export async function consentAudioUrl(
  session: Session,
  versionId: number,
  language: string,
  kind: string,
): Promise<string> {
  if (import.meta.env.DEV && session.access_token === 'demo') {
    return (await import('../demo/audio')).demoAudioUrl();
  }
  const path = `/equipe/accord-audio/${versionId}/${language}/${kind}`;
  return (await call<{ url: string }>(session, path)).url;
}

/** Nouveau membre de l'équipe (admins) : compte de connexion + rôles. */
export async function createMember(
  session: Session,
  member: { email: string; mot_de_passe: string; nom: string; roles: string[] },
): Promise<{ email: string }> {
  if (import.meta.env.DEV && session.access_token === 'demo') {
    return { email: member.email.trim().toLowerCase() };
  }
  return call(session, '/equipe/membres', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(member),
  });
}

export type ExportFile = 'archive.zip' | 'README.md' | 'metadata.csv' | 'metadata.jsonl';

/** Lien de téléchargement signé (15 minutes) d'un fichier d'export (admins). */
export async function exportLink(session: Session, exportId: number, file: ExportFile) {
  if (import.meta.env.DEV && session.access_token === 'demo') {
    throw new Error('demo');
  }
  const { url } = await call<{ url: string }>(session, `/equipe/exports/${exportId}/lien`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fichier: file }),
  });
  return url;
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

/** Nouveau mot de passe d'un membre, donné par un admin (la base vérifie le rôle). */
export async function resetPassword(
  session: Session,
  userId: string,
  password: string,
): Promise<void> {
  if (import.meta.env.DEV && session.access_token === 'demo') return;
  await call(session, `/equipe/membres/${userId}/mot-de-passe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mot_de_passe: password }),
  });
}
