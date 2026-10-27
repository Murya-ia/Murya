// Écoute et vérification (spec §5.4) : un audio à la fois, réservé quelques minutes.
// Raccourcis : Espace = lecture, 1 = Validé, 2 = À corriger, 3 = Rejeté, D = Doute,
// flèche droite = Passer. Le responsable qualité a aussi la file des « Doutes ».

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioPlayer, type PlayerControl } from '../components/AudioPlayer';
import { errorText, LANGUAGE, useTeam } from '../lib/team';

interface Item {
  id: string;
  statut: 'a_verifier' | 'doute';
  type: 'varie' | 'principale';
  prise: number;
  duree_ms: number | null;
  suspect: boolean | null;
  verifications_serveur: Record<string, unknown> | null;
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
}

type Mode = 'premiere' | 'doute';
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
  const [mode, setMode] = useState<Mode>('premiere');
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  const [pending, setPending] = useState<Decision | null>(null);
  const [corrected, setCorrected] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const player = useRef<PlayerControl | null>(null);
  const textArea = useRef<HTMLTextAreaElement | null>(null);

  const claim = useCallback(async () => {
    setItem(undefined);
    setPending(null);
    setError(null);
    setComment('');
    setReason('');
    const { data, error: rpcError } = await client.rpc('review_claim', {
      p_language: LANGUAGE,
      p_mode: mode,
    });
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
      const { error: rpcError } = await client.rpc('review_submit', {
        p_recording_id: item.id,
        p_decision: decision,
        p_corrected_text: decision === 'corrige' ? corrected : null,
        p_reject_reason: decision === 'rejete' ? reason || null : null,
        p_comment: comment || null,
      });
      setBusy(false);
      if (rpcError) return setError(errorText(rpcError));
      setDone((n) => n + 1);
      void claim();
    },
    [item, busy, client, corrected, reason, comment, claim],
  );

  const skip = useCallback(async () => {
    if (!item) return;
    await client.rpc('review_release', { p_recording_id: item.id });
    void claim();
  }, [item, client, claim]);

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
      else if (event.key.toLowerCase() === 'd' && item.statut !== 'doute') choose('doute');
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
            <button
              className={mode === 'premiere' ? '' : 'secondaire'}
              onClick={() => setMode('premiere')}
            >
              À vérifier
            </button>
            <button
              className={mode === 'doute' ? '' : 'secondaire'}
              onClick={() => setMode('doute')}
            >
              Doutes
            </button>
          </div>
        )}
      </div>
      {done > 0 && <p className="aide">{done} audio(s) vérifié(s) pendant cette séance.</p>}
      {error && <p className="message erreur">{error}</p>}

      {item === undefined && <p>Chargement…</p>}
      {item === null && (
        <section className="carte">
          <p>Rien à écouter pour le moment.</p>
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
            {item.statut !== 'doute' && (
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

/** Indicateurs automatiques : mesures du navigateur (et du serveur, au J4). */
function Indicators({ item }: { item: Item }) {
  const m = item.mesures_navigateur ?? {};
  const seconds = (item.duree_ms ?? 0) / 1000;
  const wordsPerSecond = seconds > 0 ? item.phrase.mots / seconds : null;
  const facts: [string, string, boolean][] = [
    ['Durée', `${seconds.toFixed(1)} s`, seconds < 1 || seconds > 20],
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
      m.saturation !== undefined ? `${(m.saturation * 100).toFixed(2)} %` : '—',
      (m.saturation ?? 0) > 0.001,
    ],
    [
      'Silence avant / après',
      `${m.silence_avant_ms ?? '—'} / ${m.silence_apres_ms ?? '—'} ms`,
      false,
    ],
    ['Mots par seconde (approx.)', wordsPerSecond ? wordsPerSecond.toFixed(1) : '—', false],
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
      {!item.verifications_serveur && <span className="aide">Vérifications serveur : au J4</span>}
    </div>
  );
}
