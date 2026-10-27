// Accueil : ce qui attend la personne connectée (tests à écouter, audios à vérifier…).
// Le tableau de bord complet (heures, quotas, graphiques) arrive au J4.

import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { useTeam } from '../lib/team';
import { ROLE_LABELS } from '../supabase';

interface Counts {
  tests: number | null;
  aVerifier: number | null;
  doutes: number | null;
  signalees: number | null;
}

export function AccueilPage() {
  const { client, member, has } = useTeam();
  const [counts, setCounts] = useState<Counts>({
    tests: null,
    aVerifier: null,
    doutes: null,
    signalees: null,
  });

  useEffect(() => {
    const count = async (query: PromiseLike<{ count: number | null }>) => (await query).count;
    void (async () => {
      let tests = client
        .from('speakers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'test_en_attente');
      if (!has('admin')) tests = tests.eq('recruiter_id', member.user_id);
      setCounts({
        tests: await count(tests),
        // La RLS ne compte que les audios que la personne a le droit d'écouter.
        aVerifier: await count(
          client
            .from('recordings')
            .select('id', { count: 'exact', head: true })
            .eq('upload_status', 'recu')
            .eq('qc_status', 'a_verifier'),
        ),
        doutes: await count(
          client
            .from('recordings')
            .select('id', { count: 'exact', head: true })
            .eq('qc_status', 'doute'),
        ),
        signalees: await count(
          client.from('sentence_flags').select('id', { count: 'exact', head: true }),
        ),
      });
    })();
  }, [client, member.user_id, has]);

  const cards = [
    has('recruteur') || has('admin')
      ? { n: counts.tests, label: 'test(s) de voix à écouter', path: '/voix' }
      : null,
    has('verificateur') || has('qualite') || has('admin')
      ? { n: counts.aVerifier, label: 'audio(s) à vérifier', path: '/ecoute' }
      : null,
    has('qualite') || has('admin')
      ? { n: counts.doutes, label: 'audio(s) en doute à trancher', path: '/ecoute' }
      : null,
    { n: counts.signalees, label: 'signalement(s) « je n’arrive pas à lire »', path: '/phrases' },
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
          </button>
        ))}
      </div>
      <p className="aide">
        Le tableau de bord (heures, quotas, graphiques) arrive au prochain jalon.
      </p>
    </>
  );
}
