// Textes de l'interface en zarma et en français (spec §3.1).
// Les traductions sont dans dje.json et fr.json. Une clé absente en zarma est affichée en
// français : on peut traduire petit à petit sans rien casser. Les voix des autres langues
// (kanouri, tamasheq…) ont l'interface en français et l'accord à écouter dans leur langue,
// jusqu'à ce que l'interface soit traduite (ajouter alors kby.json, ttq.json…).

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import dje from './dje.json';
import fr from './fr.json';

export type UiLanguage = 'dje' | 'fr';

export function isUiLanguage(code: string): code is UiLanguage {
  return code === 'dje' || code === 'fr';
}

/**
 * Langues d'interface proposées à une voix : sa langue si l'interface y est traduite, puis le
 * français. Une seule (le français) : pas besoin de choisir.
 */
export function uiLanguagesFor(voiceLanguage: string): UiLanguage[] {
  return isUiLanguage(voiceLanguage) && voiceLanguage !== 'fr' ? [voiceLanguage, 'fr'] : ['fr'];
}
export type TextKey = keyof typeof fr;

const DICTIONARIES: Record<UiLanguage, Partial<Record<TextKey, string>>> = { dje, fr };

export function translate(
  language: UiLanguage,
  key: TextKey,
  vars: Record<string, string | number> = {},
): string {
  const text = DICTIONARIES[language][key] ?? fr[key];
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''));
}

const LanguageContext = createContext<UiLanguage>('dje');

export function LanguageProvider({
  language,
  children,
}: {
  language: UiLanguage;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): UiLanguage {
  return useContext(LanguageContext);
}

/** `const t = useT(); t('fiche.titre')` */
export function useT() {
  const language = useLanguage();
  return (key: TextKey, vars?: Record<string, string | number>) => translate(language, key, vars);
}
