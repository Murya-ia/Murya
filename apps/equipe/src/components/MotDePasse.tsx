// « Mon mot de passe » : chaque membre remplace le mot de passe provisoire donné par l'admin.

import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { errorText, useTeam } from '../lib/team';

export function MotDePasse() {
  const { client } = useTeam();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== again) {
      setMessage({ ok: false, text: 'Les deux mots de passe sont différents.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await client.auth.updateUser({ password });
    setBusy(false);
    if (error) setMessage({ ok: false, text: errorText(error) });
    else {
      setMessage({ ok: true, text: 'Mot de passe changé.' });
      setPassword('');
      setAgain('');
    }
  }

  if (!open) {
    return (
      <button className="secondaire petit" onClick={() => setOpen(true)}>
        Mot de passe
      </button>
    );
  }
  // Affichée au niveau de la page : l'en-tête (flou d'arrière-plan) retiendrait la fenêtre.
  return createPortal(
    <div className="fenetre-fond" onClick={() => setOpen(false)}>
      <form
        className="carte fenetre formulaire"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h2>Mon mot de passe</h2>
        <div>
          <label htmlFor="mdp-nouveau">Nouveau mot de passe (10 caractères au moins)</label>
          <input
            id="mdp-nouveau"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="mdp-encore">Encore une fois</label>
          <input
            id="mdp-encore"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            required
          />
        </div>
        {message && <p className={`message ${message.ok ? 'succes' : 'erreur'}`}>{message.text}</p>}
        <div className="boutons">
          <button type="submit" disabled={busy}>
            {busy ? 'Enregistrement…' : 'Changer le mot de passe'}
          </button>
          <button type="button" className="secondaire" onClick={() => setOpen(false)}>
            Fermer
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
