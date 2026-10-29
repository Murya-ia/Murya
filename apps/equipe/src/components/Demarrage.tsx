// Écran de chargement (logo Murya), le même que celui d'index.html : il reste affiché tant
// que la session et le membre connecté ne sont pas lus, au lieu d'une page vide.

export function Demarrage() {
  return (
    <div className="demarrage" role="status" aria-label="Chargement de l'espace équipe">
      <div className="demarrage-logo">
        <img src="/favicon.svg" alt="" width="64" height="64" />
      </div>
      <div className="demarrage-nom">
        murya<small>Espace équipe</small>
      </div>
      <div className="demarrage-barre" aria-hidden="true" />
    </div>
  );
}
