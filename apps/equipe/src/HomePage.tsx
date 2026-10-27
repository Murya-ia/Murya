// Page d'accueil provisoire (J1) : prouve que la connexion et les règles d'accès (RLS)
// fonctionnent. Le tableau de bord arrive au J4.

import { useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Logo } from '@murya/commun/logo';
import { InviteForm } from './InviteForm';
import { ROLE_LABELS, type TeamMember } from './supabase';

interface Language {
  code: string;
  name_fr: string;
  active: boolean;
}

type State =
  | { status: 'chargement' }
  | { status: 'hors_equipe' }
  | { status: 'erreur' }
  | { status: 'pret'; member: TeamMember; languages: Language[] };

export function HomePage({ client, session }: { client: SupabaseClient; session: Session }) {
  const [state, setState] = useState<State>({ status: 'chargement' });

  useEffect(() => {
    async function load() {
      const [member, languages] = await Promise.all([
        client
          .from('team_members')
          .select('user_id, display_name, roles')
          .eq('user_id', session.user.id)
          .maybeSingle<TeamMember>(),
        client.from('languages').select('code, name_fr, active').order('code'),
      ]);
      if (member.error || languages.error) return setState({ status: 'erreur' });
      // Grâce à la RLS, un compte qui n'est pas membre de l'équipe ne voit aucune ligne.
      if (!member.data) return setState({ status: 'hors_equipe' });
      setState({ status: 'pret', member: member.data, languages: languages.data as Language[] });
    }
    void load();
  }, [client, session.user.id]);

  return (
    <div className="mise-en-page">
      <header className="barre">
        <Logo size={30} color="var(--blanc)" />
        <span className="barre-droite">
          {session.user.email}
          <button className="secondaire petit" onClick={() => void client.auth.signOut()}>
            Se déconnecter
          </button>
        </span>
      </header>

      <main className="contenu">
        {state.status === 'chargement' && <p>Chargement…</p>}
        {state.status === 'erreur' && (
          <p className="message erreur">Impossible de charger vos informations. Réessayez.</p>
        )}
        {state.status === 'hors_equipe' && (
          <p className="message alerte">
            Votre compte n'est pas encore rattaché à l'équipe. Demandez à un admin de vous ajouter.
          </p>
        )}
        {state.status === 'pret' && (
          <>
            <h1>Bonjour {state.member.display_name}</h1>
            <p>
              Vos rôles :{' '}
              {state.member.roles.length === 0
                ? 'aucun pour le moment'
                : state.member.roles.map((role) => (
                    <span key={role} className="pastille">
                      {ROLE_LABELS[role]}
                    </span>
                  ))}
            </p>
            {(state.member.roles.includes('recruteur') || state.member.roles.includes('admin')) && (
              <InviteForm client={client} />
            )}
            <h2>Langues</h2>
            <ul>
              {state.languages.map((language) => (
                <li key={language.code}>
                  {language.name_fr} (<code>{language.code}</code>)
                  {language.active ? '' : ' — inactive'}
                </li>
              ))}
            </ul>
            <p className="gris">
              Le suivi des voix, la validation des tests et l'écoute arrivent au prochain jalon.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
