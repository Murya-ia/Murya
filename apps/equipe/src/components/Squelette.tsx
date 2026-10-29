// Forme grise qui « respire » à la place d'un chiffre pas encore chargé : la page garde sa
// mise en page, rien ne saute quand le chiffre arrive.

export function Squelette({ largeur = '3ch', hauteur }: { largeur?: string; hauteur?: string }) {
  return (
    <span
      className="squelette"
      style={{ width: largeur, ...(hauteur ? { height: hauteur } : {}) }}
      aria-hidden="true"
    />
  );
}
