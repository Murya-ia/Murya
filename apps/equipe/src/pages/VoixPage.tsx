// Recrutement et suivi des voix (spec §5.3) :
//   - créer un lien d'invitation et l'envoyer sur WhatsApp ;
//   - suivre chaque voix : contactée → d'accord → test fait → test validé → terminée ;
//   - écouter le test et le valider, ou demander de le refaire avec un message ;
//   - enregistrer un consentement oral, révoquer un lien ;
//   - demander le retrait d'une voix (recruteur), le confirmer (admin) — voir RetraitVoix.tsx.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AudioPlayer } from '../components/AudioPlayer';
import { sendOralConsent } from '../lib/api';
import { errorText, useTeam } from '../lib/team';
import { InviteForm } from './InviteForm';
import {
  CancelRequestButton,
  IdentityButton,
  RequestWithdrawalButton,
  SpeakerSearch,
  WithdrawalRequests,
  WithdrawPanel,
  type WithdrawalRequest,
  type WithdrawTarget,
} from './RetraitVoix';

interface Speaker {
  id: string;
  number: string;
  status: 'inscrite' | 'test_en_attente' | 'test_a_refaire' | 'active' | 'terminee';
  test_feedback: string | null;
  assisted_reading: boolean;
}

interface InviteRow {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  recruiter_id: string;
  speakers: Speaker | Speaker[] | null;
}

interface Progress {
  speaker_id: string;
  total: number;
  enregistrees: number;
  sautees: number;
}

const STAGES: Record<string, { label: string; className: string }> = {
  invitee: { label: 'Contactée', className: 'gris' },
  inscrite: { label: 'D’accord', className: '' },
  test_en_attente: { label: 'Test fait — à écouter', className: 'alerte' },
  test_a_refaire: { label: 'Test à refaire', className: '' },
  active: { label: 'Test validé', className: 'succes' },
  terminee: { label: 'Terminée', className: 'succes' },
};

