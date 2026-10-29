// Journal d'activité (spec §5.10), pour les admins : qui a fait quoi, et quand. Il ne
// contient aucune donnée personnelle des voix (numéros seulement) et ne peut pas être modifié.

import { useCallback, useEffect, useState } from 'react';
import { errorText, useTeam } from '../lib/team';

interface Entry {
  id: number;
  date: string;
  action: string;
  par: string;
  cible: string | null;
  details: Record<string, unknown>;
}

/** Libellés des actions, dans l'ordre du filtre. */
const ACTIONS: Record<string, string> = {
  retrait_voix: 'Voix retirée',
  demande_retrait: 'Retrait demandé',
  demande_retrait_annulee: 'Demande de retrait annulée',
  acces_identite: 'Identité consultée',
  recherche_identite: 'Recherche par nom ou numéro',
  consentement_oral: 'Consentement oral enregistré',
  test_envoye: 'Test envoyé par la voix',
  test_valide: 'Test validé',
  test_a_refaire: 'Test à refaire',
  audio_valide: 'Audio validé',
  audio_corrige: 'Audio corrigé (texte modifié)',
  audio_rejete: 'Audio rejeté',
  audio_doute: 'Audio mis en doute',
  double_ecoute: 'Double écoute',
  import_phrases: 'Import de phrases',
  phrase_desactivee: 'Phrase désactivée',
  phrase_reactivee: 'Phrase réactivée',
  membre_ajoute: 'Membre ajouté',
  membre_modifie: 'Rôles d’un membre modifiés',
  mot_de_passe_change: 'Mot de passe donné par un admin',
  voix_examen: 'Voix examen modifiées',
  export_demande: 'Export demandé',
  export_termine: 'Export prêt',
  export_telecharge: 'Export téléchargé',
  voix_principale: 'Voix principale désignée ou retirée',
  reference_choisie: 'Audio de référence choisi',
  audio_accord: 'Audio de l’accord envoyé',
  lecture_assistee: '« Écouter puis répéter » activé ou arrêté',
};

/** Détail court et lisible selon l'action. */
function detail(entry: Entry): string {
  const d = entry.details;
  switch (entry.action) {
    case 'retrait_voix':
      return `${d.audios ?? 0} audio(s) effacé(s)`;
    case 'recherche_identite':
      return `${d.resultats ?? 0} résultat(s)`;
    case 'import_phrases':
      return `${d.ajoutees ?? 0} ajoutée(s), ${d.modifiees ?? 0} modifiée(s), ${d.erreurs ?? 0} erreur(s)`;
    case 'double_ecoute':
      return d.accord ? 'même décision' : 'désaccord';
    case 'membre_ajoute':
    case 'membre_modifie':
      return `rôles : ${((d.roles as string[] | undefined) ?? []).join(', ') || 'aucun'}${d.actif === false ? ' (désactivé)' : ''}`;
    case 'voix_examen':
      return `ajoutées : ${((d.ajoutees as string[] | undefined) ?? []).join(', ') || 'aucune'} ; retirées : ${((d.retirees as string[] | undefined) ?? []).join(', ') || 'aucune'}`;
    case 'export_demande':
    case 'export_termine':
      return `v${String(d.version ?? '').padStart(3, '0')} · ${d.type === 'principale' ? 'voix principale' : 'voix variées'}${d.heures != null ? ` · ${d.heures} h` : ''}`;
    case 'export_telecharge':
      return String(d.fichier ?? '');
    default:
      return '';
  }
}

const PAGE = 50;

export function JournalPage() {
  const { client } = useTeam();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [members, setMembers] = useState<{ user_id: string; display_name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (before: number | null) => {
      const { data, error: rpcError } = await client.rpc('journal', {
        p_before_id: before,
        p_limit: PAGE,
        p_action: action || null,
        p_actor: actor || null,
      });
      if (rpcError) {
        setError(errorText(rpcError));
        return [];
      }
      const page = data as Entry[];
      setMore(page.length === PAGE);
      return page;
    },
    [client, action, actor],
  );

  useEffect(() => {
    setEntries(null);
    void fetchPage(null).then(setEntries);
  }, [fetchPage]);

  useEffect(() => {
    void client
      .from('team_members')
      .select('user_id, display_name')
      .order('display_name')
      .then(({ data }) => setMembers((data as typeof members | null) ?? []));
  }, [client]);

  async function loadMore() {
    const last = entries?.at(-1);
    if (!last) return;
    const page = await fetchPage(last.id);
    setEntries((current) => [...(current ?? []), ...page]);
  }

  return (
    <>
      <h1>Journal</h1>
      <p className="aide intro">
        Toutes les actions sensibles, de la plus récente à la plus ancienne. Le journal ne peut être
        ni modifié ni effacé, et ne contient jamais le nom d’une voix.
      </p>
      <section className="carte">
        <div className="filtres">
          <div>
            <label htmlFor="filtre-action">Action</label>
            <select id="filtre-action" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Toutes</option>
              {Object.entries(ACTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filtre-membre">Membre</label>
            <select id="filtre-membre" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="">Tous</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="message erreur">{error}</p>}
        {!entries ? (
          <p>Chargement…</p>
        ) : entries.length === 0 ? (
          <p className="aide">Aucune action pour ces filtres.</p>
        ) : (
          <>
            <div className="tableau-defilant">
              <table className="tableau empile">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Action</th>
                    <th>Par</th>
                    <th>Concerne</th>
                    <th>Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="titre-ligne-tableau">
                        {new Date(e.date).toLocaleString('fr-FR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>
                      <td data-label="Action">
                        <span className={e.action === 'retrait_voix' ? 'etape alerte' : 'etape'}>
                          {ACTIONS[e.action] ?? e.action}
                        </span>
                      </td>
                      <td data-label="Par">{e.par}</td>
                      <td data-label="Concerne">{e.cible ?? '—'}</td>
                      <td data-label="Détail" className="aide">
                        {detail(e) || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {more && (
              <button className="secondaire voir-plus" onClick={() => void loadMore()}>
                Voir plus
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}
