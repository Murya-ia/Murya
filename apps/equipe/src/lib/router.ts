// Navigation entre les pages de l'espace équipe, sans bibliothèque : l'adresse change
// (on peut partager un lien ou utiliser « retour »), la page s'affiche sans rechargement.

import { useEffect, useState } from 'react';

export function navigate(path: string): void {
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  return path;
}
