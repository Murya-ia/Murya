// Gestion de l'équipe (admins) : créer un compte pour un nouveau membre, changer ses rôles,
// lui donner un nouveau mot de passe (les membres ne changent pas le leur eux-mêmes), le
// désactiver. Tout est noté au journal. Deux admins au maximum ; il en reste toujours un.

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Feuille } from '../components/Feuille';
import { Chevron } from '../components/Icones';
import { createMember, resetPassword } from '../lib/api';
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

const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || '?';

/** « vu aujourd'hui », « vu hier », « vu le 12/10 », « jamais connecté ». */
function lastSeen(date: string | null): string {
  if (!date) return 'jamais connecté';
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(new Date(date))) / 86_400_000);
  if (days <= 0) return 'vu aujourd’hui';
  if (days === 1) return 'vu hier';
  return `vu le ${new Date(date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
}

const rolesText = (roles: Role[]) =>
  roles.length === 0 ? 'aucun rôle' : roles.map((r) => ROLE_LABELS[r]).join(' · ');

export function MembresPage() {
  const { client, member: me } = useTeam();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await client.rpc('team_directory');
    if (rpcError) setError(errorText(rpcError));
    else setMembers(data as Member[]);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = members?.filter((m) => m.actif) ?? [];
  const inactive = members?.filter((m) => !m.actif) ?? [];
  const opened = members?.find((m) => m.user_id === openId) ?? null;

  const row = (m: Member) => (
    <button key={m.user_id} className="ligne" onClick={() => setOpenId(m.user_id)}>
      <span
        className={`rond-initiale${m.user_id === me.user_id ? '' : ' clair'}`}
        aria-hidden="true"
      >
        {initialOf(m.nom)}
      </span>
      <span className="ligne-texte">
        <strong>
          {m.nom}
          {m.user_id === me.user_id && <span className="aide"> (vous)</span>}
        </strong>
        <small>
          {m.actif ? `${rolesText(m.roles)} · ${lastSeen(m.derniere_connexion)}` : 'Désactivé'}
        </small>
      </span>
      <Chevron />
    </button>
  );

  return (
    <>
      <div className="titre-page">
        <h1>Membres</h1>
        <button className="bouton-ajout" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Fermer' : '+ Ajouter'}
        </button>
      </div>
      <p className="intro gris">
        {members ? `${active.length} membre(s) actif(s) · ` : ''}touchez un nom pour ses rôles et
        son mot de passe.
      </p>
      {error && <p className="message erreur">{error}</p>}
      {adding && <NewMember onCreated={load} />}
      {members === null ? (
        <p className="gris">Chargement…</p>
      ) : (
        <>
          <section className="liste-lignes">{active.map(row)}</section>
          {inactive.length > 0 && (
            <section className="liste-lignes inactifs">
              <h2>Désactivés</h2>
              {inactive.map(row)}
            </section>
          )}
        </>
      )}
      {opened && (
        <MemberSheet
          key={opened.user_id}
          member={opened}
          isMe={opened.user_id === me.user_id}
          onClose={() => setOpenId(null)}
          onSaved={load}
        />
      )}
    </>
  );
}

function RoleBoxes({ roles, onChange }: { roles: Role[]; onChange: (roles: Role[]) => void }) {
  return (
    <div className="choix-roles">
      {ROLES.map((role) => {
        const on = roles.includes(role);
        return (
          <button
            key={role}
            type="button"
            aria-pressed={on}
            className={on ? 'actif' : ''}
            title={ROLE_HELP[role]}
            onClick={() => onChange(on ? roles.filter((r) => r !== role) : [...roles, role])}
          >
            {on && <span aria-hidden="true">✓ </span>}
            {ROLE_LABELS[role]}
          </button>
        );
      })}
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
            Mot de passe : {done.password}
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
            <label htmlFor="membre-mdp">Mot de passe</label>
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

/** Fiche d'un membre : rôles, nouveau mot de passe, désactivation. */
function MemberSheet({
  member,
  isMe,
  onClose,
  onSaved,
}: {
  member: Member;
  isMe: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { client, session } = useTeam();
  const [roles, setRoles] = useState<Role[]>(member.roles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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

  async function givePassword() {
    const password = temporaryPassword();
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      await resetPassword(session, member.user_id, password);
      setNewPassword(password);
    } catch (e) {
      setError(errorText(e as Error));
    }
    setBusy(false);
  }

  async function copy() {
    if (!newPassword) return;
    try {
      await navigator.clipboard.writeText(newPassword);
      setCopied(true);
    } catch {
      // Copie refusée par le navigateur : le mot de passe reste affiché, à recopier.
    }
  }

  return (
    <Feuille label={member.nom} onClose={onClose}>
      <div className="fiche-tete">
        <span className="rond-initiale grand clair" aria-hidden="true">
          {initialOf(member.nom)}
        </span>
        <div>
          <strong>
            {member.nom}
            {isMe && ' (vous)'}
          </strong>
          <span className="aide">
            {member.email} · {lastSeen(member.derniere_connexion)}
          </span>
        </div>
      </div>

      <div className="fiche-partie">
        <h3>Rôles</h3>
        <RoleBoxes roles={roles} onChange={setRoles} />
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
      </div>

      <div className="fiche-partie">
        <h3>Mot de passe</h3>
        {newPassword && (
          <div className="nouveau-mdp">
            <p>Nouveau mot de passe de {member.nom}. L’ancien ne marche plus.</p>
            <div className="nouveau-mdp-ligne">
              <code>{newPassword}</code>
              <button className="petit" onClick={() => void copy()}>
                {copied ? 'Copié' : 'Copier'}
              </button>
            </div>
            <p className="aide">Envoyez-le-lui, par exemple sur WhatsApp.</p>
          </div>
        )}
        <button className="secondaire" disabled={busy} onClick={() => void givePassword()}>
          {newPassword ? 'En donner un autre' : 'Donner un nouveau mot de passe'}
        </button>
      </div>

      {error && <p className="message erreur">{error}</p>}

      {!isMe && (
        <button
          className={`lien${member.actif ? ' danger-texte' : ''}`}
          disabled={busy}
          onClick={() => void save({ active: !member.actif })}
        >
          {member.actif ? 'Désactiver ce compte' : 'Réactiver ce compte'}
        </button>
      )}
    </Feuille>
  );
}
