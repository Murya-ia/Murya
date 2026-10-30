// Langue de travail, en haut à droite : le nom de la langue choisie. Elle ouvre une fenêtre
// pour changer de langue ; un admin y active aussi les autres langues du Niger.

import { useState } from 'react';
import { languageName, useTeam, workLanguages } from '../lib/team';
import type { Language } from '../supabase';
import { Feuille } from './Feuille';
import { IconeCoche, IconeLangue } from './Icones';

export function ChoixLangue({
  languages,
  onChoose,
  onActivate,
}: {
  /** Toutes les langues enregistrées. */
  languages: Language[];
  onChoose: (code: string) => void;
  /** Active une langue (admins) ; renvoie un message d'erreur, ou null si c'est fait. */
  onActivate: (code: string) => Promise<string | null>;
}) {
  const { member, langue, has } = useTeam();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const mine = workLanguages(member, languages);
  const admin = has('admin');
  const inactive = admin ? languages.filter((l) => !l.active) : [];

  // Une seule langue et rien à activer : on la montre, sans menu.
  if (mine.length <= 1 && inactive.length === 0) {
    return (
      <span className="choix-langue" title="Langue de travail">
        <IconeLangue />
        <span className="choix-langue-nom">{langue.name_fr}</span>
      </span>
    );
  }

  async function activate(code: string) {
    setBusy(code);
    setError('');
    const message = await onActivate(code);
    setBusy(null);
    if (message) setError(message);
  }

  return (
    <>
      <button
        className="choix-langue"
        aria-label={`Langue de travail : ${languageName(langue)}. Changer`}
        onClick={() => setOpen(true)}
      >
        <IconeLangue />
        <span className="choix-langue-nom">{langue.name_fr}</span>
      </button>
      {open && (
        <Feuille label="Langue de travail" onClose={() => setOpen(false)}>
          <h2 className="feuille-titre">Langue de travail</h2>
          <p className="aide">
            Toutes les pages montrent cette langue : phrases, voix, écoute, tableau de bord.
          </p>
          <div className="liste-lignes sans-cadre">
            {mine.map((l) => (
              <button
                key={l.code}
                className="ligne"
                aria-pressed={l.code === langue.code}
                onClick={() => {
                  onChoose(l.code);
                  setOpen(false);
                }}
              >
                <span className="ligne-texte">
                  {languageName(l)}
                  {l.name_native && l.name_native !== l.name_fr && (
                    <small lang={l.code}>{l.name_native}</small>
                  )}
                </span>
                {l.code === langue.code && (
                  <span className="coche">
                    <IconeCoche />
                  </span>
                )}
              </button>
            ))}
          </div>
          {inactive.length > 0 && (
            <>
              <h3 className="feuille-sous-titre">Autres langues du Niger</h3>
              <p className="aide">
                Pas encore actives. Activez une langue quand son équipe est prête (traducteur,
                accord, audios de l’accord), puis cochez-la pour les membres concernés.
              </p>
              {error && <p className="message erreur">{error}</p>}
              <div className="liste-lignes sans-cadre inactifs">
                {inactive.map((l) => (
                  <div key={l.code} className="ligne">
                    <span className="ligne-texte">
                      {l.name_fr}
                      {l.name_native && l.name_native !== l.name_fr && (
                        <small lang={l.code}>{l.name_native}</small>
                      )}
                    </span>
                    <button
                      className="secondaire petit"
                      disabled={busy !== null}
                      onClick={() => void activate(l.code)}
                    >
                      {busy === l.code ? 'Activation…' : 'Activer'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </Feuille>
      )}
    </>
  );
}
