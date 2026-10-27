// Consentement complet (spec §3.2) : texte versionné, bouton « Écouter », une case par point.
// « J'accepte » n'est actif que si toutes les cases sont cochées (et le nom saisi la première fois).

import { useState, type FormEvent } from 'react';
import { Logo } from '@murya/commun/logo';
import type { Api } from '../data/api';
import { consentAudio, consentText } from '../data/consent';
import type { Session } from '../data/session';
import { useLanguage, useT } from '../i18n/i18n';
import { ListenButton } from '../ui/ListenButton';
import { ErrorMessage } from '../ui/ErrorMessage';

export function ConsentScreen({
  api,
  session,
  onDone,
}: {
  api: Api;
  session: Session;
  onDone: () => void;
}) {
  const t = useT();
  const language = useLanguage();
  const consent = session.consentement!;
  const text = consentText(session, language);
  const firstVisit = session.voix === null;

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const allChecked = consent.points.every((p) => checked.has(p));
  const canAccept = allChecked && (!firstVisit || name.trim().length > 0) && !busy;

  function toggle(point: string) {
    const next = new Set(checked);
    if (next.has(point)) next.delete(point);
    else next.add(point);
    setChecked(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/voix/consentement', {
        consentement_id: consent.id,
        points: consent.points.filter((p) => checked.has(p)),
        langue_interface: language,
        nom: firstVisit ? name.trim() : undefined,
        contact: firstVisit && contact.trim() ? contact.trim() : undefined,
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Logo size={36} />
      <h1>{t('consentement.titre')}</h1>
      {!firstVisit && <p className="message alerte">{t('consentement.nouvelle_version')}</p>}
      <ListenButton src={consentAudio(session, language, 'complet')} />
      {text.intro && <p className="texte-long">{text.intro}</p>}

      <form className="formulaire" onSubmit={(e) => void submit(e)}>
        <p>{t('consentement.cocher')}</p>
        {consent.points.map((point) => (
          <label key={point} className="case">
            <input type="checkbox" checked={checked.has(point)} onChange={() => toggle(point)} />
            <span>{text.points?.[point] ?? point}</span>
          </label>
        ))}

        {firstVisit && (
          <>
            <div>
              <label htmlFor="nom">{t('consentement.nom')}</label>
              <input
                id="nom"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={200}
              />
            </div>
            <div>
              <label htmlFor="contact">{t('consentement.contact')}</label>
              <input
                id="contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                autoComplete="tel"
                inputMode="tel"
                maxLength={200}
              />
            </div>
            <p className="aide">{t('consentement.nom_a_part')}</p>
          </>
        )}

        <ErrorMessage error={error} />
        <button type="submit" disabled={!canAccept}>
          {t('consentement.accepter')}
        </button>
      </form>
    </main>
  );
}
