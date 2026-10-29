// Tableau de bord de la langue (spec §5.1, §5.5, §5.6). Les chiffres viennent d'un calcul
// fait par la base toutes les 10 minutes : afficher l'accueil reste léger.

import { useCallback, useEffect, useState } from 'react';
import { WeeklyChart } from '../components/WeeklyChart';
import {
  fillWeeks,
  formatHours,
  formatPercent,
  profileLabel,
  quotaRows,
  since,
  type Dashboard,
} from '../lib/dashboard';
import { navigate } from '../lib/router';
import { errorText, LANGUAGE, useTeam } from '../lib/team';

/** « 9 480 » plutôt que « 9480 ». */
const nb = (n: number) => n.toLocaleString('fr-FR');

const STATUSES: [keyof Dashboard['voix_par_statut'], string][] = [
  ['invitee', 'Invitées'],
  ['inscrite', 'Inscrites'],
  ['test_en_attente', 'Test en attente'],
  ['test_a_refaire', 'Test à refaire'],
  ['active', 'Actives'],
  ['terminee', 'Terminées'],
  ['retiree', 'Retirées'],
];

export function TableauDeBord() {
  const { client, has } = useTeam();
  const [snapshot, setSnapshot] = useState<{ data: Dashboard; computed_at: string } | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const { data, error: dbError } = await client
      .from('dashboard_snapshots')
      .select('data, computed_at')
      .eq('language_code', LANGUAGE)
      .maybeSingle();
    if (dbError) setError(errorText(dbError));
    setSnapshot(data as { data: Dashboard; computed_at: string } | null);
    setNow(new Date());
    return data;
  }, [client]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await client.rpc('refresh_dashboard_now', { p_language: LANGUAGE });
    if (rpcError) setError(errorText(rpcError));
    await load();
    setBusy(false);
  }, [client, load]);

  useEffect(() => {
    // Jamais calculé (base toute neuve) : on le calcule tout de suite.
    void load().then((data) => {
      if (!data) void refresh();
    });
  }, [load, refresh]);

  if (snapshot === undefined) return <p>Chargement du tableau de bord…</p>;

  return (
    <>
      <div className="titre-ligne">
        <h2>Tableau de bord · zarma</h2>
        <span className="aide">
          {snapshot ? `Calculé ${since(snapshot.computed_at, now)}` : 'Pas encore calculé'}{' '}
          <button className="secondaire petit" onClick={() => void refresh()} disabled={busy}>
            {busy ? 'Calcul…' : 'Recalculer maintenant'}
          </button>
        </span>
      </div>
      {error && <p className="message erreur">{error}</p>}
      {snapshot && <Content data={snapshot.data} now={now} has={has} />}
    </>
  );
}

