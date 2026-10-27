import { Logo } from '@murya/commun/logo';

// Accueil sans lien d'invitation : on explique simplement comment participer.
// (Pas encore de choix de langue ici : textes en français en attendant la traduction.)
export function Home() {
  return (
    <main className="page centre-vertical">
      <Logo size={56} />
      <p className="devise">
        Votre langue.
        <br />
        Votre voix.
        <br />
        Votre intelligence.
      </p>
      <p className="gris">
        Pour participer, ouvrez le lien personnel que vous avez reçu sur WhatsApp.
      </p>
    </main>
  );
}
