// Écran simple : un logo, un message, éventuellement un bouton (erreurs, accueil, attente).

import type { ReactNode } from 'react';
import { Logo } from '@murya/commun/logo';
import { Icon, type IconName } from '../ui/icons';

export function MessageScreen({
  icon,
  title,
  children,
  action,
}: {
  icon?: IconName;
  title?: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="page centre-vertical">
      <Logo size={44} />
      {icon && (
        <span className="grande-icone">
          <Icon name={icon} size={56} />
        </span>
      )}
      {title && <h1>{title}</h1>}
      {children}
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </main>
  );
}
