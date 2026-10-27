import { defineConfig } from 'vitest/config';

// Une seule configuration de tests pour tout le dépôt :
// `npm test` lance les tests de packages/, api/, apps/ et ceux de la base (supabase/tests).
export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'api/**/*.test.ts',
      'apps/**/*.test.ts',
      'supabase/tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // Les tests de base de données démarrent un Postgres en mémoire (PGlite) : un peu lents.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