function Content({
  data,
  now,
  has,
}: {
  data: Dashboard;
  now: Date;
  has: ReturnType<typeof useTeam>['has'];
}) {
  const quotas = quotaRows(data);
  const reads = data.phrases_lectures;
  const principal = data.voix_principale;
  const double = data.double_ecoute;

  return (
    <div className="grille-tdb">
      <Alerts data={data} />

      <div className="tuiles pleine">
        <Tile value={formatHours(data.heures.enregistrees)} label="enregistrées (voix variées)" />
        <Tile value={formatHours(data.heures.validees)} label="validées" />
        <Tile
          value={formatPercent(data.taux_rejet)}
          label="taux de rejet"
          note={`${nb(data.audios.rejetes)} rejeté(s) sur ${nb(data.audios.valides + data.audios.rejetes)} audio(s) noté(s)`}
        />
        <Tile
          value={nb(data.audios.recus)}
          label="audio(s) reçu(s)"
          note={`${nb(data.audios.a_verifier)} à vérifier · ${nb(data.audios.doutes)} en doute`}
        />
      </div>

      <section className="carte pleine">
        <h3>Heures par semaine</h3>
        <WeeklyChart weeks={fillWeeks(data.par_semaine, now)} />
      </section>

      <section className="carte pleine">
        <h3>Quotas de diversité</h3>
        {data.repartition.total === 0 ? (
          <p className="aide">Aucune fiche remplie pour le moment.</p>
        ) : (
          <p className="aide">Sur {nb(data.repartition.total)} voix ayant rempli leur fiche.</p>
        )}
        <ul className="quotas">
          {quotas.map((q) => (
            <li key={q.key}>
              <div className="quota-tete">
                <span>{q.label}</span>
                {q.reached === null ? (
                  <span className="etape gris">— Pas de données</span>
                ) : q.reached ? (
                  <span className="etape succes">✓ Atteint</span>
                ) : (
                  <span className="etape alerte">⚠ En dessous</span>
                )}
              </div>
              <span className="jauge" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (q.actual ?? 0) * 100)}%` }} />
                <i style={{ left: `${q.target * 100}%` }} />
              </span>
              <div className="quota-chiffres">
                <strong>{formatPercent(q.actual)}</strong>
                <span className="aide">objectif : au moins {formatPercent(q.target)}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="repartitions">
          <Breakdown title="Sexe" values={data.repartition.sexe} total={data.repartition.total} />
          <Breakdown title="Âge" values={data.repartition.age} total={data.repartition.total} />
          <Breakdown
            title="Région"
            values={data.repartition.region}
            total={data.repartition.total}
          />
          <Breakdown
            title="Langue maternelle"
            values={data.repartition.langue_maternelle}
            total={data.repartition.total}
          />
        </div>
      </section>

      <section className="carte">
        <h3>Voix par statut</h3>
        <div className="chiffres">
          {STATUSES.map(([key, label]) => (
            <div key={key}>
              <strong>{nb(data.voix_par_statut[key])}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="carte">
        <h3>Phrases et lectures validées</h3>
        <p className="aide">Sur {nb(reads.total)} phrase(s) active(s), hors phrases de test.</p>
        <div className="chiffres">
          {(
            [
              [reads.zero, 'aucune lecture'],
              [reads.une, '1 lecture'],
              [reads.deux, '2 lectures'],
              [reads.trois_ou_plus, '3 lectures ou plus'],
            ] as const
          ).map(([n, label]) => (
            <div key={label}>
              <strong>{nb(n)}</strong>
              <span>
                {label} ({formatPercent(reads.total ? n / reads.total : null)})
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="carte">
        <h3>Voix principale</h3>
        {principal.numero === null ? (
          <p className="aide">Aucune voix principale désignée pour le moment (jalon J5).</p>
        ) : (
          <>
            <div className="quota-chiffres">
              <strong>
                {formatPercent(principal.total ? principal.validees / principal.total : null)}
              </strong>
              <span className="aide">
                {nb(principal.validees)} phrase(s) validée(s) sur {nb(principal.total)}
              </span>
            </div>
            <progress max={principal.total || 1} value={principal.validees} />
            <p className="aide">Voix n° {principal.numero}</p>
          </>
        )}
      </section>

      <section className="carte">
        <h3>Voix par recruteur</h3>
        {data.par_recruteur.length === 0 ? (
          <p className="aide">Aucune voix recrutée pour le moment.</p>
        ) : (
          <div className="tableau-defilant">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Recruteur</th>
                  <th>Voix</th>
                  <th>Actives</th>
                  <th>Terminées</th>
                  <th>Audios reçus</th>
                </tr>
              </thead>
              <tbody>
                {data.par_recruteur.map((r) => (
                  <tr key={r.recruteur}>
                    <td>{r.recruteur}</td>
                    <td>{nb(r.voix)}</td>
                    <td>{nb(r.actives)}</td>
                    <td>{nb(r.terminees)}</td>
                    <td>{nb(r.audios)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(has('qualite') || has('admin')) && (
        <section className="carte">
          <div className="titre-ligne">
            <h3>Double écoute</h3>
            {double.a_faire > 0 && (
              <button className="petit" onClick={() => navigate('/ecoute?file=double')}>
                Réécouter ({double.a_faire})
              </button>
            )}
          </div>
          <p className="aide">
            Chaque lundi, {formatPercent(double.part)} des audios validés de la semaine sont
            réécoutés à l’aveugle par le responsable qualité.
          </p>
          <div className="chiffres">
            <div>
              <strong>{nb(double.a_faire)}</strong>
              <span>à réécouter</span>
            </div>
            <div>
              <strong>{nb(double.faites)}</strong>
              <span>réécouté(s)</span>
            </div>
            <div>
              <strong>
                {formatPercent(double.faites ? double.desaccords / double.faites : null)}
              </strong>
              <span>de désaccord ({double.desaccords})</span>
            </div>
          </div>
          {double.par_verificateur.length > 0 && (
            <div className="tableau-defilant">
              <table className="tableau">
                <thead>
                  <tr>
                    <th>Vérificateur (1re écoute)</th>
                    <th>Réécoutés</th>
                    <th>Désaccords</th>
                    <th>Taux</th>
                  </tr>
                </thead>
                <tbody>
                  {double.par_verificateur.map((v) => (
                    <tr key={v.verificateur}>
                      <td>{v.verificateur}</td>
                      <td>{nb(v.faites)}</td>
                      <td>{nb(v.desaccords)}</td>
                      <td>{formatPercent(v.faites ? v.desaccords / v.faites : null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {has('admin') && (
        <section className="carte">
          <h3>Vérifications automatiques (worker)</h3>
          <div className="chiffres">
            <div>
              <strong>{nb(data.taches.en_attente)}</strong>
              <span>tâche(s) en attente</span>
            </div>
            <div>
              <strong>{nb(data.taches.en_echec)}</strong>
              <span>en échec</span>
            </div>
            <div>
              <strong>{nb(data.audios.suspects)}</strong>
              <span>audio(s) suspect(s)</span>
            </div>
          </div>
          <p className="aide">
            Dernière tâche terminée :{' '}
            {data.taches.derniere_terminee ? since(data.taches.derniere_terminee, now) : 'aucune'}.
            Le worker passe toutes les 15 minutes environ ; si les tâches en attente s’accumulent,
            il ne tourne plus.
          </p>
        </section>
      )}
    </div>
  );
}

function Alerts({ data }: { data: Dashboard }) {
  const { voix_trop_de_rejets: rejections, audios_en_attente: waiting } = data.alertes;
  if (rejections.length === 0 && waiting.nombre === 0) return null;
  return (
    <div className="message alerte alertes pleine" role="status">
      {rejections.map((v) => (
        <p key={v.numero}>
          ⚠ Voix n° {v.numero} : {v.rejets} rejets sur ses {v.sur} derniers audios notés.
        </p>
      ))}
      {waiting.nombre > 0 && (
        <p>
          ⚠ {waiting.nombre} audio(s) attendent une vérification depuis plus de {waiting.jours}{' '}
          jours
          {waiting.plus_ancien &&
            ` (le plus ancien depuis le ${new Date(waiting.plus_ancien).toLocaleDateString('fr-FR')})`}
          .
        </p>
      )}
    </div>
  );
}

function Tile({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="tuile">
      <strong>{value}</strong>
      <span>{label}</span>
      {note && <small className="aide">{note}</small>}
    </div>
  );
}

function Breakdown({
  title,
  values,
  total,
}: {
  title: string;
  values: Record<string, number>;
  total: number;
}) {
  const rows = Object.entries(values).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <h4>{title}</h4>
      {rows.length === 0 ? (
        <p className="aide">—</p>
      ) : (
        <table className="tableau compact">
          <tbody>
            {rows.map(([code, n]) => (
              <tr key={code}>
                <td>{profileLabel(code)}</td>
                <td>{n}</td>
                <td className="aide">{formatPercent(total ? n / total : null)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Page « Tableau de bord » (liée depuis l'accueil et le menu). */
export function TableauDeBordPage() {
  return (
    <>
      <h1>Tableau de bord</h1>
      <TableauDeBord />
    </>
  );
}
