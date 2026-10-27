// Ce que toutes les pages de l'espace équipe partagent : la connexion à Supabase, la session
// et le membre connecté (avec ses rôles).

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import type { Role, TeamMember } from '../supabase';

/** Langue de collecte gérée par cet espace. D'autres langues viendront (spec §8.4). */
export const LANGUAGE = 'dje';

export interface Team {
  client: SupabaseClient;
  session: Session;
  member: TeamMember;
  has: (role: Role) => boolean;
}

const TeamContext = createContext<Team | null>(null);

export function TeamProvider({
  value,
  children,
}: {
  value: Omit<Team, 'has'>;
  children: ReactNode;
}) {
  const { client, session, member } = value;
  // Même objet tant que la session et le membre ne changent pas (évite des rechargements).
  const team = useMemo<Team>(
    () => ({ client, session, member, has: (role: Role) => member.roles.includes(role) }),
    [client, session, member],
  );
  return <TeamContext.Provider value={team}>{children}</TeamContext.Provider>;
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
  };
  return known[code] ?? 'Une erreur est survenue. Réessayez.';
}
