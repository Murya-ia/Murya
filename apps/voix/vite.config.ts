import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
