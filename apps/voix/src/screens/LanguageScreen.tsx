// Choix de la langue de l'interface (spec §3.1) : la langue de la voix proposée en premier,
// puis le français.
// Pas de phrase ici : la personne n'a pas encore choisi sa langue. Les noms des langues suffisent.

import { Logo } from '@murya/commun/logo';
import type { UiLanguage } from '../i18n/i18n';

const NAMES: Record<UiLanguage, string> = { dje: 'Zarma', fr: 'Français' };

export function LanguageScreen({
  options,
  onChoose,
}: {
  options: UiLanguage[];
  onChoose: (language: UiLanguage) => void;
}) {
  return (
    <main className="page centre-vertical">
      <Logo size={56} />
      {options.map((language, i) => (
        <button
          key={language}
          className={`choix-langue${i > 0 ? ' secondaire' : ''}`}
          lang={language}
          onClick={() => onChoose(language)}
        >
          {NAMES[language]}
        </button>
      ))}
    </main>
  );
}
