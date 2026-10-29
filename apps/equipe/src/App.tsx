import { useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { Logo } from '@murya/commun/logo';
import { Demarrage } from './components/Demarrage';
import { oublierTout } from './lib/memoire';
import { LoginPage } from './LoginPage';
import { TeamShell } from './TeamShell';

export function App({ client }: { client: SupabaseClient | null }) {
  if (!client) return <MissingConfig />;
  return <AuthGate client={client} />;
}

/** Affiche la page de connexion tant que personne n'est connecté. */
function AuthGate({ client }: { client: SupabaseClient }) {
  // undefined = on ne sait pas encore (lecture de la session enregistrée en cours).
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    void client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, newSession) => {
      // Session finie (déconnexion, ou expirée) : on oublie les chiffres gardés en mémoire.
      if (!newSession) oublierTout();
      setSession(newSession);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);

  if (session === undefined) return <Demarrage />;
  if (!session) return <LoginPage client={client} />;
  return <TeamShell client={client} session={session} />;
}

function MissingConfig() {
  return (
    <main className="centre-page">
      <Logo size={40} />
      <p className="message erreur">
        Configuration manquante : copiez <code>.env.example</code> en <code>.env.local</code> à la
        racine du dépôt et remplissez <code>VITE_SUPABASE_URL</code> et{' '}
        <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.
      </p>
    </main>
  );
}
