import { Logo } from '@murya/commun/logo';

// Page d'accueil provisoire (J1). Le parcours de la voix arrive au J2.
export function Home() {
  return (
    <main className="page accueil">
      <Logo size={56} />
      <p className="devise">
        Votre langue.
        <br />
        Votre voix.
        <br />
        Votre intelligence.
      </p>
      <p className="gris">La collecte commence bientôt.</p>
    </main>
  );
}
