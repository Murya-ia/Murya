import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { csvToObjects, parseCsv } from './csv';

describe('parseCsv', () => {
  it('lit un export Google Sheets (virgules, guillemets, retours à la ligne)', () => {
    const csv =
      'id,zarma,francais\r\nS0001,"Ay go, koy","Je pars"\r\nS0002,"Sur ""deux""\nlignes",ok\r\n';
    expect(parseCsv(csv)).toEqual([
      ['id', 'zarma', 'francais'],
      ['S0001', 'Ay go, koy', 'Je pars'],
      ['S0002', 'Sur "deux"\nlignes', 'ok'],
    ]);
  });

  it('reconnaît les points-virgules d’Excel et ignore la marque BOM et les lignes vides', () => {
    expect(parseCsv('\uFEFFid;zarma\nS1;a̰ ḛ\n\n')).toEqual([
      ['id', 'zarma'],
      ['S1', 'a̰ ḛ'],
    ]);
  });
});

describe('csvToObjects', () => {
  it('utilise les en-têtes, simplifiés (minuscules, sans accents)', () => {
    expect(
      csvToObjects([
        ['ID', 'Français', 'Relu par'],
        ['S1', 'Bonjour', 'Awa'],
      ]),
    ).toEqual([{ id: 'S1', francais: 'Bonjour', relu_par: 'Awa' }]);
  });
});

describe('modèle docs/modele-phrases.csv', () => {
  // Garde le modèle et l'import synchronisés : si une colonne change, ce test échoue.
  const rows = csvToObjects(
    parseCsv(readFileSync(join(import.meta.dirname, '../../../docs/modele-phrases.csv'), 'utf8')),
  );

  it("a exactement les colonnes attendues par l'import", () => {
    expect(Object.keys(rows[0]!)).toEqual([
      'id',
      'zarma',
      'francais',
      'theme',
      'auteur',
      'relu_par',
      'statut',
      'test',
    ]);
  });

  it('prévoit les 5 phrases du test et des identifiants sans espace ni accent', () => {
    expect(rows.filter((r) => r.test === 'oui').map((r) => r.id)).toEqual([
      'T0001',
      'T0002',
      'T0003',
      'T0004',
      'T0005',
    ]);
    for (const row of rows) expect(row.id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("n'importerait rien tel quel (aucune ligne « Validée »)", () => {
    expect(rows.some((r) => (r.statut ?? '').toLowerCase().startsWith('valid'))).toBe(false);
  });
});
