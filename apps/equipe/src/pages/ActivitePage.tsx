// Activité (admins) : vue d'ensemble du travail de chaque membre sur une période — audios
// décidés et répartition des décisions, audios par jour, rythme, accord avec le responsable
// qualité en double écoute, recrutement. L'écoute reste une file commune : cette page sert à
// voir qui fait quoi, pas à répartir.

import { useCallback, useEffect, useState } from 'react';
import { Squelette } from '../components/Squelette';
import { useMemoire } from '../lib/memoire';
import { errorText, useTeam } from '../lib/team';
import { ROLE_LABELS, type Role } from '../supabase';

interface Activity {
  jours: number;
  depuis: string;
  equipe: { decisions: number; a_verifier: number; doutes: number };
  membres: MemberActivity[];
}

interface MemberActivity {
  user_id: string;
  nom: string;
  roles: Role[];
  actif: boolean;
  derniere_connexion: string | null;
  derniere_action: string | null;
  ecoute: {
    premieres: number;
    valide: number;
    corrige: number;
    rejete: number;
    doute: number;
    arbitrages: number;
    doubles: number;
    rythme_s: number | null;
    par_jour: { jour: string; n: number }[] | null;
  };
  controle: { controles: number; accords: number };
  recrutement: { invitations: number; tests_valides: number; tests_a_refaire: number };
}

const PERIODS: [number, string][] = [
  [1, 'Aujourd’hui'],
  [7, '7 jours'],
  [30, '30 jours'],
];

const DECISIONS: { key: 'valide' | 'corrige' | 'rejete' | 'doute'; label: string }[] = [
  { key: 'valide', label: 'Validés' },
  { key: 'corrige', label: 'Corrigés' },
  { key: 'rejete', label: 'Rejetés' },
  { key: 'doute', label: 'Doutes' },
];

/** En dessous, l'accord avec le responsable qualité mérite qu'on en parle avec le membre. */
const AGREEMENT_ALERT = 0.8;

const nb = (n: number) => n.toLocaleString('fr-FR');

