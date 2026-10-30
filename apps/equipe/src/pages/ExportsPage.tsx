// Exports du jeu de données (spec §5.9), pour les admins :
//   1. les voix « examen » (10 % proposés par Murya, l'admin ajuste) ;
//   2. lancer un export (le worker le construit en 15 à 30 minutes) ;
//   3. les versions : chiffres, téléchargements, dépôt Hugging Face.
// Les identités ne sont jamais dans un export : une voix n'y est connue que par son numéro.

import { useCallback, useEffect, useState } from 'react';
import { exportLink, type ExportFile } from '../lib/api';
import { formatHours } from '../lib/dashboard';
import { errorText, useTeam } from '../lib/team';

interface ExamVoice {
  id: string;
  numero: string;
  sexe: string | null;
  age: string | null;
  region: string | null;
  figee?: boolean;
}

interface ExamOverview {
  voix_eligibles: number;
  cible: number;
  examen: ExamVoice[];
  proposition: ExamVoice[];
}

interface Part {
  audios: number;
  heures: number;
  voix: number;
}

interface ExportRow {
  id: number;
  kind: 'varie' | 'principale';
  version: number;
  status: 'en_attente' | 'en_cours' | 'pret' | 'echec';
  requested_at: string;
  finished_at: string | null;
  stats: (Part & { train: Part; test: Part; archive_octets?: number }) | null;
  hf_repo: string | null;
  error: string | null;
}

const KINDS = { varie: 'Voix variées', principale: 'Voix principale' } as const;

const STATUS: Record<ExportRow['status'], { label: string; className: string }> = {
  en_attente: { label: 'En attente', className: 'etape' },
  en_cours: { label: 'En préparation', className: 'etape alerte' },
  pret: { label: 'Prêt', className: 'etape succes' },
  echec: { label: 'Échec', className: 'etape danger-texte' },
};

const date = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const voiceLabel = (v: ExamVoice) =>
  [v.sexe ?? 'sexe ?', v.age ?? 'âge ?', v.region ?? 'région ?'].join(' · ');

function size(bytes: number | undefined): string {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1
    ? `${gb.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`
    : `${Math.max(1, Math.round(bytes / 1e6)).toLocaleString('fr-FR')} Mo`;
}

export function ExportsPage() {
  const [overview, setOverview] = useState<ExamOverview | null>(null);
  const [exports, setExports] = useState<ExportRow[] | null>(null);
  const { client, langue } = useTeam();
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [exam, list] = await Promise.all([
      client.rpc('exam_overview', { p_language: langue.code }),
      client
        .from('exports')
        .select('id, kind, version, status, requested_at, finished_at, stats, hf_repo, error')
        .eq('language_code', langue.code)
        .order('id', { ascending: false }),
    ]);
    if (exam.error || list.error) setError(errorText(exam.error ?? list.error));
    setOverview(exam.data as ExamOverview);
    setExports((list.data as ExportRow[]) ?? []);
  }, [client, langue.code]);

  useEffect(() => {
    void load();
  }, [load]);

  // Tant qu'un export se prépare, on regarde où il en est toutes les 30 secondes.
  const busy = exports?.some((e) => e.status === 'en_attente' || e.status === 'en_cours');
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [busy, load]);

  return (
    <>
      <span className="etiquette">Jeu de données</span>
      <h1>
        Exports. <span className="doux">Des versions prêtes à entraîner.</span>
      </h1>
      <p className="intro gris">
        Chaque export contient les audios validés (texte corrigé s’il y a lieu), leurs métadonnées
        et une fiche de version. Aucune identité n’y figure : une voix n’est connue que par son
        numéro.
      </p>
      {error && <p className="message erreur">{error}</p>}
      {overview && (
        <ExamPartition
          key={[...overview.examen, ...overview.proposition].map((v) => v.id).join()}
          overview={overview}
          onSaved={load}
        />
      )}
      <NewExport examCount={overview?.examen.length ?? 0} busy={!!busy} onStarted={load} />
      <ExportList exports={exports} />
    </>
  );
}

