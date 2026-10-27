import { createRoot } from 'react-dom/client';
import '@murya/commun/theme.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('app')!).render(<App />);

// Service worker : garde l'interface en cache pour ouvrir l'app sans réseau (seulement en ligne,
// pas en développement local où il gênerait les rechargements).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
