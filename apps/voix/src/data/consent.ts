// Accès aux textes et audios du consentement, dans la langue choisie (français par défaut).

import type { UiLanguage } from '../i18n/i18n';
import type { ConsentText, Session } from './session';

export function consentText(session: Session, language: UiLanguage): ConsentText {
  const texts = session.consentement?.textes ?? {};
  return texts[language] ?? texts.fr ?? {};
}

/**
 * Audio pré-enregistré par l'équipe. La base peut donner soit une seule adresse (texte
 * complet), soit `{ complet, rappel }`. Absent = pas de bouton « Écouter ».
 */
export function consentAudio(
  session: Session,
  language: UiLanguage,
  which: 'complet' | 'rappel',
): string | undefined {
  const audio = session.consentement?.audios?.[language];
  if (!audio) return undefined;
  if (typeof audio === 'string') return which === 'complet' ? audio : undefined;
  return audio[which];
}
