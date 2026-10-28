// Voix principale (spec §5.7), sur la page Voix, pour les admins et le responsable qualité :
//   - désigner la voix principale (admins) ;
//   - suivre ses séances : une séance s'ouvre seule quand la précédente est entièrement
//     vérifiée (les audios de la voix principale s'écoutent dans la page Écoute, comme les autres) ;
//   - choisir l'audio de référence qu'elle réécoute au début de chaque séance (admins).

import { useCallback, useEffect, useState } from 'react';
import { AudioPlayer } from '../components/AudioPlayer';
import { errorText, LANGUAGE, useTeam } from '../lib/team';

interface Session {
  numero: number;
  statut: 'en_cours' | 'a_verifier' | 'verifiee';
  ouverte_le: string;
  terminee_le: string | null;
  verifiee_le: string | null;
  phrases: number;
  enregistrees: number;
  a_verifier: number;
  rejetees: number;
}

interface Take {
  id: string;
  code: string;
  texte: string;
}

interface Overview {
  phrases_total: number;
  voix: {
    id: string;
    numero: string;
    statut: string;
    libelle: string | null;
    reference: Take | null;
    phrases_validees: number;
    seances: Session[];
    candidats_reference: Take[];
  } | null;
  candidats: { id: string; numero: string; statut: string; libelle: string | null }[];
}

const STATUS: Record<Session['statut'], { label: string; className: string }> = {
  en_cours: { label: 'En cours d’enregistrement', className: 'etape' },
  a_verifier: { label: 'À vérifier', className: 'etape alerte' },
  verifiee: { label: 'Vérifiée', className: 'etape succes' },
};

const SPEAKER_STATUS: Record<string, string> = {
  inscrite: 'test à faire',
  test_en_attente: 'test à écouter',
  test_a_refaire: 'test à refaire',
  active: 'active',
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—';

export function VoixPrincipale() {
  const { client, has } = useTeam();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await client.rpc('principal_overview', {
      p_language: LANGUAGE,
    });
    if (rpcError) setError(errorText(rpcError));
    else setOverview(data as Overview);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: string, args: Record<string, unknown>) {
    setError(null);
    const { error: rpcError } = await client.rpc(fn, args);
    if (rpcError) setError(errorText(rpcError));
    await load();
  }

  if (!overview) return null;
  const voice = overview.voix;

  return (
    <section className="carte">
      <div className="titre-ligne">
        <h2>Voix principale</h2>
        {voice && (
          <span className="etape succes">
            {voice.numero}
            {voice.libelle ? ` · ${voice.libelle}` : ''}
          </span>
        )}
      </div>
      {error && <p className="message erreur">{error}</p>}

      {!voice ? (
        <ChoosePrincipal
          canChoose={has('admin')}
          candidates={overview.candidats}
          onChoose={(id) => void act('set_principal', { p_speaker_id: id, p_value: true })}
        />
      ) : (
        <>
          <Progress done={voice.phrases_validees} total={overview.phrases_total} />
          {voice.statut !== 'active' && voice.statut !== 'terminee' && (
            <p className="message alerte">
              Elle commence ses séances dès que son test est validé (
              {SPEAKER_STATUS[voice.statut] ?? voice.statut}).
            </p>
          )}
          <Sessions sessions={voice.seances} />
          <Reference
            current={voice.reference}
            candidates={voice.candidats_reference}
            canChoose={has('admin')}
            onChoose={(id) =>
              void act('set_reference_audio', { p_speaker_id: voice.id, p_recording_id: id })
            }
          />
        </>
      )}
    </section>
  );
}

