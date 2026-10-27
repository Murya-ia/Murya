import { afterEach, describe, expect, it, vi } from 'vitest';
import { newUuid } from './uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('produit un UUID v4', () => {
    expect(newUuid()).toMatch(UUID_V4);
  });

  it('fonctionne sans crypto.randomUUID (navigateurs anciens)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = new Set(Array.from({ length: 100 }, newUuid));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
