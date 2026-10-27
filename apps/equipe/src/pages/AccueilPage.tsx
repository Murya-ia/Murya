// Accueil : ce qui attend la personne connectée (tests à écouter, audios à vérifier…).
// Le tableau de bord complet (heures, quotas, graphiques) arrive au J4.

import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { LANGUAGE, useTeam } from '../lib/team';
import { ROLE_LABELS } from '../supabase';

/** Compteurs de l'écoute : mêmes règles que la file (voir `review_counts` en base). */
export interface ReviewCounts {
  a_verifier: number;
  a_verifier_vos_recrues: number;
  doutes: number;
  doutes_vos_recrues: number;
}

export function AccueilPage() {
  const { client, member, has } = useTeam();
  const [tests, setTests] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewCounts | null>(null);
  const [flags, setFlags] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      let testsQuery = client
        .from('speakers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'test_en_attente');
      if (!has('admin')) testsQuery = testsQuery.eq('recruiter_id', member.user_id);
      setTests((await testsQuery).count);
      const { data } = await client.rpc('review_counts', { p_language: LANGUAGE });
      setReview(data as ReviewCounts);
      setFlags(
        (await client.from('sentence_flags').select('id', { count: 'exact', head: true })).count,
      );
    })();
  }, [client, member.user_id, has]);

  const cards = [
    has('recruteur') || has('admin')
      ? { n: tests, label: 'test(s) de voix à écouter', path: '/voix', note: null }
      : null,
    has('verificateur') || has('qualite') || has('admin')
      ? {
          n: review?.a_verifier ?? null,
          label: 'audio(s) à vérifier',
          path: '/ecoute',
          note: ownRecruits(review?.a_verifier_vos_recrues),
        }
      : null,
    has('qualite') || has('admin')
      ? {
          n: review?.doutes ?? null,
          label: 'audio(s) en doute à trancher',
          path: '/ecoute?file=doutes',
          note: ownRecruits(review?.doutes_vos_recrues),
        }
      : null,
    { n: flags, label: 'signalement(s) « je n’arrive pas à lire »', path: '/phrases', note: null },
  ].filter((c) => c !== null);

  return (
    <>
      <h1>Bonjour {member.display_name}</h1>
      <p>
        Vos rôles :{' '}
        {member.roles.length === 0
          ? 'aucun pour le moment'
          : member.roles.map((role) => (
              <span key={role} className="pastille">
                {ROLE_LABELS[role]}
              </span>
            ))}
      </p>
      <div className="cartes-compteurs">
        {cards.map((card) => (
          <button key={card.label} className="compteur" onClick={() => navigate(card.path)}>
            <strong>{card.n ?? '…'}</strong>
            <span>{card.label}</span>
            {card.note && <small className="aide">{card.note}</small>}
          </button>
        ))}
      </div>
      <p className="aide">
        Le tableau de bord (heures, quotas, graphiques) arrive au prochain jalon.
      </p>
    </>
  );
}

/** Les audios de ses propres recrues ne sont jamais proposés : on le dit, sans les compter. */
export function ownRecruits(n: number | undefined): string | null {
  if (!n) return null;
  return `+ ${n} de vos recrues : un autre membre doit s’en charger.`;
}
