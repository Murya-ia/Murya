import { createRoot } from 'react-dom/client';
import '@murya/commun/theme.css';
import './styles.css';
import { App } from './App';
import { supabase } from './supabase';

// Mode démo (développement seulement, `?demo`) : données d'exemple, sans compte ni base.
// La condition vaut toujours « faux » dans la version en ligne : ce code n'y est pas inclus.
async function start() {
  let client = supabase;
  if (import.meta.env.DEV) {
    if (new URLSearchParams(location.search).has('demo')) sessionStorage.setItem('murya-demo', '1');
    if (sessionStorage.getItem('murya-demo')) {
      client = (await import('./demo/client')).createDemoClient();
    }
  }
  createRoot(document.getElementById('app')!).render(<App client={client} />);
}

void start();
