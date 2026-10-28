// Gestion de l'équipe (admins) : créer un compte pour un nouveau membre, changer ses rôles,
// le désactiver. Tout est noté au journal. Deux admins au maximum ; il en reste toujours un.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { createMember } from '../lib/api';
import { errorText, useTeam } from '../lib/team';
import { ROLE_LABELS, type Role } from '../supabase';

interface Member {
  user_id: string;
  nom: string;
  email: string;
  roles: Role[];
  actif: boolean;
  derniere_connexion: string | null;
}

const ROLES: Role[] = ['recruteur', 'verificateur', 'qualite', 'admin'];

const ROLE_HELP: Record<Role, string> = {
  recruteur: 'invite des voix et écoute leur test',
  verificateur: 'écoute les audios et décide',
  qualite: 'tranche les doutes, double écoute',
  admin: 'tout gérer (deux au maximum)',
};

/** Mot de passe provisoire lisible (sans caractères qu'on confond, comme 0/O ou l/1). */
function temporaryPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0]! % set.length];
  const word = () => Array.from({ length: 4 }, () => pick(letters)).join('');
  return `${word()}-${word()}-${pick(digits)}${pick(digits)}${pick(digits)}`;
}

export function MembresPage() {
  const { client, member: me } = useTeam();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await client.rpc('team_directory');
    if (rpcError) setError(errorText(rpcError));
    else setMembers(data as Member[]);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <span className="etiquette">Équipe</span>
      <h1>
        Membres. <span className="doux">Qui fait quoi.</span>
      </h1>
      <p className="intro gris">
        Créez un compte pour chaque membre, puis donnez-lui ses rôles. Il se connecte avec son
        e-mail et le mot de passe provisoire, qu’il change ensuite avec le bouton « Mot de passe »,
        en haut à droite.
      </p>
      {error && <p className="message erreur">{error}</p>}
      <NewMember onCreated={load} />
      <section className="carte">
        <h2>L’équipe</h2>
        {members === null ? (
          <p className="gris">Chargement…</p>
        ) : (
          <ul className="liste-membres">
            {members.map((m) => (
              <MemberRow
                key={m.user_id}
                member={m}
                isMe={m.user_id === me.user_id}
                onSaved={load}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RoleBoxes({ roles, onChange }: { roles: Role[]; onChange: (roles: Role[]) => void }) {
  return (
    <div className="cases-roles">
      {ROLES.map((role) => (
        <label key={role} className="case-ligne" title={ROLE_HELP[role]}>
          <input
            type="checkbox"
            checked={roles.includes(role)}
            onChange={(e) =>
              onChange(e.target.checked ? [...roles, role] : roles.filter((r) => r !== role))
            }
          />
          {ROLE_LABELS[role]}
        </label>
      ))}
    </div>
  );
}

function NewMember({ onCreated }: { onCreated: () => void }) {
  const { session } = useTeam();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(temporaryPassword);
  const [roles, setRoles] = useState<Role[]>(['verificateur']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; email: string; password: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { email: saved } = await createMember(session, {
        email,
        mot_de_passe: password,
        nom: name,
        roles,
      });
      setDone({ name, email: saved, password });
      setName('');
      setEmail('');
      setPassword(temporaryPassword());
      setRoles(['verificateur']);
      onCreated();
    } catch (e) {
      setError(errorText(e as Error));
    }
    setBusy(false);
  }

  return (
    <section className="carte">
      <h2>Ajouter un membre</h2>
      {done && (
        <div className="message succes">
          <p>
            Compte créé pour {done.name}. Envoyez-lui ces informations (par exemple sur WhatsApp) :
          </p>
          <p className="identifiants">
            Adresse : https://murya-equipe.murya-api.workers.dev
            <br />
            E-mail : {done.email}
            <br />
            Mot de passe provisoire : {done.password}
          </p>
        </div>
      )}
      <form className="formulaire" onSubmit={(e) => void submit(e)}>
        <div className="ligne-formulaire">
          <div>
            <label htmlFor="membre-nom">Prénom (affiché dans l’espace équipe)</label>
            <input
              id="membre-nom"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="membre-email">E-mail</label>
            <input
              id="membre-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="membre-mdp">Mot de passe provisoire</label>
            <input
              id="membre-mdp"
              value={password}
              minLength={10}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <span className="etiquette-champ">Rôles</span>
          <RoleBoxes roles={roles} onChange={setRoles} />
        </div>
        {error && <p className="message erreur">{error}</p>}
        <div className="boutons">
          <button type="submit" className="avec-fleche" disabled={busy}>
            {busy ? 'Création…' : 'Créer le compte'}
            <span className="rond" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      </form>
    </section>
  );
}

function MemberRow({
  member,
  isMe,
  onSaved,
}: {
  member: Member;
  isMe: boolean;
  onSaved: () => void;
}) {
  const { client } = useTeam();
  const [roles, setRoles] = useState<Role[]>(member.roles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = [...roles].sort().join() !== [...member.roles].sort().join();

  async function save(update: { roles?: Role[]; active?: boolean }) {
    setBusy(true);
    setError(null);
    const { error: updateError } = await client
      .from('team_members')
      .update(update)
      .eq('user_id', member.user_id);
    setBusy(false);
    if (updateError) setError(errorText(updateError));
    else onSaved();
  }

  return (
    <li className={member.actif ? '' : 'inactif'}>
      <div className="membre-tete">
        <div>
          <strong>
            {member.nom}
            {isMe ? ' (vous)' : ''}
          </strong>
          <p className="aide">
            {member.email} ·{' '}
            {member.derniere_connexion
              ? `dernière connexion le ${new Date(member.derniere_connexion).toLocaleDateString('fr-FR')}`
              : 'jamais connecté'}
            {!member.actif && ' · désactivé'}
          </p>
        </div>
        {!isMe && (
          <button
            className="petit secondaire"
            disabled={busy}
            onClick={() => void save({ active: !member.actif })}
          >
            {member.actif ? 'Désactiver' : 'Réactiver'}
          </button>
        )}
      </div>
      <RoleBoxes roles={roles} onChange={setRoles} />
      {error && <p className="message erreur">{error}</p>}
      {changed && (
        <div className="boutons">
          <button className="petit" disabled={busy} onClick={() => void save({ roles })}>
            Enregistrer les rôles
          </button>
          <button className="petit lien" onClick={() => setRoles(member.roles)}>
            Annuler
          </button>
        </div>
      )}
    </li>
  );
}
