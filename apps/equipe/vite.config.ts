import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/** Version affichée dans la barre : commit Git et date du build (pour savoir ce qui tourne). */
function buildVersion(): string {
  let commit = 'local';
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    // Pas de Git disponible : on garde « local ».
  }
  const date = new Date().toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Niamey',
  });
  return `${commit} · ${date}`;
}

export default defineConfig({
  plugins: [react()],
  // Un seul fichier .env.local à la racine du dépôt pour toutes les apps (modèle : .env.example).
  envDir: '../..',
  define: { __BUILD_VERSION__: JSON.stringify(buildVersion()) },
  build: { target: 'es2020' },
  server: { port: 5174 },
});