function ChoosePrincipal({
  canChoose,
  candidates,
  onChoose,
}: {
  canChoose: boolean;
  candidates: Overview['candidats'];
  onChoose: (id: string) => void;
}) {
  const [chosen, setChosen] = useState('');
  return (
    <>
      <p className="aide">
        La voix principale lit tout le corpus, en séances d’environ 150 phrases, en qualité
        supérieure (fréquence du téléphone). Elle passe d’abord le test comme les autres voix. Une
        séance s’ouvre seule quand la précédente est entièrement vérifiée.
      </p>
      {!canChoose ? (
        <p className="gris">Aucune voix principale désignée pour le moment.</p>
      ) : candidates.length === 0 ? (
        <p className="gris">
          Aucune voix disponible : invitez d’abord la personne (une voix qui a déjà commencé un lot
          de voix variée ne peut plus devenir principale).
        </p>
      ) : (
        <div className="ligne-formulaire">
          <div>
            <label htmlFor="voix-principale">Voix à désigner</label>
            <select id="voix-principale" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">Choisir…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.numero}
                  {c.libelle ? ` · ${c.libelle}` : ''} ({SPEAKER_STATUS[c.statut] ?? c.statut})
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => onChoose(chosen)} disabled={!chosen}>
            Désigner comme voix principale
          </button>
        </div>
      )}
    </>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const ratio = total ? Math.min(1, done / total) : 0;
  return (
    <div className="avancement-principale">
      <div className="quota-chiffres">
        <strong>{done.toLocaleString('fr-FR')}</strong>
        <span className="gris">
          phrases validées sur {total.toLocaleString('fr-FR')} (
          {Math.round(ratio * 100).toLocaleString('fr-FR')}&nbsp;%)
        </span>
      </div>
      <span className="jauge" aria-hidden="true">
        <span style={{ width: `${ratio * 100}%` }} />
      </span>
    </div>
  );
}

function Sessions({ sessions }: { sessions: Session[] }) {
  if (sessions.length === 0) {
    return <p className="gris">Aucune séance pour le moment.</p>;
  }
  return (
    <div className="tableau-defilant">
      <table className="tableau empile">
        <thead>
          <tr>
            <th>Séance</th>
            <th>État</th>
            <th>Enregistrées</th>
            <th>À vérifier</th>
            <th>Rejetées</th>
            <th>Ouverte</th>
            <th>Vérifiée</th>
          </tr>
        </thead>
        <tbody>
          {[...sessions].reverse().map((s) => (
            <tr key={s.numero}>
              <td className="titre-ligne-tableau">Séance {s.numero}</td>
              <td data-label="État">
                <span className={STATUS[s.statut].className}>{STATUS[s.statut].label}</span>
              </td>
              <td data-label="Enregistrées">
                {s.enregistrees} / {s.phrases}
              </td>
              <td data-label="À vérifier">{s.a_verifier}</td>
              <td data-label="Rejetées">{s.rejetees}</td>
              <td data-label="Ouverte">{day(s.ouverte_le)}</td>
              <td data-label="Vérifiée">{day(s.verifiee_le)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reference({
  current,
  candidates,
  canChoose,
  onChoose,
}: {
  current: Take | null;
  candidates: Take[];
  canChoose: boolean;
  onChoose: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="reference-principale">
      <h3>Audio de référence</h3>
      <p className="aide">
        La voix le réécoute au début de chaque séance, pour garder le même ton.
      </p>
      {current ? (
        <div className="prise-test">
          <p lang="dje">
            <strong>{current.code}</strong> — {current.texte}
          </p>
          <AudioPlayer recordingId={current.id} compact />
        </div>
      ) : (
        <p className="gris">Pas encore choisi : prenez un audio validé de la première séance.</p>
      )}
      {canChoose && candidates.length > 0 && (
        <button className="secondaire petit" onClick={() => setOpen(!open)}>
          {open
            ? 'Fermer'
            : current
              ? 'Changer l’audio de référence'
              : 'Choisir l’audio de référence'}
        </button>
      )}
      {open &&
        candidates.map((take) => (
          <div key={take.id} className="prise-test">
            <p lang="dje">
              <strong>{take.code}</strong> — {take.texte}
            </p>
            <AudioPlayer recordingId={take.id} compact />
            <button
              className="petit"
              disabled={take.id === current?.id}
              onClick={() => {
                onChoose(take.id);
                setOpen(false);
              }}
            >
              {take.id === current?.id ? 'Référence actuelle' : 'Choisir comme référence'}
            </button>
          </div>
        ))}
    </div>
  );
}
