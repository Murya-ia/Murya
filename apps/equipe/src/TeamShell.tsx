// Cadre de l'espace équipe : charge le membre connecté (et ses rôles), affiche les menus
// selon ses rôles (en haut sur ordinateur, en bas sur téléphone), puis la page demandée.

import { useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Logo } from '@murya/commun/logo';
import { oublierTout } from './lib/memoire';
import { navigate, replace, usePath } from './lib/router';
import { TeamProvider, useTeam } from './lib/team';
import { AccueilPage } from './pages/AccueilPage';
import { ActivitePage } from './pages/ActivitePage';
import { EcoutePage } from './pages/EcoutePage';
import { ExportsPage } from './pages/ExportsPage';
import { JournalPage } from './pages/JournalPage';
import { MembresPage } from './pages/MembresPage';
import { PhrasesPage } from './pages/PhrasesPage';
import { TableauDeBordPage } from './pages/TableauDeBord';
import { VoixPage } from './pages/VoixPage';
import { Demarrage } from './components/Demarrage';
import { Feuille } from './components/Feuille';
import {
  Chevron,
  IconeAccueil,
  IconeActivite,
  IconeDeconnexion,
  IconeEcoute,
  IconeExports,
  IconeGraphique,
  IconeJournal,
  IconeMembres,
  IconePhrases,
  IconePlus,
  IconeVoix,
} from './components/Icones';
import { ROLE_LABELS, type Role, type TeamMember } from './supabase';

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

  const signOut = () => {
    // Le membre suivant sur ce téléphone ne doit rien voir du précédent : ni ses chiffres, ni
    // la page où il était (il repartira de l'accueil).
    oublierTout();
    replace('/');
    void client.auth.signOut();
  };

  if (state.status === 'chargement') return <Demarrage />;
  if (state.status !== 'pret') {
    return (
      <div className="mise-en-page">
        <TopBar />
        <main className="contenu">
          {state.status === 'erreur' && (
            <p className="message erreur">Impossible de charger vos informations. Réessayez.</p>
          )}
          {state.status === 'hors_equipe' && (
            <p className="message alerte">
              Votre compte n'est pas encore rattaché à l'équipe. Demandez à un admin de vous
              ajouter.
            </p>
          )}
          <button className="secondaire" onClick={signOut}>
            Se déconnecter
          </button>
        </main>
      </div>
    );
  }

  return (
    <TeamProvider value={{ client, session, member: state.member }}>
      <div className="mise-en-page avec-menu-bas">
        <TopBar account={<Compte onSignOut={signOut} />}>
          <Navigation />
        </TopBar>
        <main className="contenu">
          <Page />
        </main>
        <Footer />
        <MenuBas />
      </div>
    </TeamProvider>
  );
}

interface PageLink {
  path: string;
  label: string;
  roles: Role[] | null;
  icon: () => React.ReactElement;
  /** Sur téléphone : dans la barre du bas, ou dans « Plus ». */
  phone: 'barre' | 'plus';
}

const PAGES: PageLink[] = [
  { path: '/', label: 'Accueil', roles: null, icon: IconeAccueil, phone: 'barre' },
  { path: '/voix', label: 'Voix', roles: ['recruteur', 'admin'], icon: IconeVoix, phone: 'barre' },
  {
    path: '/ecoute',
    label: 'Écoute',
    roles: ['verificateur', 'qualite', 'admin'],
    icon: IconeEcoute,
    phone: 'barre',
  },
  { path: '/phrases', label: 'Phrases', roles: null, icon: IconePhrases, phone: 'barre' },
  {
    path: '/tableau-de-bord',
    label: 'Tableau de bord',
    roles: null,
    icon: IconeGraphique,
    phone: 'plus',
  },
  { path: '/activite', label: 'Activité', roles: ['admin'], icon: IconeActivite, phone: 'plus' },
  { path: '/exports', label: 'Exports', roles: ['admin'], icon: IconeExports, phone: 'plus' },
  { path: '/membres', label: 'Membres', roles: ['admin'], icon: IconeMembres, phone: 'plus' },
  { path: '/journal', label: 'Journal', roles: ['admin'], icon: IconeJournal, phone: 'plus' },
];

function usePages(): PageLink[] {
  const { has } = useTeam();
  return PAGES.filter((p) => !p.roles || p.roles.some(has));
}

function go(e: React.MouseEvent, path: string) {
  e.preventDefault();
  navigate(path);
}

/** Menu du haut, sur ordinateur (caché sur téléphone : il passe en bas). */
function Navigation() {
  const pages = usePages();
  const path = usePath();
  return (
    <nav className="navigation" aria-label="Menu">
      {pages.map((p) => (
        <a
          key={p.path}
          href={p.path}
          className={path === p.path ? 'actif' : ''}
          aria-current={path === p.path ? 'page' : undefined}
          onClick={(e) => go(e, p.path)}
        >
          {p.label}
        </a>
      ))}
    </nav>
  );
}

