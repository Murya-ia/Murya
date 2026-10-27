// Écoute et vérification (spec §5.4) : un audio à la fois, réservé quelques minutes.
// Raccourcis : Espace = lecture, 1 = Validé, 2 = À corriger, 3 = Rejeté, D = Doute,
// flèche droite = Passer. Le responsable qualité a aussi la file des « Doutes » et celle de
// la « Double écoute » (spec §5.5), à l'aveugle.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioPlayer, type PlayerControl } from '../components/AudioPlayer';
import { errorText, LANGUAGE, useTeam } from '../lib/team';
import { ownRecruits, type ReviewCounts } from './AccueilPage';

interface Item {
  id: string;
  statut: 'a_verifier' | 'doute';
  type: 'varie' | 'principale';
  prise: number;
  duree_ms: number | null;
  suspect: boolean | null;
  verifications_serveur: ServerChecks | null;
  mesures_navigateur: {
    voix_dbfs?: number;
    bruit_dbfs?: number;
    saturation?: number;
    silence_avant_ms?: number;
    silence_apres_ms?: number;
    problemes?: string[];
    valide_quand_meme?: boolean;
  } | null;
  reserve_jusqua: string;
  phrase: { code: string; texte: string; traduction: string | null; mots: number };
  voix: string;
  avis: { decision: string; motif: string | null; commentaire: string | null }[];
  double_ecoute?: boolean;
}

/** Résultat du worker Python (worker/murya_worker/checks.py). */
interface ServerChecks {
  format?: { frequence?: number; canaux?: number; bits?: number; ok: boolean };
  rsb_db?: number;
  mots_par_seconde?: number | null;
  alertes: string[];
}

const SERVER_ALERTS: Record<string, string> = {
  format_invalide: 'Format invalide',
  frequence_inattendue: 'Fréquence inattendue',
  trop_court: 'Trop court',
  trop_long: 'Trop long',
  silence: 'Silence',
  bruit: 'Bruit',
  sature: 'Saturé',
  coupe: 'Coupé au début ou à la fin',
  debit_anormal: 'Débit de lecture anormal',
  doublon: 'Doublon d’un autre audio',
};

type Mode = 'premiere' | 'doute' | 'double';

const MODES: [Mode, string][] = [
  ['premiere', 'À vérifier'],
  ['doute', 'Doutes'],
  ['double', 'Double écoute'],
];
type Decision = 'valide' | 'corrige' | 'rejete' | 'doute';

const REASONS: Record<string, string> = {
  inaudible: 'Inaudible',
  bruit_fort: 'Bruit fort',
  autre_voix: 'Autre voix',
  coupe: 'Coupé',
  mauvaise_phrase: 'Mauvaise phrase',
  rire_toux: 'Rire / toux',
  autre: 'Autre',
};

