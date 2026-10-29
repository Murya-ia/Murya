// Fenêtre par-dessus la page : elle monte du bas de l'écran sur téléphone et s'affiche au
// centre sur ordinateur. Échap ou un toucher à côté la ferment. Affichée au niveau de la page
// (portail) : l'en-tête, avec son flou d'arrière-plan, la retiendrait sinon.

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Feuille({
  label,
  onClose,
  centre = false,
  children,
}: {
  /** Nom de la fenêtre pour les lecteurs d'écran. */
  label: string;
  onClose: () => void;
  /** Toujours au centre, même sur téléphone (petite confirmation). */
  centre?: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Dernière version de onClose, sans relancer l'effet (qui remettrait le focus en haut).
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    box.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  return createPortal(
    <div className={`feuille-fond${centre ? ' centre' : ''}`} onClick={onClose}>
      <div
        ref={box}
        className="feuille"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {!centre && <span className="feuille-poignee" aria-hidden="true" />}
        {children}
      </div>
    </div>,
    document.body,
  );
}
