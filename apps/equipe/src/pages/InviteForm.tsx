// Créer un lien d'invitation pour une voix (spec §5.3) et le partager sur WhatsApp en un clic.
// Le lien n'est affiché qu'UNE fois : la base ne garde que son empreinte. S'il est perdu,
// on en crée un nouveau.

import { useState, type FormEvent } from 'react';
import { useTeam } from '../lib/team';

const VOICE_APP_URL = import.meta.env.VITE_VOICE_APP_URL ?? 'http://localhost:5173';

interface CreatedInvite {
  invite_id: string;
  token: string;
  expires_at: string;
}

export function InviteForm({ onCreated }: { onCreated?: () => void }) {
  const { client, langue } = useTeam();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ label: string; link: string; expires: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(false);
    const { data, error: rpcError } = await client
      .rpc('create_invite', { p_label: label.trim(), p_language: langue.code })
      .single<CreatedInvite>();
    setBusy(false);
    if (rpcError || !data) {
      setError('Impossible de créer le lien. Vérifiez que vous avez le rôle recruteur.');
      return;
    }
    setCreated({
      label: label.trim(),
      link: `${VOICE_APP_URL}/i/${data.token}`,
      expires: new Date(data.expires_at).toLocaleDateString('fr-FR'),
    });
    setLabel('');
    onCreated?.();
  }

  const whatsappText = created
    ? `Bonjour ! Merci d'accepter de prêter votre voix à Murya, l'IA qui parle les langues ` +
      `locales africaines. ` +
      `Voici votre lien personnel (ne le partagez avec personne) : ${created.link}`
    : '';

  async function copy() {
    if (!created) return;
    await navigator.clipboard.writeText(created.link);
    setCopied(true);
  }

  return (
    <section className="carte">
      <h2>Inviter une voix</h2>
      <form className="ligne-formulaire" onSubmit={(e) => void submit(e)}>
        <div>
          <label htmlFor="libelle">Nom ou surnom (visible seulement par vous et les admins)</label>
          <input
            id="libelle"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={100}
            required
          />
        </div>
        <button type="submit" disabled={busy || !label.trim()}>
          {busy ? 'Création…' : 'Créer le lien'}
        </button>
      </form>
      {error && <p className="message erreur">{error}</p>}

      {created && (
        <div className="lien-cree">
          <p>
            Lien pour <strong>{created.label}</strong> (valable jusqu'au {created.expires}) :
          </p>
          <code className="lien-invitation">{created.link}</code>
          <div className="boutons">
            <a
              className="bouton"
              href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
              target="_blank"
              rel="noreferrer"
            >
              Envoyer sur WhatsApp
            </a>
            <button className="secondaire" onClick={() => void copy()}>
              {copied ? 'Copié ✓' : 'Copier le lien'}
            </button>
          </div>
          <p className="aide">
            Ce lien ne sera plus affiché : envoyez-le maintenant. S'il est perdu, créez-en un
            nouveau.
          </p>
        </div>
      )}
    </section>
  );
}