export function EcoutePage() {
  const { client, has } = useTeam();
  const canArbitrate = has('qualite') || has('admin');
  // `/ecoute?file=doutes` ou `?file=double` ouvre directement cette file (liens de l'accueil).
  const [mode, setMode] = useState<Mode>(() => {
    const file = new URLSearchParams(location.search).get('file');
    if (!canArbitrate) return 'premiere';
    return file === 'doutes' ? 'doute' : file === 'double' ? 'double' : 'premiere';
  });
  const [counts, setCounts] = useState<ReviewCounts | null>(null);
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  const [pending, setPending] = useState<Decision | null>(null);
  const [corrected, setCorrected] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [outcome, setOutcome] = useState<string | null>(null);
  // Audios passés pendant cette séance : la file ne les repropose pas.
  const skipped = useRef<Record<Mode, string[]>>({ premiere: [], doute: [], double: [] });
  const player = useRef<PlayerControl | null>(null);
  const textArea = useRef<HTMLTextAreaElement | null>(null);

  const claim = useCallback(async () => {
    setItem(undefined);
    setPending(null);
    setError(null);
    setComment('');
    setReason('');
    const p_skip = skipped.current[mode];
    const { data, error: rpcError } =
      mode === 'double'
        ? await client.rpc('double_review_claim', { p_language: LANGUAGE, p_skip })
        : await client.rpc('review_claim', { p_language: LANGUAGE, p_mode: mode, p_skip });
    void client
      .rpc('review_counts', { p_language: LANGUAGE })
      .then(({ data: c }) => setCounts(c as ReviewCounts));
    if (rpcError) {
      setError(errorText(rpcError));
      setItem(null);
    } else {
      setItem(data as Item | null);
      setCorrected((data as Item | null)?.phrase.texte ?? '');
    }
  }, [client, mode]);

  useEffect(() => {
    void claim();
  }, [claim]);

  const submit = useCallback(
    async (decision: Decision) => {
      if (!item || busy) return;
      setBusy(true);
      setError(null);
      const args = {
        p_recording_id: item.id,
        p_decision: decision,
        p_corrected_text: decision === 'corrige' ? corrected : null,
        p_reject_reason: decision === 'rejete' ? reason || null : null,
        p_comment: comment || null,
      };
      const { data, error: rpcError } = await client.rpc(
        item.double_ecoute ? 'double_review_submit' : 'review_submit',
        args,
      );
      setBusy(false);
      if (rpcError) return setError(errorText(rpcError));
      setDone((n) => n + 1);
      setOutcome(
        !item.double_ecoute
          ? null
          : data
            ? 'Même décision que la première écoute.'
            : 'Désaccord enregistré : votre décision s’applique à l’audio.',
      );
      void claim();
    },
    [item, busy, client, corrected, reason, comment, claim],
  );

  const skip = useCallback(async () => {
    if (!item) return;
    skipped.current[mode] = [...skipped.current[mode], item.id];
    setOutcome(null);
    await client.rpc('review_release', { p_recording_id: item.id });
    void claim();
  }, [item, client, claim, mode]);

  // « Validé » part tout de suite ; les autres décisions demandent un complément.
  const choose = useCallback(
    (decision: Decision) => {
      if (decision === 'valide') return void submit('valide');
      setPending(decision);
      if (decision === 'corrige') setTimeout(() => textArea.current?.focus(), 0);
    },
    [submit],
  );

  // Raccourcis clavier (sauf pendant la saisie d'un texte).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !item) return;
      if (event.key === ' ') {
        event.preventDefault();
        player.current?.toggle();
      } else if (event.key === '1') choose('valide');
      else if (event.key === '2') choose('corrige');
      else if (event.key === '3') choose('rejete');
      else if (event.key.toLowerCase() === 'd' && canDoubt(item)) choose('doute');
      else if (event.key === 'ArrowRight') void skip();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, choose, skip]);

  return (
    <>
      <div className="titre-ligne">
        <h1>Écoute</h1>
        {canArbitrate && (
          <div className="onglets">
            {MODES.map(([value, label]) => (
              <button
                key={value}
                className={mode === value ? '' : 'secondaire'}
                onClick={() => {
                  setOutcome(null);
                  setMode(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === 'double' && (
        <p className="aide">
          Double écoute à l’aveugle : la décision de la première écoute n’est pas montrée. En cas de
          désaccord, votre décision remplace la sienne.
        </p>
      )}
      {done > 0 && <p className="aide">{done} audio(s) vérifié(s) pendant cette séance.</p>}
      {outcome && <p className="message succes">{outcome}</p>}
      {error && <p className="message erreur">{error}</p>}

      {item === undefined && <p>Chargement…</p>}
      {item === null && (
        <section className="carte">
          <p>
            {mode === 'double'
              ? 'Rien à réécouter pour le moment : le tirage a lieu chaque lundi.'
              : 'Rien à écouter pour le moment.'}
          </p>
          {skipped.current[mode].length > 0 && (
            <p className="aide">
              {skipped.current[mode].length} audio(s) passé(s) pendant cette séance.{' '}
              <button
                className="lien"
                onClick={() => {
                  skipped.current[mode] = [];
                  void claim();
                }}
              >
                Les reprendre
              </button>
            </p>
          )}
          {mode !== 'double' &&
            ownRecruits(
              mode === 'doute' ? counts?.doutes_vos_recrues : counts?.a_verifier_vos_recrues,
            ) && (
              <p className="aide">
                {ownRecruits(
                  mode === 'doute' ? counts?.doutes_vos_recrues : counts?.a_verifier_vos_recrues,
                )}
              </p>
            )}
          <button className="secondaire" onClick={() => void claim()}>
            Vérifier à nouveau
          </button>
        </section>
      )}

      {item && (
        <section className="carte verification">
          <div className="entete-audio">
            <span>
              Voix <strong>{item.voix}</strong> · phrase <strong>{item.phrase.code}</strong> · prise{' '}
              {item.prise}
              {item.type === 'principale' && ' · voix principale'}
            </span>
            {item.suspect && <span className="etape alerte">Suspect</span>}
            <span className="aide">
              Réservé jusqu’à {new Date(item.reserve_jusqua).toLocaleTimeString('fr-FR')}
            </span>
          </div>

          <p className="texte-attendu" lang="dje">
            {item.phrase.texte}
          </p>
          {item.phrase.traduction && <p className="aide">{item.phrase.traduction}</p>}

          <AudioPlayer key={item.id} recordingId={item.id} controlRef={player} />
          <Indicators item={item} />

          {item.avis.length > 0 && (
            <div className="message alerte">
              {item.avis.map((a, i) => (
                <p key={i}>
                  Avis précédent : <strong>{a.decision}</strong>
                  {a.motif && ` (${REASONS[a.motif] ?? a.motif})`}
                  {a.commentaire && ` — « ${a.commentaire} »`}
                </p>
              ))}
            </div>
          )}

          <div className="decisions">
            <button onClick={() => choose('valide')} disabled={busy}>
              Validé <kbd>1</kbd>
            </button>
            <button className="secondaire" onClick={() => choose('corrige')} disabled={busy}>
              À corriger <kbd>2</kbd>
            </button>
            <button
              className="secondaire danger-texte"
              onClick={() => choose('rejete')}
              disabled={busy}
            >
              Rejeté <kbd>3</kbd>
            </button>
            {canDoubt(item) && (
              <button className="secondaire" onClick={() => choose('doute')} disabled={busy}>
                Doute <kbd>D</kbd>
              </button>
            )}
            <button className="lien" onClick={() => void skip()} disabled={busy}>
              Passer <kbd>→</kbd>
            </button>
          </div>

          {pending === 'corrige' && (
            <div className="complement">
              <label htmlFor="corrige">Texte exactement comme il est dit dans l’audio</label>
              <textarea
                id="corrige"
                ref={textArea}
                value={corrected}
                onChange={(e) => setCorrected(e.target.value)}
                rows={2}
                lang="dje"
              />
              <button onClick={() => void submit('corrige')} disabled={busy || !corrected.trim()}>
                Enregistrer la correction
              </button>
            </div>
          )}
          {pending === 'rejete' && (
            <div className="complement">
              <label htmlFor="motif">Motif du rejet</label>
              <select id="motif" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choisir…</option>
                {Object.entries(REASONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <CommentField value={comment} onChange={setComment} />
              <button onClick={() => void submit('rejete')} disabled={busy || !reason}>
                Rejeter
              </button>
            </div>
          )}
          {pending === 'doute' && (
            <div className="complement">
              <CommentField value={comment} onChange={setComment} />
              <button onClick={() => void submit('doute')} disabled={busy}>
                Envoyer au responsable qualité
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** « Doute » : seulement en première écoute (pas sur un doute, ni en double écoute). */
function canDoubt(item: Item): boolean {
  return item.statut !== 'doute' && !item.double_ecoute;
}

function CommentField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <label htmlFor="commentaire">Commentaire (facultatif)</label>
      <input
        id="commentaire"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={300}
      />
    </>
  );
}

/** Nombre à la française, avec N décimales : « 3,1 ». */
function fr(n: number, digits: number): string {
  return n.toLocaleString('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Indicateurs automatiques : mesures du navigateur, puis vérifications du serveur. */
function Indicators({ item }: { item: Item }) {
  const m = item.mesures_navigateur ?? {};
  const seconds = (item.duree_ms ?? 0) / 1000;
  const wordsPerSecond = seconds > 0 ? item.phrase.mots / seconds : null;
  const facts: [string, string, boolean][] = [
    ['Durée', `${fr(seconds, 1)} s`, seconds < 1 || seconds > 20],
    ['Voix', m.voix_dbfs !== undefined ? `${m.voix_dbfs} dB` : '—', false],
    [
      'Écart avec le bruit',
      m.voix_dbfs !== undefined && m.bruit_dbfs !== undefined
        ? `${Math.round(m.voix_dbfs - m.bruit_dbfs)} dB`
        : '—',
      m.voix_dbfs !== undefined && m.bruit_dbfs !== undefined && m.voix_dbfs - m.bruit_dbfs < 15,
    ],
    [
      'Saturation',
      m.saturation !== undefined ? `${fr(m.saturation * 100, 2)} %` : '—',
      (m.saturation ?? 0) > 0.001,
    ],
    [
      'Silence avant / après',
      `${m.silence_avant_ms ?? '—'} / ${m.silence_apres_ms ?? '—'} ms`,
      false,
    ],
    ['Mots par seconde (approx.)', wordsPerSecond ? fr(wordsPerSecond, 1) : '—', false],
  ];
  return (
    <div className="indicateurs">
      {facts.map(([label, value, warn]) => (
        <span key={label} className={warn ? 'attention' : ''}>
          {label} : <strong>{value}</strong>
        </span>
      ))}
      {m.valide_quand_meme && (
        <span className="attention">Validé par la voix malgré une alerte</span>
      )}
      <ServerIndicators checks={item.verifications_serveur} />
    </div>
  );
}

function ServerIndicators({ checks }: { checks: ServerChecks | null }) {
  if (!checks) {
    return (
      <span className="aide">
        Vérifications serveur : en attente (le worker passe toutes les 15 min)
      </span>
    );
  }
  const details = [
    checks.rsb_db !== undefined && `écart voix/bruit ${Math.round(checks.rsb_db)} dB`,
    checks.mots_par_seconde != null && `${checks.mots_par_seconde.toLocaleString('fr-FR')} mots/s`,
    checks.format?.frequence && `${checks.format.frequence / 1000} kHz`,
  ].filter(Boolean);
  return (
    <span className="serveur">
      Serveur :{' '}
      {checks.alertes.length === 0 ? (
        <span className="etape succes">✓ Aucune alerte</span>
      ) : (
        checks.alertes.map((a) => (
          <span key={a} className="etape alerte">
            ⚠ {SERVER_ALERTS[a] ?? a}
          </span>
        ))
      )}{' '}
      {details.length > 0 && <span className="aide">({details.join(' · ')})</span>}
    </span>
  );
}
