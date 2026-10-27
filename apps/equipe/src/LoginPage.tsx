import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Logo } from '@murya/commun/logo';

export function LoginPage({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await client.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(
        authError.status === 400
          ? 'E-mail ou mot de passe incorrect.'
          : 'Connexion impossible pour le moment. Vérifiez votre réseau et réessayez.',
      );
    }
    setBusy(false);
  }

  return (
    <main className="centre-page">
      <Logo size={44} />
      <h1>Espace équipe</h1>
      <form className="carte formulaire" onSubmit={(e) => void submit(e)}>
        <div>
          <label htmlFor="email">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="message erreur">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        <p className="aide">
          Pas de compte ou mot de passe oublié ? Demandez à un admin : les inscriptions libres sont
          fermées.
        </p>
      </form>
    </main>
  );
}
