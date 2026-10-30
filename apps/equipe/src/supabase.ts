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
  /** Codes des langues du membre (ex. ['dje']). */
  languages: string[];
}

/** Une langue parlée au Niger (table `languages`). */
export interface Language {
  /** Code ISO 639-3 (ex. dje, kby, ttq). */
  code: string;
  name_fr: string;
  name_native: string | null;
  /** Variété enregistrée (ex. « manga »). */
  variety: string | null;
  active: boolean;
  /** Nom simple, sans accent : sert de nom de colonne à l'import (« kanouri »). */
  mother_tongue_code: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  recruteur: 'Recruteur',
  verificateur: 'Vérificateur',
  qualite: 'Responsable qualité',
  admin: 'Admin',
};
