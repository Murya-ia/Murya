// Retrait d'une voix (droit à l'effacement, spec §5.8) :
//   - le recruteur de la voix fait la demande, un admin la confirme ;
//   - un admin retrouve une voix par son nom ou son numéro (chaque recherche est journalisée) ;
//   - le retrait est définitif : l'admin retape le numéro de la voix pour confirmer.

import { useState, type FormEvent } from 'react';
import { withdrawSpeaker } from '../lib/api';
import { errorText, LANGUAGE, useTeam } from '../lib/team';

export interface WithdrawalRequest {
  speaker_id: string;
  requested_by: string;
  requested_at: string;
  note: string | null;
}

/** Voix à retirer : de quoi l'afficher dans le panneau de confirmation. */
export interface WithdrawTarget {
  id: string;
  number: string;
  label: string;
}

interface FoundSpeaker {
  id: string;
  numero: string;
  statut: string;
  recruteur: string | null;
  nom: string | null;
  contact: string | null;
  consentement_oral: boolean;
  retrait_demande: boolean;
}

/** Demandes en attente, en haut de la page Voix (admins). */
export function WithdrawalRequests({
  requests,
  numbers,
  names,
  onWithdraw,
  onChanged,
}: {
  requests: WithdrawalRequest[];
  /** Numéro et nom (libellé de l'invitation) de chaque voix, par identifiant. */
  numbers: Map<string, { number: string; label: string }>;
  names: Map<string, string>;
  onWithdraw: (target: WithdrawTarget) => void;
  onChanged: () => void;
}) {
  if (requests.length === 0) return null;
  return (
    <section className="carte panneau-alerte">
      <h2>Demandes de retrait à confirmer ({requests.length})</h2>
      <ul className="liste-demandes">
        {requests.map((r) => {
          const speaker = numbers.get(r.speaker_id);
          return (
            <li key={r.speaker_id}>
              <div>
                <strong>{speaker?.number ?? 'Voix'}</strong> · {speaker?.label ?? '—'}
                <p className="aide">
                  Demandé par {names.get(r.requested_by) ?? 'un membre'} le{' '}
                  {new Date(r.requested_at).toLocaleDateString('fr-FR')}
                  {r.note && <> — « {r.note} »</>}
                </p>
              </div>
              <div className="boutons">
                {speaker && (
                  <button
                    className="petit danger"
                    onClick={() =>
                      onWithdraw({ id: r.speaker_id, number: speaker.number, label: speaker.label })
                    }
                  >
                    Retirer…
                  </button>
                )}
                <CancelRequestButton speakerId={r.speaker_id} onDone={onChanged} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Recherche d'une voix par nom ou numéro (admins) : montre l'identité, journalisé. */
export function SpeakerSearch({ onWithdraw }: { onWithdraw: (target: WithdrawTarget) => void }) {
  const { client } = useTeam();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundSpeaker[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const { data, error: rpcError } = await client.rpc('find_speakers', {
      p_language: LANGUAGE,
      p_query: query,
    });
    if (rpcError) return setError(errorText(rpcError));
    setResults(data as FoundSpeaker[]);
  }

  return (
    <section className="carte">
      <h2>Retrouver une voix</h2>
      <form className="ligne-formulaire" onSubmit={(e) => void search(e)}>
        <div>
          <label htmlFor="recherche-voix">Nom ou numéro (ex. « Fati » ou « 12 »)</label>
          <input
            id="recherche-voix"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            minLength={2}
            required
          />
        </div>
        <button type="submit" disabled={query.trim().length < 2}>
          Chercher
        </button>
      </form>
      <p className="aide">Chaque recherche est notée dans le journal (sans le nom cherché).</p>
      {error && <p className="message erreur">{error}</p>}
      {results &&
        (results.length === 0 ? (
          <p className="aide">Aucune voix trouvée.</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau empile">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Voix</th>
                  <th>Contact</th>
                  <th>Recruteur</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {results.map((s) => (
                  <tr key={s.id}>
                    <td className="titre-ligne-tableau">{s.nom ?? '—'}</td>
                    <td data-label="Voix">
                      {s.numero}
                      {s.retrait_demande && (
                        <span className="pastille-discrete">retrait demandé</span>
                      )}
                    </td>
                    <td data-label="Contact">{s.contact ?? '—'}</td>
                    <td data-label="Recruteur">{s.recruteur ?? '—'}</td>
                    <td className="actions">
                      <button
                        className="petit danger"
                        onClick={() =>
                          onWithdraw({ id: s.id, number: s.numero, label: s.nom ?? s.numero })
                        }
                      >
                        Retirer…
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

/** Panneau de confirmation du retrait (admins). */
export function WithdrawPanel({
  target,
  onClose,
}: {
  target: WithdrawTarget;
  onClose: (changed: boolean) => void;
}) {
  const { session } = useTeam();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ audios: number; fichiers_effaces: boolean } | null>(null);
  const matches = confirmation.trim().toUpperCase() === target.number;

  async function withdraw(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await withdrawSpeaker(session, target.id, confirmation.trim()));
    } catch (e) {
      setError(errorText(e as Error));
    }
    setBusy(false);
  }

  if (done) {
    return (
      <section className="carte panneau">
        <p className="message succes">
          La voix {target.number} est retirée : sa fiche, son identité, ses consentements et{' '}
          {done.audios} audio(s) sont effacés.
        </p>
        {!done.fichiers_effaces && (
          <p className="message alerte">
            Le stockage n’a pas répondu : les fichiers seront effacés automatiquement dans l’heure.
          </p>
        )}
        <button onClick={() => onClose(true)}>Fermer</button>
      </section>
    );
  }

  return (
    <section className="carte panneau panneau-danger">
      <div className="panneau-titre">
        <h2>
          Retirer la voix {target.number} ({target.label})
        </h2>
        <button className="petit lien" onClick={() => onClose(false)}>
          Fermer
        </button>
      </div>
      <p>
        <strong>C’est définitif.</strong> Seront effacés : tous ses audios, sa fiche, son nom et son
        contact, ses consentements (écrit et oral) et son lien d’invitation.
      </p>
      <ul className="aide">
        <li>Le journal garde seulement le numéro {target.number}, la date et votre nom.</li>
        <li>Les sauvegardes l’oublient au plus tard 30 jours après.</li>
        <li>Un export déjà fait ne change pas ; la voix sera exclue des prochains.</li>
      </ul>
      <form className="formulaire" onSubmit={(e) => void withdraw(e)}>
        <div>
          <label htmlFor="confirmation-retrait">
            Pour confirmer, tapez le numéro de la voix : {target.number}
          </label>
          <input
            id="confirmation-retrait"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
          />
        </div>
        {error && <p className="message erreur">{error}</p>}
        <div className="boutons">
          <button type="submit" className="danger" disabled={!matches || busy}>
            {busy ? 'Retrait…' : 'Retirer définitivement'}
          </button>
          <button type="button" className="secondaire" onClick={() => onClose(false)}>
            Annuler
          </button>
        </div>
      </form>
    </section>
  );
}

/** Bouton du recruteur : demander le retrait (avec un court message facultatif). */
export function RequestWithdrawalButton({
  speakerId,
  onDone,
}: {
  speakerId: string;
  onDone: () => void;
}) {
  const { client } = useTeam();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const { error: rpcError } = await client.rpc('request_withdrawal', {
      p_speaker_id: speakerId,
      p_note: note || null,
    });
    if (rpcError) return setError(errorText(rpcError));
    setOpen(false);
    onDone();
  }

  if (!open) {
    return (
      <button className="petit lien" onClick={() => setOpen(true)}>
        Demander le retrait
      </button>
    );
  }
  return (
    <div className="demande-retrait">
      <input
        aria-label="Message pour l’admin (facultatif)"
        placeholder="Message (facultatif)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
      />
      <button className="petit danger" onClick={() => void send()}>
        Envoyer la demande
      </button>
      <button className="petit lien" onClick={() => setOpen(false)}>
        Annuler
      </button>
      {error && <p className="erreur-ligne">{error}</p>}
    </div>
  );
}

export function CancelRequestButton({
  speakerId,
  onDone,
}: {
  speakerId: string;
  onDone: () => void;
}) {
  const { client } = useTeam();
  return (
    <button
      className="petit lien"
      onClick={() =>
        void client
          .rpc('cancel_withdrawal_request', { p_speaker_id: speakerId })
          .then(() => onDone())
      }
    >
      Annuler la demande
    </button>
  );
}

/** Nom et contact d'une voix (admins) : affiché à la demande, chaque lecture journalisée. */
export function IdentityButton({ speakerId }: { speakerId: string }) {
  const { client } = useTeam();
  const [identity, setIdentity] = useState<{ nom: string; contact: string | null } | null>(null);
  if (identity) {
    return (
      <span className="identite">
        {identity.nom}
        {identity.contact && <> · {identity.contact}</>}
      </span>
    );
  }
  return (
    <button
      className="petit lien"
      title="Chaque consultation est notée dans le journal"
      onClick={() =>
        void client
          .rpc('speaker_identity', { p_speaker_id: speakerId })
          .then(({ data }) => setIdentity(data ?? { nom: 'identité absente', contact: null }))
      }
    >
      Identité
    </button>
  );
}
