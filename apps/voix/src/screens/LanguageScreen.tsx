// Choix de la langue de l'interface (spec §3.1) : zarma proposé en premier.
// Pas de phrase ici : la personne n'a pas encore choisi sa langue. Les noms des langues suffisent.

import { Logo } from '@murya/commun/logo';
import type { UiLanguage } from '../i18n/i18n';

export function LanguageScreen({ onChoose }: { onChoose: (language: UiLanguage) => void }) {
  return (
    <main className="page centre-vertical">
      <Logo size={56} />
      <button className="choix-langue" lang="dje" onClick={() => onChoose('dje')}>
        Zarma
      </button>
      <button className="choix-langue secondaire" lang="fr" onClick={() => onChoose('fr')}>
        Français
      </button>
    </main>
  );
}