function ExamPartition({ overview, onSaved }: { overview: ExamOverview; onSaved: () => void }) {
  const { client, langue } = useTeam();
  // Cases cochées : voix examen actuelles + proposition (le composant est recréé à chaque
  // nouvelle vue d'ensemble, voir `key` plus haut).
  const [checked, setChecked] = useState(
    () => new Set([...overview.examen, ...overview.proposition].map((v) => v.id)),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = overview.proposition.filter((v) => checked.has(v.id)).map((v) => v.id);
  const remove = overview.examen.filter((v) => !checked.has(v.id)).map((v) => v.id);
  const pending = add.length + remove.length > 0;

  async function save() {
    setSaving(true);
    setMessage(null);
    const { error } = await client.rpc('set_exam_speakers', {
      p_language: langue.code,
      p_add: add,
      p_remove: remove,
    });
    setSaving(false);
    if (error) setMessage({ ok: false, text: errorText(error) });
    else {
      setMessage({ ok: true, text: 'Voix examen enregistrées.' });
      onSaved();
    }
  }

  const row = (voice: ExamVoice, proposed: boolean) => (
    <li key={voice.id}>
      <label className="case-ligne">
        <input
          type="checkbox"
          checked={checked.has(voice.id)}
          disabled={voice.figee}
          onChange={() => toggle(voice.id)}
        />
        <strong>{voice.numero}</strong>
        <span className="gris">{voiceLabel(voice)}</span>
      </label>
      {voice.figee ? (
        <span className="etape" title="Déjà dans un export : sa partie ne change plus.">
          figée
        </span>
      ) : proposed ? (
        <span className="etape succes">proposée</span>
      ) : null}
    </li>
  );

  return (
    <section className="carte">
      <div className="titre-ligne">
        <h2>Voix examen</h2>
        <span className="etape">
          {overview.examen.length} sur {overview.voix_eligibles} voix · cible {overview.cible}
        </span>
      </div>
      <p className="aide">
        Tous les audios des voix examen vont dans la partie « test », jamais dans l’entraînement :
        c’est sur elles qu’on note le modèle. Murya propose 10&nbsp;% des voix, réparties par sexe,
        âge et région ; cochez ou décochez avant d’enregistrer. Une voix déjà exportée garde sa
        partie.
      </p>
      {overview.examen.length + overview.proposition.length === 0 ? (
        <p className="gris">Aucune voix exportable pour le moment (test réussi requis).</p>
      ) : (
        <ul className="liste-voix-examen">
          {overview.examen.map((v) => row(v, false))}
          {overview.proposition.map((v) => row(v, true))}
        </ul>
      )}
      {message && <p className={`message ${message.ok ? 'succes' : 'erreur'}`}>{message.text}</p>}
      <div className="boutons">
        <button onClick={() => void save()} disabled={!pending || saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer la sélection'}
        </button>
        {pending && (
          <span className="gris">
            {add.length} à ajouter, {remove.length} à retirer
          </span>
        )}
      </div>
    </section>
  );
}

function NewExport({
  examCount,
  busy,
  onStarted,
}: {
  examCount: number;
  busy: boolean;
  onStarted: () => void;
}) {
  const { client, langue } = useTeam();
  const [kind, setKind] = useState<keyof typeof KINDS>('varie');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function start() {
    setSending(true);
    setMessage(null);
    const { data, error } = await client.rpc('request_export', {
      p_language: langue.code,
      p_kind: kind,
    });
    setSending(false);
    if (error) setMessage({ ok: false, text: errorText(error) });
    else {
      const version = String((data as { version: number }).version).padStart(3, '0');
      setMessage({
        ok: true,
        text: `Export v${version} demandé : il sera prêt dans 15 à 30 minutes. Cette page se met à jour toute seule.`,
      });
      onStarted();
    }
  }

  return (
    <section className="carte">
      <h2>Nouvel export</h2>
      <div className="ligne-formulaire">
        <div>
          <label htmlFor="type-export">Type d’audios</label>
          <select
            id="type-export"
            value={kind}
            onChange={(e) => setKind(e.target.value as keyof typeof KINDS)}
          >
            {Object.entries(KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button className="avec-fleche" onClick={() => void start()} disabled={sending || busy}>
          {sending ? 'Demande…' : 'Lancer l’export'}
          <span className="rond" aria-hidden="true">
            →
          </span>
        </button>
      </div>
      {examCount === 0 && (
        <p className="message alerte">
          Aucune voix examen : la partie « test » de l’export sera vide. Choisissez-les d’abord.
        </p>
      )}
      {busy && !message && <p className="aide">Un export est en préparation.</p>}
      {message && <p className={`message ${message.ok ? 'succes' : 'erreur'}`}>{message.text}</p>}
    </section>
  );
}

const DOWNLOADS: { file: ExportFile; label: string }[] = [
  { file: 'archive.zip', label: 'Archive' },
  { file: 'README.md', label: 'Fiche' },
  { file: 'metadata.csv', label: 'CSV' },
  { file: 'metadata.jsonl', label: 'JSONL' },
];

function ExportList({ exports }: { exports: ExportRow[] | null }) {
  const { session } = useTeam();
  const [error, setError] = useState<string | null>(null);

  async function download(id: number, file: ExportFile) {
    setError(null);
    try {
      // Lien signé, valable 15 minutes : le navigateur télécharge directement le fichier.
      window.location.assign(await exportLink(session, id, file));
    } catch (e) {
      setError(errorText(e as Error));
    }
  }

  return (
    <section className="carte">
      <h2>Versions</h2>
      {error && <p className="message erreur">{error}</p>}
      {exports === null ? (
        <p className="gris">Chargement…</p>
      ) : exports.length === 0 ? (
        <p className="gris">Aucun export pour le moment.</p>
      ) : (
        <div className="tableau-defilant">
          <table className="tableau empile">
            <thead>
              <tr>
                <th>Version</th>
                <th>Demandé le</th>
                <th>État</th>
                <th>Contenu</th>
                <th>Fichiers</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((e) => (
                <tr key={e.id}>
                  <td className="titre-ligne-tableau">
                    v{String(e.version).padStart(3, '0')} · {KINDS[e.kind]}
                  </td>
                  <td data-label="Demandé le">{date(e.requested_at)}</td>
                  <td data-label="État">
                    <span className={STATUS[e.status].className}>{STATUS[e.status].label}</span>
                    {e.status === 'echec' && e.error && (
                      <small className="aide erreur-export">{e.error}</small>
                    )}
                  </td>
                  <td data-label="Contenu">
                    {e.stats ? (
                      <span className="contenu-export">
                        <strong>{formatHours(e.stats.heures)}</strong>
                        <span>
                          {e.stats.audios.toLocaleString('fr-FR')} audios · {e.stats.voix} voix
                        </span>
                        <span className="gris">
                          entraînement {formatHours(e.stats.train.heures)} · examen{' '}
                          {formatHours(e.stats.test.heures)}
                        </span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="actions">
                    {e.status === 'pret' &&
                      DOWNLOADS.map((d) => (
                        <button
                          key={d.file}
                          className={`petit ${d.file === 'archive.zip' ? '' : 'secondaire'}`}
                          onClick={() => void download(e.id, d.file)}
                        >
                          {d.label}
                          {d.file === 'archive.zip' && e.stats?.archive_octets
                            ? ` (${size(e.stats.archive_octets)})`
                            : ''}
                        </button>
                      ))}
                    {e.hf_repo && (
                      <a
                        className="lien-hf"
                        href={`https://huggingface.co/datasets/${e.hf_repo.replace('@', '/tree/')}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Hugging Face ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
