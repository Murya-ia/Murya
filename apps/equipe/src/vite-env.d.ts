/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse du projet Supabase (Project Settings > API). */
  readonly VITE_SUPABASE_URL?: string;
  /** Clé publique « publishable » du projet Supabase (sans danger côté navigateur grâce à la RLS). */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
