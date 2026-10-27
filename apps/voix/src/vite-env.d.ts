/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse de l'API (Worker Cloudflare). En local : http://localhost:8787 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
