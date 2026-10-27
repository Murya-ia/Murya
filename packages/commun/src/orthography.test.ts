import { describe, expect, it } from 'vitest';
import { orthographyAlerts } from './orthography';

describe('orthographyAlerts', () => {
  it("n'alerte pas sur une phrase écrite selon l'alphabet officiel", () => {
    expect(orthographyAlerts('Ay ga koy ɲaŋ do, a̰ ḛ ṵ.')).toEqual([]);
  });

  it('repère les nasales écrites avec le tilde au-dessus', () => {
    expect(orthographyAlerts('Nẽ ga ka')).toContain('tilde_au_dessus');
    expect(orthographyAlerts('Ne\u0303 ga ka')).toContain('tilde_au_dessus');
  });

  it('repère « ny » et « ng » à la place de ɲ et ŋ', () => {
    expect(orthographyAlerts('nya')).toContain('ny_au_lieu_de_ɲ');
    expect(orthographyAlerts('bang')).toContain('ng_au_lieu_de_ŋ');
  });

  it('repère les apostrophes mélangées et les espaces en trop', () => {
    expect(orthographyAlerts("a'b a’c")).toContain('apostrophes_melangees');
    expect(orthographyAlerts('a  b')).toContain('espaces_en_trop');
  });

  it('repère un caractère inhabituel', () => {
    expect(orthographyAlerts('Ay ga koy @')).toContain('caractere_inattendu');
  });
});
