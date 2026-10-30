// Accès aux textes et audios du consentement, dans la langue choisie (français par défaut).

import { isUiLanguage, type UiLanguage } from '../i18n/i18n';
import type { ConsentText, Session } from './session';

export function consentText(session: Session, language: UiLanguage): ConsentText {
  const texts = session.consentement?.textes ?? {};
  return texts[language] ?? texts.fr ?? {};
}

/**
 * Audio pré-enregistré par l'équipe. La base peut donner soit une seule adresse (texte
 * complet), soit `{ complet, rappel }`. Absent = pas de bouton « Écouter ».
 * Une voix dont la langue n'a pas encore d'interface traduite (kanouri, tamasheq…) lit le
 * français, mais entend d'abord l'accord dans sa langue.
 */
export function consentAudio(
  session: Session,
  language: UiLanguage,
  which: 'complet' | 'rappel',
): string | undefined {
  const order = isUiLanguage(session.langue) ? [language] : [session.langue, language];
  for (const code of order) {
    const audio = session.consentement?.audios?.[code];
    if (!audio) continue;
    const url =
      typeof audio === 'string' ? (which === 'complet' ? audio : undefined) : audio[which];
    if (url) return url;
  }
  return undefined;
}
