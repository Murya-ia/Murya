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
