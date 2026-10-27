// Barre de niveau sonore : elle bouge quand on parle, pour montrer que le micro fonctionne.

/** Niveau (en dB) en dessous duquel la barre est vide. */
const MIN_DB = -60;

export function LevelMeter({ rms, active }: { rms: number; active: boolean }) {
  const db = rms > 0 ? 20 * Math.log10(rms) : MIN_DB;
  const percent = Math.max(0, Math.min(100, ((db - MIN_DB) / -MIN_DB) * 100));
  return (
    <div
      className={`niveau ${active ? 'actif' : ''}`}
      role="meter"
      aria-label="Niveau du micro"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <div className="niveau-barre" style={{ width: `${percent}%` }} />
    </div>
  );
}
