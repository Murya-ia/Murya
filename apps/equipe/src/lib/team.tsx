// Ce que toutes les pages de l'espace équipe partagent : la connexion à Supabase, la session,
// le membre connecté (avec ses rôles) et la langue de travail choisie.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Language, Role, TeamMember } from '../supabase';

export interface Team {
  client: SupabaseClient;
  session: Session;
  member: TeamMember;
  has: (role: Role) => boolean;
  /** Langue de travail : toutes les pages montrent et modifient cette langue. */
  langue: Language;
}

const TeamContext = createContext<Team | null>(null);

export function TeamProvider({
  value,
  children,
}: {
  value: Omit<Team, 'has'>;
  children: ReactNode;
}) {
  const { client, session, member, langue } = value;
  // Même objet tant que la session, le membre et la langue ne changent pas (évite des
  // rechargements).
  const team = useMemo<Team>(
    () => ({ client, session, member, langue, has: (role: Role) => member.roles.includes(role) }),
    [client, session, member, langue],
  );
  return <TeamContext.Provider value={team}>{children}</TeamContext.Provider>;
}

/**
 * Langues où le membre peut travailler : toutes les langues actives pour un admin, sinon ses
 * langues parmi les actives (la base applique la même règle).
 */
export function workLanguages(member: TeamMember, languages: Language[]): Language[] {
  const admin = member.roles.includes('admin');
  return languages.filter((l) => l.active && (admin || member.languages.includes(l.code)));
}

/** Nom affiché d'une langue, avec sa variété : « Kanouri (manga) ». */
export function languageName(language: Language): string {
  return language.variety ? `${language.name_fr} (${language.variety})` : language.name_fr;
}

export function useTeam(): Team {
  const team = useContext(TeamContext);
  if (!team) throw new Error('useTeam doit être utilisé dans TeamProvider');
  return team;
}

/** Message lisible pour une erreur renvoyée par la base ou l'API. */
export function errorText(error: { message?: string } | null | undefined): string {
  const code = error?.message ?? '';
  const known: Record<string, string> = {
    acces_refuse: "Vous n'avez pas le droit de faire cette action.",
    reserve_par_autre: 'Un autre vérificateur écoute déjà cet audio.',
    deja_verifie: 'Cet audio a déjà été vérifié.',
    message_obligatoire: 'Écrivez un court message pour expliquer quoi refaire.',
    texte_corrige_obligatoire: 'Écrivez le texte exactement comme il est dit dans l’audio.',
    motif_obligatoire: 'Choisissez un motif de rejet.',
    test_pas_en_attente: 'Ce test a déjà été traité.',
    lien_expire: 'Ce lien a expiré ou a été révoqué.',
    nom_obligatoire: 'Le nom est obligatoire.',
    session_expiree: 'Votre session a expiré : reconnectez-vous.',
    pas_un_audio: 'Ce fichier n’est pas un enregistrement audio.',
    fichier_trop_gros: 'Fichier trop gros (15 Mo au plus).',
    voix_inconnue: 'Cette voix n’existe plus (déjà retirée ?).',
    confirmation_incorrecte: 'Le numéro tapé ne correspond pas à la voix.',
    journal_inalterable: 'Le journal ne peut pas être modifié.',
    export_en_cours: 'Un export de ce type est déjà en préparation : attendez qu’il soit prêt.',
    partition_figee: 'Cette voix est déjà dans un export : sa partie ne peut plus changer.',
    introuvable: 'Fichier introuvable (export pas prêt ?).',
    demo: 'Téléchargement indisponible en mode démo.',
    principale_existe: 'Il y a déjà une voix principale pour cette langue.',
    deja_en_lot:
      'Cette voix a déjà commencé un lot de voix variée : elle ne peut plus devenir principale.',
    seances_commencees: 'La voix principale a commencé ses séances : elle le reste.',
    reference_invalide: 'Choisissez un audio validé de la voix principale.',
    deux_admins_max: 'Il y a déjà deux admins : retirez d’abord ce rôle à l’un d’eux.',
    dernier_admin: 'Il doit toujours rester au moins un admin actif.',
    email_existe: 'Un compte existe déjà avec cet e-mail.',
    weak_password: 'Mot de passe trop faible : 10 caractères au moins.',
    same_password: 'Le nouveau mot de passe doit être différent de l’ancien.',
    membre_inconnu: 'Ce membre n’existe plus.',
    langue_non_attribuee:
      'Cette langue ne vous est pas attribuée (ou n’est pas active). Demandez à un admin.',
    langue_inconnue: 'Langue inconnue.',
  };
  return known[code] ?? 'Une erreur est survenue. Réessayez.';
}
