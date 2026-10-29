// Les chiffres déjà chargés, gardés en mémoire le temps de la visite : en revenant sur une
// page, ils s'affichent tout de suite, puis se mettent à jour sans bruit dès que la base a
// répondu. Rien n'est écrit sur le téléphone : tout s'efface en fermant l'appli ou en se
// déconnectant.

import { useCallback, useRef, useState } from 'react';

const memory = new Map<string, unknown>();

/**
 * Comme useState, mais la valeur part de la dernière connue pour `key` (undefined la toute
 * première fois). `save` la garde pour la prochaine visite.
 */
export function useMemoire<T>(key: string): [T | undefined, (value: T) => void] {
  const [state, setState] = useState<{ key: string; value: T | undefined }>(() => ({
    key,
    value: memory.get(key) as T | undefined,
  }));
  const current = useRef(key);
  current.current = key;

  // Nouvelle clé (ex. autre période) : on montre tout de suite ce qu'on sait pour elle.
  if (state.key !== key) setState({ key, value: memory.get(key) as T | undefined });

  const save = useCallback(
    (value: T) => {
      memory.set(key, value);
      // Une réponse arrivée trop tard (l'utilisateur a changé de période) n'écrase rien.
      if (current.current === key) setState({ key, value });
    },
    [key],
  );
  return [state.key === key ? state.value : (memory.get(key) as T | undefined), save];
}

/** Garde une valeur chargée à l'avance (ex. le tableau de bord, pendant qu'on est à l'accueil). */
export function garder(key: string, value: unknown): void {
  memory.set(key, value);
}

export function dejaConnu(key: string): boolean {
  return memory.has(key);
}

/** À la déconnexion : le membre suivant sur ce téléphone ne voit rien du précédent. */
export function oublierTout(): void {
  memory.clear();
}
