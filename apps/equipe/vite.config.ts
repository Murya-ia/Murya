import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Un seul fichier .env.local à la racine du dépôt pour toutes les apps (modèle : .env.example).
  envDir: '../..',
  build: { target: 'es2020' },
  server: { port: 5174 },
});
