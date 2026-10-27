// Symbole Murya (un point et trois ondes), redessiné en SVG à partir de la planche
// d'identité visuelle. PROVISOIRE : à remplacer par la source vectorielle officielle.

export function LogoSymbol({
  size = 48,
  color = 'currentColor',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={(size * 82) / 120}
      height={size}
      viewBox="0 0 82 120"
      fill="none"
      role="img"
      aria-label="Murya"
    >
      <ellipse cx="12" cy="60" rx="8" ry="11" fill={color} />
      <g stroke={color} strokeWidth="11" strokeLinecap="round">
        <path d="M25 37.48 A26 26 0 0 1 25 82.52" />
        <path d="M34 21.89 A44 44 0 0 1 34 98.11" />
        <path d="M43 6.31 A62 62 0 0 1 43 113.69" />
      </g>
    </svg>
  );
}

export function Logo({ size = 40, color = 'var(--vert)' }: { size?: number; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.3, color }}>
      <LogoSymbol size={size} color={color} />
      <span style={{ fontSize: size * 0.8, fontWeight: 800, letterSpacing: '-0.02em' }}>murya</span>
    </span>
  );
}
