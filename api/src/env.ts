// Variables et liaisons disponibles dans le Worker (voir wrangler.toml et .dev.vars.example).
export interface Env {
  ENVIRONMENT: 'local' | 'staging' | 'production';
  /** Origines autorisées à appeler l'API, séparées par des virgules. */
  ALLOWED_ORIGINS: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_AUDIO: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  /** Code de la page de preuve audio. Absent = page désactivée (toujours le cas en production). */
  PROOF_CODE?: string;
  /** Adresse du projet Supabase (ex. https://xxxx.supabase.co). */
  SUPABASE_URL: string;
  /** Clé secrète Supabase (sb_secret_…) : seulement ici, jamais dans une interface. */
  SUPABASE_SECRET_KEY: string;
  /** Clé publique Supabase (sb_publishable_…), pour appeler la base avec la session d'un membre. */
  SUPABASE_PUBLISHABLE_KEY: string;
  AUDIO: R2Bucket;
  /** Bucket des identités (consentements oraux), séparé des audios des voix. */
  IDENTITES: R2Bucket;
  /** Limites de débit Cloudflare (facultatives : absentes en local et dans les tests). */
  RL_TOKEN?: RateLimit;
  RL_IP?: RateLimit;
}