export function VoixPage() {
  const { client, member, has } = useTeam();
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<{ kind: 'test' | 'oral'; invite: InviteRow } | null>(null);
  const [requests, setRequests] = useState<WithdrawalRequest[]>([]);
  const [withdrawTarget, setWithdrawTarget] = useState<WithdrawTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // La RLS ne renvoie que les invitations du recruteur (toutes pour un admin).
    const [invitesResult, progressResult, membersResult, requestsResult] = await Promise.all([
      client
        .from('invites')
        .select(
          'id, label, created_at, expires_at, revoked_at, recruiter_id, speakers(id, number, status, test_feedback, assisted_reading)',
        )
        .order('created_at', { ascending: false }),
      client.from('speaker_progress').select('*'),
      client.from('team_members').select('user_id, display_name'),
      client
        .from('withdrawal_requests')
        .select('speaker_id, requested_by, requested_at, note')
        .order('requested_at'),
    ]);
    if (invitesResult.error) return setError(errorText(invitesResult.error));
    setInvites(invitesResult.data as InviteRow[]);
    setProgress(new Map((progressResult.data as Progress[] | null)?.map((p) => [p.speaker_id, p])));
    setNames(
      new Map(membersResult.data?.map((m) => [m.user_id as string, m.display_name as string])),
    );
    setRequests((requestsResult.data as WithdrawalRequest[] | null) ?? []);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(invite: InviteRow) {
    const { error: updateError } = await client
      .from('invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', invite.id);
    if (updateError) setError(errorText(updateError));
    else void load();
  }

  const speakerOf = (invite: InviteRow): Speaker | null =>
    Array.isArray(invite.speakers) ? (invite.speakers[0] ?? null) : invite.speakers;

  // Numéro et libellé de chaque voix, pour les demandes de retrait.
  const numbers = useMemo(() => {
    const map = new Map<string, { number: string; label: string }>();
    for (const invite of invites ?? []) {
      const speaker = speakerOf(invite);
      if (speaker) map.set(speaker.id, { number: speaker.number, label: invite.label });
    }
    return map;
  }, [invites]);
  const requestOf = new Map(requests.map((r) => [r.speaker_id, r]));

  function openWithdraw(target: WithdrawTarget) {
    setWithdrawTarget(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <>
      <h1>Voix</h1>
      {withdrawTarget && (
        <WithdrawPanel
          key={withdrawTarget.id}
          target={withdrawTarget}
          onClose={(changed) => {
            setWithdrawTarget(null);
            if (changed) void load();
          }}
        />
      )}
      {has('admin') && (
        <WithdrawalRequests
          requests={requests}
          numbers={numbers}
          names={names}
          onWithdraw={openWithdraw}
          onChanged={() => void load()}
        />
      )}
      {has('recruteur') && <InviteForm onCreated={() => void load()} />}
      {has('admin') && <SpeakerSearch onWithdraw={openWithdraw} />}
      {error && <p className="message erreur">{error}</p>}

      <section className="carte">
        <h2>Suivi des voix</h2>
        {!invites ? (
          <p>Chargement…</p>
        ) : invites.length === 0 ? (
          <p className="aide">Aucune invitation pour le moment.</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau empile">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>Voix</th>
                  <th>Étape</th>
                  <th>Avancement</th>
                  {has('admin') && <th>Recruteur</th>}
                  <th>Lien</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const speaker = speakerOf(invite);
                  const stage = STAGES[speaker?.status ?? 'invitee']!;
                  const p = speaker ? progress.get(speaker.id) : undefined;
                  const linkState = invite.revoked_at
                    ? 'révoqué'
                    : new Date(invite.expires_at) < new Date()
                      ? 'expiré'
                      : `jusqu’au ${new Date(invite.expires_at).toLocaleDateString('fr-FR')}`;
                  const mine = invite.recruiter_id === member.user_id || has('admin');
                  const request = speaker ? requestOf.get(speaker.id) : undefined;
                  return (
                    <tr key={invite.id}>
                      <td className="titre-ligne-tableau">{invite.label}</td>
                      <td data-label="Voix">
                        {speaker?.number ?? '—'}
                        {speaker?.assisted_reading && (
                          <span className="pastille-discrete">oral</span>
                        )}
                      </td>
                      <td data-label="Étape">
                        <span className={`etape ${stage.className}`}>{stage.label}</span>
                      </td>
                      <td data-label="Avancement">
                        {p && p.total > 0 ? `${p.enregistrees + p.sautees} / ${p.total}` : '—'}
                      </td>
                      {has('admin') && (
                        <td data-label="Recruteur">{names.get(invite.recruiter_id) ?? '—'}</td>
                      )}
                      <td data-label="Lien" className="aide">
                        {linkState}
                      </td>
                      <td className="actions">
                        {mine && speaker?.status === 'test_en_attente' && (
                          <button
                            className="petit"
                            onClick={() => setOpen({ kind: 'test', invite })}
                          >
                            Écouter le test
                          </button>
                        )}
                        {mine && !speaker && !invite.revoked_at && (
                          <button
                            className="petit secondaire"
                            onClick={() => setOpen({ kind: 'oral', invite })}
                          >
                            Consentement oral
                          </button>
                        )}
                        {mine && !invite.revoked_at && (
                          <RevokeButton onConfirm={() => void revoke(invite)} />
                        )}
                        {speaker && request && (
                          <>
                            <span className="etape alerte">Retrait demandé</span>
                            {(has('admin') || request.requested_by === member.user_id) && (
                              <CancelRequestButton
                                speakerId={speaker.id}
                                onDone={() => void load()}
                              />
                            )}
                          </>
                        )}
                        {speaker &&
                          !request &&
                          !has('admin') &&
                          invite.recruiter_id === member.user_id && (
                            <RequestWithdrawalButton
                              speakerId={speaker.id}
                              onDone={() => void load()}
                            />
                          )}
                        {speaker && has('admin') && (
                          <>
                            <IdentityButton speakerId={speaker.id} />
                            <button
                              className="petit lien danger-texte"
                              onClick={() =>
                                openWithdraw({
                                  id: speaker.id,
                                  number: speaker.number,
                                  label: invite.label,
                                })
                              }
                            >
                              Retirer…
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open?.kind === 'test' && (
        <TestReview
          speaker={speakerOf(open.invite)!}
          label={open.invite.label}
          onClose={(changed) => {
            setOpen(null);
            if (changed) void load();
          }}
        />
      )}
      {open?.kind === 'oral' && (
        <OralConsentForm
          invite={open.invite}
          onClose={(changed) => {
            setOpen(null);
            if (changed) void load();
          }}
        />
      )}
    </>
  );
}

/** Révocation en deux clics, pour éviter les erreurs. */
function RevokeButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <button className="petit danger" onClick={onConfirm}>
      Confirmer la révocation
    </button>
  ) : (
    <button className="petit lien" onClick={() => setConfirming(true)}>
      Révoquer
    </button>
  );
}

/** Écoute des 5 phrases du test, puis décision (spec §3.5). */
function TestReview({
  speaker,
  label,
  onClose,
}: {
  speaker: Speaker;
  label: string;
  onClose: (changed: boolean) => void;
}) {
  const { client } = useTeam();
  const [takes, setTakes] = useState<{ id: string; code: string; text: string }[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void client
      .from('recordings')
      .select('id, take, created_at, sentences!inner(code, text, is_test)')
      .eq('speaker_id', speaker.id)
      .eq('upload_status', 'recu')
      .eq('sentences.is_test', true)
      .order('created_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) return setError(errorText(loadError));
        // La prise la plus récente de chaque phrase de test.
        const latest = new Map<string, { id: string; code: string; text: string }>();
        for (const row of (data ?? []) as unknown as {
          id: string;
          sentences: { code: string; text: string };
        }[]) {
          if (!latest.has(row.sentences.code)) {
            latest.set(row.sentences.code, {
              id: row.id,
              code: row.sentences.code,
              text: row.sentences.text,
            });
          }
        }
        setTakes([...latest.values()].sort((a, b) => a.code.localeCompare(b.code)));
      });
  }, [client, speaker.id]);

  async function decide(accepted: boolean) {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await client.rpc('review_speaker_test', {
      p_speaker_id: speaker.id,
      p_accepted: accepted,
      p_message: message,
    });
    setBusy(false);
    if (rpcError) setError(errorText(rpcError));
    else onClose(true);
  }

  return (
    <section className="carte panneau">
      <div className="panneau-titre">
        <h2>
          Test de {label} ({speaker.number})
        </h2>
        <button className="petit lien" onClick={() => onClose(false)}>
          Fermer
        </button>
      </div>
      {!takes ? (
        <p>Chargement…</p>
      ) : (
        takes.map((take) => (
          <div key={take.id} className="prise-test">
            <p lang="dje">
              <strong>{take.code}</strong> — {take.text}
            </p>
            <AudioPlayer recordingId={take.id} compact />
          </div>
        ))
      )}
      <label htmlFor="message-test">
        Message pour la voix (obligatoire pour demander de refaire)
      </label>
      <textarea
        id="message-test"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Ex. : Mettez-vous dans un endroit plus calme."
      />
      {error && <p className="message erreur">{error}</p>}
      <div className="boutons">
        <button onClick={() => void decide(true)} disabled={busy}>
          Valider le test
        </button>
        <button className="secondaire" onClick={() => void decide(false)} disabled={busy}>
          Demander de refaire
        </button>
      </div>
    </section>
  );
}

/** Consentement oral (spec §3.2) pour une personne qui lit peu. */
function OralConsentForm({
  invite,
  onClose,
}: {
  invite: InviteRow;
  onClose: (changed: boolean) => void;
}) {
  const { session } = useTeam();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set('invite_id', invite.id);
    form.set('nom', name.trim());
    form.set('contact', contact.trim());
    form.set('fichier', file);
    try {
      await sendOralConsent(session, form);
      onClose(true);
    } catch (e) {
      setError(errorText(e as Error));
      setBusy(false);
    }
  }

  return (
    <section className="carte panneau">
      <div className="panneau-titre">
        <h2>Consentement oral — {invite.label}</h2>
        <button className="petit lien" onClick={() => onClose(false)}>
          Fermer
        </button>
      </div>
      <p className="aide">
        Lisez le texte du consentement à la personne, enregistrez son accord avec votre téléphone,
        puis envoyez le fichier ici. Il est rangé avec les identités, jamais avec les voix.
      </p>
      <form className="formulaire" onSubmit={(e) => void submit(e)}>
        <div>
          <label htmlFor="oral-nom">Nom de la personne</label>
          <input id="oral-nom" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="oral-contact">Téléphone ou WhatsApp (facultatif)</label>
          <input id="oral-contact" value={contact} onChange={(e) => setContact(e.target.value)} />
        </div>
        <div>
          <label htmlFor="oral-fichier">Enregistrement de l'accord</label>
          <input
            id="oral-fichier"
            type="file"
            accept="audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        {error && <p className="message erreur">{error}</p>}
        <button type="submit" disabled={busy || !file || !name.trim()}>
          {busy ? 'Envoi…' : 'Enregistrer le consentement oral'}
        </button>
      </form>
    </section>
  );
}