/** Menu du bas, sur téléphone : les pages principales à portée de pouce, le reste dans « Plus ». */
function MenuBas() {
  const pages = usePages();
  const path = usePath();
  const [more, setMore] = useState(false);
  const bar = pages.filter((p) => p.phone === 'barre');
  const rest = pages.filter((p) => p.phone === 'plus');
  const restActive = rest.some((p) => p.path === path);
  return (
    <>
      <nav className="menu-bas" aria-label="Menu">
        {bar.map((p) => (
          <a
            key={p.path}
            href={p.path}
            className={path === p.path ? 'actif' : ''}
            aria-current={path === p.path ? 'page' : undefined}
            onClick={(e) => go(e, p.path)}
          >
            <span className="menu-bas-icone">
              <p.icon />
            </span>
            {p.label}
          </a>
        ))}
        {rest.length > 0 && (
          <button className={restActive ? 'actif' : ''} onClick={() => setMore(true)}>
            <span className="menu-bas-icone">
              <IconePlus />
            </span>
            Plus
          </button>
        )}
      </nav>
      {more && (
        <Feuille label="Plus" onClose={() => setMore(false)}>
          <div className="liste-lignes sans-cadre">
            {rest.map((p) => (
              <a
                key={p.path}
                href={p.path}
                className="ligne"
                onClick={(e) => {
                  setMore(false);
                  go(e, p.path);
                }}
              >
                <span className="ligne-icone">
                  <p.icon />
                </span>
                <span className="ligne-texte">{p.label}</span>
                <Chevron />
              </a>
            ))}
          </div>
        </Feuille>
      )}
    </>
  );
}

const VIEWS: Record<string, () => React.ReactElement> = {
  '/voix': VoixPage,
  '/ecoute': EcoutePage,
  '/phrases': PhrasesPage,
  '/tableau-de-bord': TableauDeBordPage,
  '/activite': ActivitePage,
  '/exports': ExportsPage,
  '/membres': MembresPage,
  '/journal': JournalPage,
};

/**
 * La page demandée, seulement si les rôles du membre l'autorisent. Sinon (adresse tapée, ou
 * page restée ouverte quand un autre membre se connecte), c'est l'accueil, et l'adresse aussi.
 */
function Page() {
  const path = usePath();
  const allowed = usePages().some((p) => p.path === path);
  const View = allowed ? VIEWS[path] : undefined;

  useEffect(() => {
    if (!View && path !== '/') replace('/');
  }, [View, path]);

  return View ? <View /> : <AccueilPage />;
}

/**
 * Le compte, en haut à droite : un rond avec l'initiale (et le prénom sur ordinateur). Il
 * ouvre une fenêtre avec le nom, les rôles et « Se déconnecter », qui demande confirmation.
 * Pas de changement de mot de passe ici : ce sont les admins qui les donnent (page Membres).
 */
function Compte({ onSignOut }: { onSignOut: () => void }) {
  const { member, session } = useTeam();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const initial = member.display_name.trim().charAt(0).toUpperCase() || '?';
  const close = () => {
    setConfirming(false);
    setOpen(false);
  };
  return (
    <>
      <button
        className="compte"
        aria-label={`Mon compte (${member.display_name})`}
        onClick={() => setOpen(true)}
      >
        <span className="compte-nom">{member.display_name}</span>
        <span className="rond-initiale" aria-hidden="true">
          {initial}
        </span>
      </button>
      {open && !confirming && (
        <Feuille label="Mon compte" onClose={close}>
          <div className="fiche-tete">
            <span className="rond-initiale grand" aria-hidden="true">
              {initial}
            </span>
            <div>
              <strong>{member.display_name}</strong>
              <span className="aide">{session.user.email}</span>
            </div>
          </div>
          <div className="pastilles">
            {member.roles.length === 0 ? (
              <span className="aide">Aucun rôle pour le moment.</span>
            ) : (
              member.roles.map((role) => (
                <span key={role} className={`pastille-role${role === 'admin' ? ' admin' : ''}`}>
                  {ROLE_LABELS[role]}
                </span>
              ))
            )}
          </div>
          <p className="aide">Pour changer de mot de passe, demandez à un admin.</p>
          <div className="boutons-pleins">
            <button className="secondaire" onClick={() => setConfirming(true)}>
              <IconeDeconnexion /> Se déconnecter
            </button>
            <button className="lien" onClick={close}>
              Fermer
            </button>
          </div>
        </Feuille>
      )}
      {confirming && (
        <Feuille label="Confirmer la déconnexion" centre onClose={close}>
          <div className="confirmation">
            <span className="confirmation-icone" aria-hidden="true">
              <IconeDeconnexion />
            </span>
            <h2>Se déconnecter ?</h2>
            <p className="aide">
              Vous devrez retaper votre e-mail et votre mot de passe pour revenir.
            </p>
            <div className="boutons-pleins">
              <button onClick={onSignOut}>Oui, me déconnecter</button>
              <button className="secondaire" onClick={close}>
                Annuler
              </button>
            </div>
          </div>
        </Feuille>
      )}
    </>
  );
}

function TopBar({
  account,
  children,
}: {
  /** Le compte (rond avec l'initiale), une fois le membre chargé. */
  account?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="barre">
      <a
        className="barre-logo"
        href="/"
        aria-label="Murya — accueil de l'espace équipe"
        onClick={(e) => go(e, '/')}
      >
        <Logo size={30} />
      </a>
      {children}
      <div className="barre-droite">{account}</div>
    </header>
  );
}

/** Version en bas de page : permet de vérifier qu'on voit bien la dernière mise en ligne. */
function Footer() {
  return (
    <footer className="pied">
      Murya · espace équipe ·{' '}
      <span title="Si cette version est ancienne, rechargez la page (Ctrl + F5).">
        version {__BUILD_VERSION__}
      </span>
    </footer>
  );
}
