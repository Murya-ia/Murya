/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Adresse de l'API (Worker Cloudflare). En local : http://localhost:8787 */
  readonly VITE_API_URL?: string;
  /** Vidéo du tutoriel (facultative tant qu'elle n'est pas tournée). */
  readonly VITE_TUTORIAL_VIDEO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
