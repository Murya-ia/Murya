import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Client Supabase, ou null si la configuration manque (voir .env.example). */
export const supabase = url && key ? createClient(url, key) : null;

export type Role = 'recruteur' | 'verificateur' | 'qualite' | 'admin';

export interface TeamMember {
  user_id: string;
  display_name: string;
  roles: Role[];
}

export const ROLE_LABELS: Record<Role, string> = {
  recruteur: 'Recruteur',
  verificateur: 'Vérificateur',
  qualite: 'Responsable qualité',
  admin: 'Admin',
};
