// Heures enregistrées et validées par semaine (spec §5.1) : barres groupées, un seul axe,
// légende, info-bulle au survol (ou au toucher) et vue en tableau pour l'accessibilité.

import { useEffect, useRef, useState } from 'react';
import { formatHours, niceTicks, weekLabel, type Week } from '../lib/dashboard';

const SERIES = [
  { key: 'enregistrees', label: 'Enregistrées', color: '#2a78d6' },
  { key: 'validees', label: 'Validées', color: '#1baf7a' },
] as const;

const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 28, left: 48 };
const RADIUS = 4;
const GAP = 2;

/** Barre aux coins supérieurs arrondis, posée sur la ligne de base. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function WeeklyChart({ weeks }: { weeks: Week[] }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    setWidth(Math.max(280, Math.round(element.getBoundingClientRect().width)));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [asTable]);

  // Moins de 2 h au maximum : l'axe est en minutes, plus lisible.
  const maxHours = Math.max(0, ...weeks.map((w) => Math.max(w.enregistrees, w.validees)));
  const inMinutes = maxHours < 2;
  const scale = inMinutes ? 60 : 1;
  const ticks = niceTicks(maxHours * scale);
  const top = ticks[ticks.length - 1]!;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const band = plotW / weeks.length;
  const barW = Math.max(3, Math.min(18, (band * 0.7 - GAP) / 2));
  const y = (value: number) => MARGIN.top + plotH - (value * scale * plotH) / top;
  // Une date toutes les N semaines, pour que les dates ne se chevauchent pas (≈ 56 px chacune).
  const labelEvery = Math.max(1, Math.ceil(56 / band));
  const hovered = active === null ? null : weeks[active];

  return (
    <div className="graphique">
      <div className="graphique-entete">
        <ul className="legende" aria-label="Légende">
          {SERIES.map((s) => (
            <li key={s.key}>
              <span className="pastille-serie" style={{ background: s.color }} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <button className="lien" onClick={() => setAsTable((t) => !t)}>
          {asTable ? 'Voir le graphique' : 'Voir le tableau'}
        </button>
      </div>

      {asTable ? (
        <div className="tableau-defilant">
          <table className="tableau">
            <thead>
              <tr>
                <th>Semaine du</th>
                <th>Enregistrées</th>
                <th>Validées</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.semaine}>
                  <td>{weekLabel(w.semaine)}</td>
                  <td>{formatHours(w.enregistrees)}</td>
                  <td>{formatHours(w.validees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="graphique-zone" ref={box} onPointerLeave={() => setActive(null)}>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label="Heures enregistrées et validées par semaine, sur 12 semaines"
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={y(t / scale)}
                  y2={y(t / scale)}
                  className={t === 0 ? 'axe' : 'grille'}
                />
                <text x={MARGIN.left - 8} y={y(t / scale)} dy="0.32em" textAnchor="end">
                  {t.toLocaleString('fr-FR')}
                  {t === top ? (inMinutes ? ' min' : ' h') : ''}
                </text>
              </g>
            ))}
            {weeks.map((w, i) => {
              const x0 = MARGIN.left + i * band + (band - 2 * barW - GAP) / 2;
              return (
                <g key={w.semaine} className={active === i ? 'semaine active' : 'semaine'}>
                  {SERIES.map((s, j) => {
                    const value = w[s.key];
                    return (
                      <path
                        key={s.key}
                        d={barPath(x0 + j * (barW + GAP), y(value), barW, y(0) - y(value))}
                        fill={s.color}
                      />
                    );
                  })}
                  {i % labelEvery === (weeks.length - 1) % labelEvery && (
                    <text x={MARGIN.left + (i + 0.5) * band} y={HEIGHT - 8} textAnchor="middle">
                      {weekLabel(w.semaine)}
                    </text>
                  )}
                  {/* Zone de survol plus large que les barres (toute la colonne). */}
                  <rect
                    x={MARGIN.left + i * band}
                    y={MARGIN.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`Semaine du ${weekLabel(w.semaine)} : ${formatHours(w.enregistrees)} enregistrées, ${formatHours(w.validees)} validées`}
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                  />
                </g>
              );
            })}
          </svg>
          {hovered && active !== null && (
            <div
              className="info-bulle"
              style={{
                left: Math.min(Math.max(MARGIN.left + (active + 0.5) * band, 90), width - 90),
              }}
              role="status"
            >
              <strong>Semaine du {weekLabel(hovered.semaine)}</strong>
              {SERIES.map((s) => (
                <span key={s.key}>
                  <span
                    className="pastille-serie"
                    style={{ background: s.color }}
                    aria-hidden="true"
                  />
                  {s.label} : {formatHours(hovered[s.key])}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
