// Accueil : ce qui attend la personne connectée, en un écran : le travail principal (souvent
// l'écoute) en grand, la liste « À faire », et un lien vers le tableau de bord.

import { useEffect } from 'react';
import { Squelette } from '../components/Squelette';
import { useMemoire } from '../lib/memoire';
import { navigate } from '../lib/router';
import { LANGUAGE, useTeam } from '../lib/team';
import { Chevron, IconeGraphique } from '../components/Icones';
import { prefetchDashboard } from './TableauDeBord';

/** Compteurs de l'écoute : mêmes règles que la file (voir `review_counts` en base). */
export interface ReviewCounts {
  a_verifier: number;
  a_verifier_vos_recrues: number;
  doutes: number;
  doutes_vos_recrues: number;
}

interface Counts {
  tests: number | null;
  review: ReviewCounts | null;
  flags: number | null;
  withdrawals: number | null;
}

export function AccueilPage() {
  const { client, member, has } = useTeam();
  // Les derniers chiffres connus s'affichent tout de suite ; la base les met à jour ensuite.
  const [counts, setCounts] = useMemoire<Counts>(`accueil:${member.user_id}`);

  useEffect(() => {
    void (async () => {
      let testsQuery = client
        .from('speakers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'test_en_attente');
      if (!has('admin')) testsQuery = testsQuery.eq('recruiter_id', member.user_id);
      // Les quatre questions partent ensemble (et non l'une après l'autre).
      const [tests, review, flags, withdrawals] = await Promise.all([
        testsQuery,
        client.rpc('review_counts', { p_language: LANGUAGE }),
        client.from('sentence_flags').select('id', { count: 'exact', head: true }),
        client.from('withdrawal_requests').select('speaker_id', { count: 'exact', head: true }),
      ]);
      setCounts({
        tests: tests.count,
        review: review.data as ReviewCounts,
        flags: flags.count,
        withdrawals: withdrawals.count,
      });
      // Le tableau de bord se charge pendant qu'on lit l'accueil : il s'ouvrira sans attente.
      void prefetchDashboard(client);
    })();
  }, [client, member.user_id, has, setCounts]);

  const tests = counts?.tests ?? null;
  const review = counts?.review ?? null;
  const flags = counts?.flags ?? null;
  const withdrawals = counts?.withdrawals ?? null;

  const listens = has('verificateur') || has('qualite') || has('admin');
  const recruits = has('recruteur') || has('admin');

  // Le bloc principal : l'écoute d'abord, sinon les tests des voix, sinon les phrases.
  const main = listens
    ? {
        n: review?.a_verifier ?? null,
        label: 'audios à vérifier',
        note: ownRecruits(review?.a_verifier_vos_recrues),
        action: 'Commencer l’écoute',
        path: '/ecoute',
        kicker: 'Écoute',
      }
    : recruits
      ? {
          n: tests,
          label: 'tests de voix à écouter',
          note: null,
          action: 'Voir les voix',
          path: '/voix',
          kicker: 'Voix',
        }
      : {
          n: flags,
          label: 'phrases signalées',
          note: null,
          action: 'Voir les phrases',
          path: '/phrases',
          kicker: 'Phrases',
        };

  const todo = [
    // Une demande de retrait passe avant tout le reste (droit à l'effacement).
    has('admin') && withdrawals
      ? { n: withdrawals, label: 'Demandes de retrait', path: '/voix', tone: 'rouge' }
      : null,
    listens && recruits
      ? { n: tests, label: 'Tests de voix à écouter', path: '/voix', tone: 'vert' }
      : null,
    has('qualite') || has('admin')
      ? {
          n: review?.doutes ?? null,
          label: 'Doutes à trancher',
          path: '/ecoute?file=doutes',
          tone: 'ambre',
        }
      : null,
    listens || recruits
      ? { n: flags, label: 'Phrases signalées', path: '/phrases', tone: '' }
      : null,
  ].filter((c) => c !== null);

  return (
    <div className="accueil">
      <div>
        <h1>
          Bonjour {member.display_name}. <span className="doux">Voici ce qui vous attend.</span>
        </h1>
        {member.roles.length === 0 && (
          <p className="message alerte">
            Vous n’avez encore aucun rôle : demandez à un admin de vous en donner.
          </p>
        )}
      </div>
      <div className="accueil-grille">
        <section className="bloc-principal">
          <div>
            <p className="bloc-sur-titre">{main.kicker}</p>
            <p className="bloc-chiffre">
              {main.n?.toLocaleString('fr-FR') ?? <Squelette largeur="2.6ch" />}
            </p>
            <p className="bloc-libelle">{main.label}</p>
            {main.note && <p className="bloc-note">{main.note}</p>}
          </div>
          <button className="avec-fleche bouton-clair" onClick={() => navigate(main.path)}>
            {main.action}
            <span className="rond" aria-hidden="true">
              →
            </span>
          </button>
        </section>
        {todo.length > 0 && (
          <section className="liste-lignes">
            <h2>À faire</h2>
            {todo.map((item) => (
              <button key={item.label} className="ligne" onClick={() => navigate(item.path)}>
                <span className="ligne-texte">{item.label}</span>
                <span className={`nombre ${item.tone}`}>
                  {item.n?.toLocaleString('fr-FR') ?? <Squelette largeur="1.4ch" />}
                </span>
                <Chevron />
              </button>
            ))}
          </section>
        )}
      </div>
      <button className="ligne carte-lien" onClick={() => navigate('/tableau-de-bord')}>
        <span className="ligne-icone" aria-hidden="true">
          <IconeGraphique />
        </span>
        <span className="ligne-texte">
          <strong>Tableau de bord</strong>
          <small>Heures, quotas de diversité, voix par statut, double écoute</small>
        </span>
        <Chevron />
      </button>
    </div>
  );
}

/** Les audios de ses propres recrues ne sont jamais proposés : on le dit, sans les compter. */
export function ownRecruits(n: number | undefined): string | null {
  if (!n) return null;
  return `+ ${n} de vos recrues, pour un autre membre.`;
}
