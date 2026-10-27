// Cadre de l'espace équipe : charge le membre connecté (et ses rôles), affiche la barre de
// navigation selon ses rôles, puis la page demandée.

import { useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Logo } from '@murya/commun/logo';
import { navigate, usePath } from './lib/router';
import { TeamProvider, useTeam } from './lib/team';
import { AccueilPage } from './pages/AccueilPage';
import { EcoutePage } from './pages/EcoutePage';
import { PhrasesPage } from './pages/PhrasesPage';
import { VoixPage } from './pages/VoixPage';
import type { Role, TeamMember } from './supabase';

type State =
  | { status: 'chargement' }
  | { status: 'hors_equipe' }
  | { status: 'erreur' }
  | { status: 'pret'; member: TeamMember };

export function TeamShell({ client, session }: { client: SupabaseClient; session: Session }) {
  const [state, setState] = useState<State>({ status: 'chargement' });

  useEffect(() => {
    void client
      .from('team_members')
      .select('user_id, display_name, roles')
      .eq('user_id', session.user.id)
      .maybeSingle<TeamMember>()
      .then(({ data, error }) => {
        // Grâce à la RLS, un compte qui n'est pas membre de l'équipe ne voit aucune ligne.
        if (error) setState({ status: 'erreur' });
        else if (!data) setState({ status: 'hors_equipe' });
        else setState({ status: 'pret', member: data });
      });
  }, [client, session.user.id]);

  const signOut = () => void client.auth.signOut();

  if (state.status !== 'pret') {
    return (
      <div className="mise-en-page">
        <TopBar email={session.user.email} onSignOut={signOut} />
        <main className="contenu">
          {state.status === 'chargement' && <p>Chargement…</p>}
          {state.status === 'erreur' && (
            <p className="message erreur">Impossible de charger vos informations. Réessayez.</p>
          )}
          {state.status === 'hors_equipe' && (
            <p className="message alerte">
              Votre compte n'est pas encore rattaché à l'équipe. Demandez à un admin de vous
              ajouter.
            </p>
          )}
        </main>
      </div>
    );
  }

  return (
    <TeamProvider value={{ client, session, member: state.member }}>
      <div className="mise-en-page">
        <TopBar email={session.user.email} onSignOut={signOut}>
          <Navigation />
        </TopBar>
        <main className="contenu">
          <Page />
        </main>
      </div>
    </TeamProvider>
  );
}

const PAGES: { path: string; label: string; roles: Role[] | null }[] = [
  { path: '/', label: 'Accueil', roles: null },
  { path: '/voix', label: 'Voix', roles: ['recruteur', 'admin'] },
  { path: '/ecoute', label: 'Écoute', roles: ['verificateur', 'qualite', 'admin'] },
  { path: '/phrases', label: 'Phrases', roles: null },
];

function Navigation() {
  const { has } = useTeam();
  const path = usePath();
  return (
    <nav className="navigation">
      {PAGES.filter((p) => !p.roles || p.roles.some(has)).map((p) => (
        <a
          key={p.path}
          href={p.path}
          className={path === p.path ? 'actif' : ''}
          onClick={(e) => {
            e.preventDefault();
            navigate(p.path);
          }}
        >
          {p.label}
        </a>
      ))}
    </nav>
  );
}

function Page() {
  const path = usePath();
  if (path === '/voix') return <VoixPage />;
  if (path === '/ecoute') return <EcoutePage />;
  if (path === '/phrases') return <PhrasesPage />;
  return <AccueilPage />;
}

function TopBar({
  email,
  onSignOut,
  children,
}: {
  email: string | undefined;
  onSignOut: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="barre">
      <Logo size={28} color="var(--blanc)" />
      {children}
      <span className="barre-droite">
        <span
          className="version"
          title="Version de l'espace équipe (rechargez la page si elle est ancienne)"
        >
          v{__BUILD_VERSION__}
        </span>
        {email}
        <button className="secondaire petit" onClick={onSignOut}>
          Se déconnecter
        </button>
      </span>
    </header>
  );
}
