import { useEffect } from 'react';

/**
 * Remonte en haut de la page quand l'écran change. Sans cela, après un long écran (le
 * consentement, qu'on lit jusqu'en bas pour trouver le bouton), l'écran suivant s'ouvrait
 * déjà défilé tout en bas.
 */
export function useScrollToTop(screen: string): void {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);
}
