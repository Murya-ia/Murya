import { lazy, Suspense } from 'react';
import { readToken, saveToken, TOKEN_RE } from './data/session';
import { Home } from './Home';
import { VoiceApp } from './VoiceApp';

// La page de preuve est chargée à part : les voix ne téléchargent jamais son code.
const ProofPage = lazy(() => import('./proof/ProofPage'));

/**
 * Lien d'invitation `/i/<jeton>` (spec §3.1) : on garde le jeton dans le téléphone, puis on
 * le retire de la barre d'adresse (il n'apparaît plus si la personne partage son écran).
 * La personne peut ensuite revenir par le même lien, ou simplement rouvrir l'app.
 */
function takeTokenFromUrl(): void {
  const match = location.pathname.match(/^\/i\/([^/]+)\/?$/);
  if (match && TOKEN_RE.test(match[1]!)) {
    saveToken(match[1]!);
    history.replaceState(null, '', '/');
  }
}

export function App() {
  if (location.pathname.startsWith('/preuve')) {
    return (
      <Suspense fallback={null}>
        <ProofPage />
      </Suspense>
    );
  }
  takeTokenFromUrl();
  const token = readToken();
  return token ? <VoiceApp token={token} /> : <Home />;
}
