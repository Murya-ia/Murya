// Logo officiel Murya (tracés extraits de murya-logo.svg, voir logo-paths.ts).

import { SYMBOL_PATH, SYMBOL_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from './logo-paths';

/** Symbole seul (point + trois ondes). `size` = hauteur en pixels. */
export function LogoSymbol({
  size = 48,
  color = 'currentColor',
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={(size * 501) / 489}
      height={size}
      viewBox={SYMBOL_VIEWBOX}
      role="img"
      aria-label="Murya"
    >
      <path fill={color} fillRule="evenodd" d={SYMBOL_PATH} />
    </svg>
  );
}

/** Symbole + logotype « murya », côte à côte. `size` = hauteur du symbole en pixels. */
export function Logo({ size = 40, color = 'var(--vert)' }: { size?: number; color?: string }) {
  const wordHeight = size * 0.55;
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.25 }}
      role="img"
      aria-label="Murya"
    >
      <LogoSymbol size={size} color={color} />
      <svg
        width={(wordHeight * 775) / 204}
        height={wordHeight}
        viewBox={WORDMARK_VIEWBOX}
        aria-hidden="true"
      >
        <path fill={color} fillRule="evenodd" d={WORDMARK_PATH} />
      </svg>
    </span>
  );
}
