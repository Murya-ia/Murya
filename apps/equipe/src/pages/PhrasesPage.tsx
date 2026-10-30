// Gestion des phrases (spec §5.2) : import CSV depuis Google Sheets (admin), liste avec les
// lectures validées et les signalements « je n'arrive pas à lire », désactivation, et liste
// des mots décidés (orthographe).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  csvToObjects,
  ORTHOGRAPHY_ALERT_TEXT,
  orthographyAlerts,
  parseCsv,
  type OrthographyAlert,
} from '@murya/commun';
import { errorText, useTeam } from '../lib/team';

interface SentenceRow {
  id: number;
  code: string;
  text: string;
  translation_fr: string | null;
  theme: string | null;
  active: boolean;
  is_test: boolean;
  version: number;
  validated_reads: number;
  pending_reads: number;
}

const PAGE_SIZE = 1000; // limite de Supabase par requête

export function PhrasesPage() {
  const { client, has, langue } = useTeam();
  const [sentences, setSentences] = useState<SentenceRow[] | null>(null);
  const [flags, setFlags] = useState<Map<number, number>>(new Map());
  const [search, setSearch] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const all: SentenceRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error: loadError } = await client
        .from('sentences')
        .select(
          'id, code, text, translation_fr, theme, active, is_test, version, validated_reads, pending_reads',
        )
        .eq('language_code', langue.code)
        .order('code')
        .range(from, from + PAGE_SIZE - 1);
      if (loadError) return setError(errorText(loadError));
      all.push(...(data as SentenceRow[]));
      if (data.length < PAGE_SIZE) break;
    }
    setSentences(all);
    const { data: flagRows } = await client
      .from('sentence_flags')
      .select('sentence_id, sentences!inner(language_code)')
      .eq('sentences.language_code', langue.code);
    const counts = new Map<number, number>();
    for (const row of flagRows ?? []) {
      counts.set(row.sentence_id as number, (counts.get(row.sentence_id as number) ?? 0) + 1);
    }
    setFlags(counts);
  }, [client, langue.code]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (sentences ?? []).filter(
      (s) =>
        (!onlyFlagged || flags.has(s.id)) &&
        (!needle ||
          s.code.toLowerCase().includes(needle) ||
          s.text.toLowerCase().includes(needle) ||
          (s.translation_fr ?? '').toLowerCase().includes(needle)),
    );
  }, [sentences, search, onlyFlagged, flags]);

  async function toggleActive(sentence: SentenceRow) {
    const { error: updateError } = await client
      .from('sentences')
      .update({ active: !sentence.active })
      .eq('id', sentence.id);
    if (updateError) setError(errorText(updateError));
    else void load();
  }

  const stats = useMemo(() => {
    const list = (sentences ?? []).filter((s) => s.active && !s.is_test);
    const byReads = [0, 1, 2, 3].map(
      (n) =>
        list.filter((s) => (n === 3 ? s.validated_reads >= 3 : s.validated_reads === n)).length,
    );
    return { total: list.length, byReads };
  }, [sentences]);

  return (
    <>
      <h1>Phrases</h1>
      {has('admin') && <CsvImport onImported={() => void load()} />}
      {error && <p className="message erreur">{error}</p>}

      <section className="carte">
        <h2>Phrases · {langue.name_fr.toLowerCase()}</h2>
        {sentences && (
          <p className="aide">
            {stats.total} phrases actives · lectures validées : 0 → {stats.byReads[0]}, 1 →{' '}
            {stats.byReads[1]}, 2 → {stats.byReads[2]}, 3 ou plus → {stats.byReads[3]}
          </p>
        )}
        <div className="filtres">
          <input
            placeholder={`Chercher (code, ${langue.name_fr.toLowerCase()}, français)…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="case-ligne">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.target.checked)}
            />
            Seulement les phrases signalées ({flags.size})
          </label>
        </div>
        {!sentences ? (
          <p>Chargement…</p>
        ) : (
          <div className="tableau-defilant haut">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>{langue.name_fr}</th>
                  <th>Français</th>
                  <th>Lectures</th>
                  <th>Signalée</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 500).map((s) => (
                  <tr key={s.id} className={s.active ? '' : 'inactive'}>
                    <td>
                      {s.code}
                      {s.is_test && <span className="pastille-discrete">test</span>}
                      {s.version > 1 && <span className="pastille-discrete">v{s.version}</span>}
                    </td>
                    <td lang={langue.code}>{s.text}</td>
                    <td className="aide">{s.translation_fr}</td>
                    <td>
                      {s.validated_reads}
                      {s.pending_reads > 0 && <span className="aide"> (+{s.pending_reads})</span>}
                    </td>
                    <td>{flags.get(s.id) ? `${flags.get(s.id)} fois` : ''}</td>
                    <td>
                      {has('admin') ? (
                        <button className="petit lien" onClick={() => void toggleActive(s)}>
                          {s.active ? 'Désactiver' : 'Réactiver'}
                        </button>
                      ) : s.active ? (
                        'Active'
                      ) : (
                        'Inactive'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length > 500 && (
              <p className="aide">
                500 premières phrases affichées sur {visible.length} : affinez la recherche.
              </p>
            )}
          </div>
        )}
      </section>

      <OrthographyDecisions />
    </>
  );
}

/** Import d'un CSV exporté de Google Sheets, avec aperçu et alertes d'orthographe. */
function CsvImport({ onImported }: { onImported: () => void }) {
  const { client, langue } = useTeam();
  // Le texte est dans la colonne qui porte le nom de la langue (« zarma », « kanouri »…).
  const column = langue.mother_tongue_code;
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isValidated = (row: Record<string, string>) =>
    ['validee', 'valide'].includes(
      (row.statut ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''),
    );

  async function readFile(file: File) {
    setResult(null);
    setError(null);
    setFileName(file.name);
    const objects = csvToObjects(parseCsv(await file.text()));
    const missing = ['id', column, 'statut'].filter(
      (k) => objects.length > 0 && !(k in objects[0]!),
    );
    if (missing.length > 0) {
      setRows(null);
      return setError(`Colonnes manquantes dans le fichier : ${missing.join(', ')}.`);
    }
    setRows(objects);
  }

  const validated = rows?.filter(isValidated) ?? [];
  const alerts = validated
    .map((row) => ({ row, alerts: orthographyAlerts(row[column] ?? '', langue.code) }))
    .filter((a) => a.alerts.length > 0);

  async function runImport() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await client.rpc('import_sentences', {
      p_language: langue.code,
      // Seules les lignes « Validée » comptent : les autres partent vides (elles gardent leur
      // place, pour que les numéros de ligne des erreurs restent justes). Un fichier de
      // milliers de phrases à écrire reste ainsi léger à envoyer.
      p_rows: rows.map((row) => (isValidated(row) ? row : {})),
    });
    setBusy(false);
    if (rpcError) return setError(errorText(rpcError));
    setResult(data as Record<string, unknown>);
    setRows(null);
    onImported();
  }

  return (
    <section className="carte">
      <h2>Importer des phrases</h2>
      <p className="aide">
        Dans Google Sheets : Fichier → Télécharger → CSV. Colonnes attendues : id, {column},
        francais, theme, auteur, relu_par, statut (et « test » = oui pour les 5 phrases du test).
        Seules les lignes au statut « Validée » sont importées ; une phrase existante est mise à
        jour par son id, avec une nouvelle version si son texte change.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => e.target.files?.[0] && void readFile(e.target.files[0])}
      />
      {error && <p className="message erreur">{error}</p>}

      {rows && (
        <div className="apercu">
          <p>
            <strong>{fileName}</strong> : {rows.length} lignes, dont{' '}
            <strong>{validated.length}</strong> « Validée ».
          </p>
          {alerts.length > 0 ? (
            <div className="message alerte">
              <p>
                {alerts.length} phrase(s) à vérifier avant l’import (orthographe officielle de 1999)
                :
              </p>
              <ul>
                {alerts.slice(0, 30).map(({ row, alerts: list }) => (
                  <li key={row.id}>
                    <strong>{row.id}</strong> <span lang={langue.code}>« {row[column]} »</span> —{' '}
                    {list.map((a: OrthographyAlert) => ORTHOGRAPHY_ALERT_TEXT[a]).join(' ')}
                  </li>
                ))}
              </ul>
              {alerts.length > 30 && <p>… et {alerts.length - 30} autre(s).</p>}
            </div>
          ) : (
            <p className="message succes">Aucune alerte d’orthographe.</p>
          )}
          <button onClick={() => void runImport()} disabled={busy || validated.length === 0}>
            {busy ? 'Import…' : `Importer ${validated.length} phrase(s)`}
          </button>
        </div>
      )}

      {result && (
        <div className="message succes">
          <p>
            Import terminé : {String(result.ajoutees)} ajoutée(s), {String(result.modifiees)}{' '}
            modifiée(s) (dont {String(result.nouvelles_versions)} nouvelle(s) version(s)),{' '}
            {String(result.inchangees)} inchangée(s), {String(result.ignorees)} ignorée(s) (pas «
            Validée »).
          </p>
          {(result.erreurs as { ligne: number; id: string; erreur: string }[]).map((e) => (
            <p key={e.ligne} className="erreur-ligne">
              Ligne {e.ligne} ({e.id || 'sans id'}) :{' '}
              {e.erreur === 'id_invalide' ? 'identifiant invalide' : 'texte vide'}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

interface Decision {
  id: number;
  word: string;
  chosen_spelling: string;
  rejected_variants: string[];
  note: string | null;
  decided_at: string;
}

/** Liste des mots décidés (spec §5.2) : tenue par le responsable qualité. */
function OrthographyDecisions() {
  const { client, member, has, langue } = useTeam();
  const canEdit = has('qualite') || has('admin');
  const [decisions, setDecisions] = useState<Decision[] | null>(null);
  const [word, setWord] = useState('');
  const [spelling, setSpelling] = useState('');
  const [variants, setVariants] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await client
      .from('orthography_decisions')
      .select('id, word, chosen_spelling, rejected_variants, note, decided_at')
      .eq('language_code', langue.code)
      .order('word');
    setDecisions((data as Decision[]) ?? []);
  }, [client, langue.code]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const nfc = (s: string) => s.trim().normalize('NFC');
    const { error: insertError } = await client.from('orthography_decisions').insert({
      language_code: langue.code,
      word: nfc(word),
      chosen_spelling: nfc(spelling),
      rejected_variants: variants.split(',').map(nfc).filter(Boolean),
      note: note.trim() || null,
      decided_by: member.user_id,
    });
    if (insertError) return setError(errorText(insertError));
    setWord('');
    setSpelling('');
    setVariants('');
    setNote('');
    void load();
  }

  return (
    <section className="carte">
      <h2>Mots décidés (orthographe)</h2>
      {canEdit && (
        <form className="ligne-formulaire" onSubmit={(e) => void add(e)}>
          <div>
            <label htmlFor="mot">Mot</label>
            <input
              id="mot"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              required
              lang={langue.code}
            />
          </div>
          <div>
            <label htmlFor="retenue">Orthographe retenue</label>
            <input
              id="retenue"
              value={spelling}
              onChange={(e) => setSpelling(e.target.value)}
              required
              lang={langue.code}
            />
          </div>
          <div>
            <label htmlFor="variantes">Variantes refusées (séparées par des virgules)</label>
            <input
              id="variantes"
              value={variants}
              onChange={(e) => setVariants(e.target.value)}
              lang={langue.code}
            />
          </div>
          <div>
            <label htmlFor="note">Note</label>
            <input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="submit">Ajouter</button>
        </form>
      )}
      {error && <p className="message erreur">{error}</p>}
      {decisions && decisions.length === 0 && (
        <p className="aide">Aucun mot décidé pour le moment.</p>
      )}
      {decisions && decisions.length > 0 && (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr>
                <th>Mot</th>
                <th>Orthographe retenue</th>
                <th>Variantes refusées</th>
                <th>Note</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td lang={langue.code}>{d.word}</td>
                  <td lang={langue.code}>
                    <strong>{d.chosen_spelling}</strong>
                  </td>
                  <td lang={langue.code}>{d.rejected_variants.join(', ')}</td>
                  <td>{d.note}</td>
                  <td className="aide">{new Date(d.decided_at).toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
