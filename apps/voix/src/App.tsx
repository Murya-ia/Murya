import { lazy, Suspense } from 'react';
import { Home } from './Home';

// La page de preuve est chargée à part : les voix ne téléchargent jamais son code.
const ProofPage = lazy(() => import('./proof/ProofPage'));

export function App() {
  if (location.pathname.startsWith('/preuve')) {
    return (
      <Suspense fallback={null}>
        <ProofPage />
      </Suspense>
    );
  }
  return <Home />;
}
