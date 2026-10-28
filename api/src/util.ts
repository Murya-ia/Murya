const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Compare deux textes en temps constant : la durée ne révèle pas combien de
 * caractères sont justes (protection contre les attaques par mesure du temps).
 */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Empreinte SHA-256 en hexadécimal (le jeton des voix n'est jamais stocké en clair). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signature HMAC-SHA256 (hexadécimal) d'un message. La clé est dérivée de la clé secrète
 * Supabase et d'un usage (`exports`, `envois`…) : aucun secret de plus à gérer.
 */
export async function hmacHex(secret: string, usage: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`murya-${usage}:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function allowedOrigins(list: string): string[] {
  return list
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
