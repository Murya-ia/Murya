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

describe('orthographyAlerts, kanouri', () => {
  it("accepte les lettres de l'arrêté 0213 (ǝ, ɍ, ny, sh)", () => {
    expect(orthographyAlerts('Nyǝ shiro ɍa Ǝ Ɍ.', 'kby')).toEqual([]);
  });

  it('ne signale pas « ny » ni « ng », mais signale ɲ', () => {
    expect(orthographyAlerts('nya bang', 'kby')).toEqual([]);
    expect(orthographyAlerts('ɲa', 'kby')).toContain('ɲ_au_lieu_de_ny');
  });

  it('signale les lettres qui se ressemblent mais ne sont pas les bonnes', () => {
    expect(orthographyAlerts('kə', 'kby')).toContain('schwa_mal_code');
    expect(orthographyAlerts('kar\u0335a', 'kby')).toContain('r_barre_en_deux');
    expect(orthographyAlerts('été', 'kby')).toContain('caractere_inattendu');
  });
});

describe('orthographyAlerts, tamasheq', () => {
  it("accepte les lettres de l'arrêté 0214", () => {
    expect(orthographyAlerts('âăǝḍêǧîǰɣḷŋôṣšṭûẓ ÂĂƎḌÊǦÎJ̌ƔḶŊÔṢŠṬÛẒ qx.', 'ttq')).toEqual([]);
  });

  it('signale le gamma grec et le schwa mal codé', () => {
    expect(orthographyAlerts('aγa', 'ttq')).toContain('gamma_grec');
    expect(orthographyAlerts('ə', 'ttq')).toContain('schwa_mal_code');
  });
});

describe('orthographyAlerts, autres langues', () => {
  it('garde seulement les alertes communes', () => {
    expect(orthographyAlerts('nya bang é', 'hau')).toEqual([]);
    expect(orthographyAlerts('a  b', 'hau')).toContain('espaces_en_trop');
  });
});