/** « il y a 5 min », « il y a 3 h », « hier », « le 12/10 », « jamais ». */
function ago(date: string | null): string {
  if (!date) return 'jamais';
  const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60_000);
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 24 * 60) return `il y a ${Math.round(minutes / 60)} h`;
  if (minutes < 48 * 60) return 'hier';
  return `le ${new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
}

/** « 25 s », « 1 min 10 ». */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const s = seconds % 60;
  return `${Math.floor(seconds / 60)} min${s ? ` ${String(s).padStart(2, '0')}` : ''}`;
}

export function ActivitePage() {
  const { client, langue } = useTeam();
  const [days, setDays] = useState(7);
  // Chaque période déjà vue s'affiche tout de suite, puis se met à jour.
  const [data, setData] = useMemoire<Activity>(`activite:${langue.code}:${days}`);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: result, error: rpcError } = await client.rpc('team_activity', {
      p_language: langue.code,
      p_days: days,
    });
    if (rpcError) setError(errorText(rpcError));
    else setData(result as Activity);
  }, [client, langue.code, days, setData]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h1>
        Activité. <span className="doux">Qui fait quoi.</span>
      </h1>
      <div className="segments" role="tablist" aria-label="Période">
        {PERIODS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={days === value}
            className={days === value ? 'actif' : ''}
            onClick={() => setDays(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="message erreur">{error}</p>}
      {!data ? (
        !error && (
          <div aria-busy="true" aria-label="Chargement de l’activité">
            <div className="chiffres-equipe">
              {[0, 1, 2].map((i) => (
                <div key={i} className="chiffre">
                  <strong>
                    <Squelette largeur="3ch" />
                  </strong>
                  <span>
                    <Squelette largeur="8ch" />
                  </span>
                </div>
              ))}
            </div>
            <div className="cartes-activite">
              <div className="carte-attente" />
              <div className="carte-attente" />
            </div>
          </div>
        )
      ) : (
        <>
          <div className="chiffres-equipe">
            <div className="chiffre">
              <strong>{nb(data.equipe.decisions)}</strong>
              <span>audios décidés</span>
            </div>
            <div className="chiffre">
              <strong>{nb(data.equipe.a_verifier)}</strong>
              <span>restent à vérifier</span>
            </div>
            <div className="chiffre">
              <strong>{nb(data.equipe.doutes)}</strong>
              <span>doutes à trancher</span>
            </div>
          </div>
          <div className="cartes-activite">
            {data.membres.map((m) => (
              <MemberCard key={m.user_id} member={m} days={data.jours} />
            ))}
          </div>
          <p className="aide">
            Le rythme est le temps habituel entre deux décisions qui se suivent (les pauses de plus
            de 10 minutes ne comptent pas). La double écoute montre combien de ses décisions le
            responsable qualité, en les réécoutant sans les voir, a confirmées.
          </p>
        </>
      )}
    </>
  );
}

function MemberCard({ member: m, days }: { member: MemberActivity; days: number }) {
  const e = m.ecoute;
  const total = e.premieres + e.arbitrages + e.doubles;
  const listens = m.roles.some((r) => r === 'verificateur' || r === 'qualite' || r === 'admin');
  const recruits = m.roles.some((r) => r === 'recruteur' || r === 'admin');
  const agreement = m.controle.controles > 0 ? m.controle.accords / m.controle.controles : null;
  const extras = [
    e.arbitrages > 0 && `${nb(e.arbitrages)} doute(s) tranché(s)`,
    e.doubles > 0 && `${nb(e.doubles)} double(s) écoute(s)`,
  ].filter(Boolean);

  return (
    <section className="carte carte-membre">
      <div className="fiche-tete">
        <span className="rond-initiale clair" aria-hidden="true">
          {m.nom.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div>
          <strong>
            {m.nom}
            {!m.actif && <span className="aide"> (désactivé)</span>}
          </strong>
          <span className="aide">
            {m.roles.map((r) => ROLE_LABELS[r]).join(' · ') || 'aucun rôle'} · dernière action{' '}
            {ago(m.derniere_action ?? m.derniere_connexion)}
          </span>
        </div>
      </div>

      {(listens || total > 0) && (
        <div className="activite-ecoute">
          <p className="activite-total">
            <strong>{nb(total)}</strong> audio(s) écouté(s)
            {extras.length > 0 && <span className="aide"> · dont {extras.join(', ')}</span>}
          </p>
          {e.premieres > 0 && <DecisionBar ecoute={e} />}
          {days > 1 && e.par_jour && <DayBars days={e.par_jour} />}
          <dl className="activite-faits">
            {e.rythme_s !== null && (
              <div>
                <dt>Rythme</dt>
                <dd>≈ {duration(e.rythme_s)} par audio</dd>
              </div>
            )}
            {agreement !== null && (
              <div className={agreement < AGREEMENT_ALERT ? 'a-surveiller' : ''}>
                <dt>Double écoute</dt>
                <dd>
                  {nb(m.controle.accords)} sur {nb(m.controle.controles)} confirmée(s) (
                  {Math.round(agreement * 100)} %)
                  {agreement < AGREEMENT_ALERT && ' · à revoir ensemble'}
                </dd>
              </div>
            )}
          </dl>
          {total === 0 && <p className="aide">Aucune écoute sur la période.</p>}
        </div>
      )}

      {recruits && (
        <p className="activite-recrutement">
          <strong>Recrutement :</strong> {nb(m.recrutement.invitations)} invitation(s) ·{' '}
          {nb(m.recrutement.tests_valides)} test(s) validé(s)
          {m.recrutement.tests_a_refaire > 0 && ` · ${nb(m.recrutement.tests_a_refaire)} à refaire`}
        </p>
      )}
    </section>
  );
}

/** Répartition des décisions : une barre en segments, toujours avec les nombres écrits. */
function DecisionBar({ ecoute }: { ecoute: MemberActivity['ecoute'] }) {
  const total = ecoute.premieres;
  return (
    <div className="decisions-barre">
      <div className="barre-segments" aria-hidden="true">
        {DECISIONS.filter((d) => ecoute[d.key] > 0).map((d) => (
          <span
            key={d.key}
            className={`segment ${d.key}`}
            style={{ flexGrow: ecoute[d.key] }}
            title={`${d.label} : ${nb(ecoute[d.key])}`}
          />
        ))}
      </div>
      <ul className="legende-decisions">
        {DECISIONS.map((d) => (
          <li key={d.key}>
            <span className={`puce ${d.key}`} aria-hidden="true" />
            {d.label} <strong>{nb(ecoute[d.key])}</strong>
            <span className="aide"> ({Math.round((ecoute[d.key] / total) * 100)} %)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Audios par jour : petites barres, le détail au survol (ou au toucher sur téléphone). */
function DayBars({ days }: { days: { jour: string; n: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  const label = (d: { jour: string; n: number }) =>
    `${new Date(`${d.jour}T12:00:00`).toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    })} : ${nb(d.n)} audio(s)`;
  const best = days.reduce((a, b) => (b.n > a.n ? b : a));
  return (
    <figure className="barres-jours">
      <div
        className="barres-jours-trace"
        role="img"
        aria-label={`Audios par jour. Meilleur jour : ${label(best)}.`}
      >
        {days.map((d) => (
          <span key={d.jour} className="barre-jour" title={label(d)}>
            <span style={{ height: `${Math.max(d.n > 0 ? 6 : 2, (d.n / max) * 100)}%` }} />
          </span>
        ))}
      </div>
      <figcaption className="aide">
        Par jour · meilleur : {nb(best.n)} ({label(best).split(' : ')[0]})
      </figcaption>
    </figure>
  );
}
