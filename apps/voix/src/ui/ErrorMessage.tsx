// Message d'erreur simple, avec une icône, à partir d'une erreur de l'API ou du réseau.

import { ApiError } from '../data/api';
import { isOffline } from '../data/session';
import { useT, type TextKey } from '../i18n/i18n';
import { Icon } from './icons';

export function errorKey(error: unknown): TextKey {
  if (isOffline(error)) return 'erreur.reseau';
  if (error instanceof ApiError) {
    const key = `erreur.${error.code}` as TextKey;
    if (
      key === 'erreur.lien_inconnu' ||
      key === 'erreur.lien_expire' ||
      key === 'erreur.lien_revoque' ||
      key === 'erreur.trop_de_requetes'
    ) {
      return key;
    }
  }
  return 'erreur.interne';
}

export function ErrorMessage({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  return (
    <p className="message erreur" role="alert">
      <Icon name={isOffline(error) ? 'hors_ligne' : 'attention'} size={22} /> {t(errorKey(error))}
    </p>
  );
}
