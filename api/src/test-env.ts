// Outils communs aux tests de l'API : faux bucket R2 en mémoire et variables d'environnement.

import type { Env } from './env';

export function fakeBucket(files: Record<string, Uint8Array> = {}) {
  return {
    files,
    async head(key: string) {
      return files[key] ? { size: files[key].byteLength } : null;
    },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const file = files[key];
      if (!file) return null;
      const { offset = 0, length = file.byteLength } = options?.range ?? {};
      const part = file.slice(offset, offset + length);
      return { arrayBuffer: async () => part.buffer };
    },
    async delete(key: string) {
      delete files[key];
    },
  };
}

export function testEnv(overrides: Partial<Env> = {}, files?: Record<string, Uint8Array>): Env {
  return {
    ENVIRONMENT: 'local',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    R2_ACCOUNT_ID: 'compte',
    R2_BUCKET_AUDIO: 'murya-audio-staging',
    R2_ACCESS_KEY_ID: 'cle',
    R2_SECRET_ACCESS_KEY: 'secret',
    PROOF_CODE: 'zarma2027',
    SUPABASE_URL: 'https://projet.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    AUDIO: fakeBucket(files) as unknown as R2Bucket,
    ...overrides,
  };
}
