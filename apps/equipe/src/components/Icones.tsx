// Petites icônes au trait (menus, listes). Décoratives : le texte à côté dit toujours ce
// qu'elles représentent.

import type { ReactNode } from 'react';

function Icone({ children, plein = false }: { children: ReactNode; plein?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={plein ? 'currentColor' : 'none'}
      stroke={plein ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconeAccueil = () => (
  <Icone>
    <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
  </Icone>
);

export const IconeVoix = () => (
  <Icone>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icone>
);

export const IconeEcoute = () => (
  <Icone>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <rect x="3" y="14" width="5" height="7" rx="2" />
    <rect x="16" y="14" width="5" height="7" rx="2" />
  </Icone>
);

export const IconePhrases = () => (
  <Icone>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Icone>
);

export const IconeGraphique = () => (
  <Icone>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Icone>
);

export const IconeActivite = () => (
  <Icone>
    <path d="M3 12h4l3-8 4 16 3-8h4" />
  </Icone>
);

export const IconeExports = () => (
  <Icone>
    <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
  </Icone>
);

export const IconeMembres = () => (
  <Icone>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
  </Icone>
);

export const IconeJournal = () => (
  <Icone>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </Icone>
);

export const IconePlus = () => (
  <Icone plein>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </Icone>
);

export const IconeDeconnexion = () => (
  <Icone>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
  </Icone>
);

export const IconeLangue = () => (
  <Icone>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Icone>
);

export const IconeCoche = () => (
  <Icone>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icone>
);

export const Chevron = () => (
  <svg
    className="chevron"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M9 6l6 6-6 6" />
  </svg>
);
