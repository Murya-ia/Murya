import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Fichiers à garder en cache hors ligne en plus des fichiers JS/CSS du build. */
// index.html est ajoutée ici car Vite la produit après notre plugin : c'est elle qui permet
// d'ouvrir l'app sans réseau.
const EXTRA_PRECACHE = [
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
];

/**
 * Génère `sw.js` au moment du build, avec la liste exacte des fichiers à mettre en cache.
 * (Petit plugin maison plutôt qu'une bibliothèque : moins de dépendances à maintenir.)
 */
function serviceWorker(): Plugin {
  return {
    name: 'murya-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .map((f) => `/${f}`);
      const precache = [...new Set([...files, ...EXTRA_PRECACHE])].sort();
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./sw-template.js', import.meta.url), 'utf8')
        .replaceAll('__VERSION__', version)
        .replaceAll('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  // Un seul fichier .env.local à la racine du dépôt pour toutes les apps (modèle : .env.example).
  envDir: '../..',
  build: {
    // Vieux téléphones Android : on reste sur une syntaxe JavaScript largement supportée.
    target: 'es2020',
    // Pas de fichiers .map publiés : ils doubleraient le poids téléchargeable.
    sourcemap: false,
  },
  server: { port: 5173 },
});
