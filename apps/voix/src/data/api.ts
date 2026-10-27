// Client de l'API des voix. Le jeton d'invitation part dans l'en-tête Authorization,
// jamais dans l'adresse (il ne doit apparaître dans aucun journal).

export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

/** Réponse d'erreur de l'API : `code` est un code court (ex. `lien_expire`). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

/**
 * Une coupure réseau lève une `TypeError` (fetch), une réponse d'erreur lève une `ApiError`.
 * L'app distingue ainsi « pas de réseau » (on réessaiera) de « refusé » (il faut agir).
 */
export function createApi(token: string, baseUrl = API_URL): Api {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { erreur?: string };
    if (!response.ok) throw new ApiError(response.status, data.erreur ?? `http_${response.status}`);
    return data as T;
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body ?? {}),
  };
}
