// Alertes d'orthographe, par langue, d'après les arrêtés du 19/10/1999 du ministère de
// l'Éducation nationale du Niger :
//   - zarma (dje) : arrêté n° 0215/MEN/SP-CNRE (voir docs/architecture.md, « Orthographe zarma ») ;
//   - kanouri (kby) : arrêté n° 0213/MEN/SP-CNRE (27 lettres, dont ǝ, ɍ, ny, sh) ;
//   - tamasheq (ttq) : arrêté n° 0214/MEN/SP-CNRE (41 lettres latines, dont ḍ ḷ ṣ ṭ ẓ ɣ ǝ).
// Pour les autres langues, seulement les alertes communes (apostrophes, espaces).
// Ce ne sont que des ALERTES : l'équipe tranche, et note sa décision dans la liste des mots
// décidés.

export type OrthographyAlert =
  | 'tilde_au_dessus' // ã ẽ ĩ õ ũ : les nasales s'écrivent avec le tilde SOUS la voyelle (a̰ ḛ…)
  | 'ny_au_lieu_de_ɲ'
  | 'ng_au_lieu_de_ŋ'
  | 'ɲ_au_lieu_de_ny' // kanouri : « gn » s'écrit ny
  | 'schwa_mal_code' // ə (U+0259) au lieu de ǝ (U+01DD), la lettre de l'arrêté
  | 'r_barre_en_deux' // r + barre (U+0335) au lieu de ɍ, une seule lettre
  | 'gamma_grec' // γ grec au lieu de ɣ latin
  | 'apostrophes_melangees' // ’ et ' dans le même texte
  | 'espaces_en_trop'
  | 'caractere_inattendu';

const PUNCTUATION = String.raw`\s.,;:!?'\u2019\u00ab\u00bb"()\-\u2013\u20140-9`;

/** Lettres et signes attendus dans une phrase, par langue (après normalisation NFC). */
const ALLOWED: Record<string, RegExp> = {
  dje: new RegExp(
    String.raw`^[a-zA-Z\u00e0-\u00ff\u014a\u014b\u0272\u019d\u1e1a-\u1e1b\u1e2c-\u1e2d\u1e74-\u1e75\u0300-\u0302\u0330${PUNCTUATION}]*$`,
    'u',
  ),
  // Kanouri : a-z, ǝ Ǝ, ɍ Ɍ (ny et sh sont des lettres de l'alphabet latin de base).
  kby: new RegExp(String.raw`^[a-zA-Z\u01dd\u018e\u024c\u024d${PUNCTUATION}]*$`, 'u'),
  // Tamasheq : a-z, â ă ǝ ḍ ê ǧ î ǰ ɣ ḷ ŋ ô ṣ š ṭ û ẓ et leurs majuscules (J̌ = J + caron).
  ttq: new RegExp(
    String.raw`^[a-zA-Z\u00e2\u00c2\u0103\u0102\u01dd\u018e\u1e0d\u1e0c\u00ea\u00ca\u01e7\u01e6\u00ee\u00ce\u01f0\u030c\u0263\u0194\u1e37\u1e36\u014b\u014a\u00f4\u00d4\u1e63\u1e62\u0161\u0160\u1e6d\u1e6c\u00fb\u00db\u1e93\u1e92${PUNCTUATION}]*$`,
    'u',
  ),
};

export function orthographyAlerts(text: string, language = 'dje'): OrthographyAlert[] {
  const alerts: OrthographyAlert[] = [];
  const nfc = text.normalize('NFC');
  if (language === 'dje') {
    if (/[ãẽĩõũÃẼĨÕŨ]|[aeiouAEIOU]\u0303/u.test(nfc)) alerts.push('tilde_au_dessus');
    if (/ny/i.test(nfc)) alerts.push('ny_au_lieu_de_ɲ');
    if (/ng(?![aeiouɛɔ])/i.test(nfc) || /ng$/i.test(nfc)) alerts.push('ng_au_lieu_de_ŋ');
  }
  if (language === 'kby') {
    if (/[ɲƝ]/u.test(nfc)) alerts.push('ɲ_au_lieu_de_ny');
    if (/[rR]\u0335/u.test(nfc)) alerts.push('r_barre_en_deux');
  }
  if (language === 'ttq' && /[γΓ]/u.test(nfc)) alerts.push('gamma_grec');
  if ((language === 'kby' || language === 'ttq') && /ə/u.test(nfc)) {
    alerts.push('schwa_mal_code');
  }
  if (nfc.includes("'") && nfc.includes('’')) alerts.push('apostrophes_melangees');
  if (/\s{2,}/.test(nfc) || nfc !== nfc.trim()) alerts.push('espaces_en_trop');
  const allowed = ALLOWED[language];
  if (allowed && !allowed.test(nfc)) alerts.push('caractere_inattendu');
  return alerts;
}

export const ORTHOGRAPHY_ALERT_TEXT: Record<OrthographyAlert, string> = {
  tilde_au_dessus:
    'Tilde au-dessus (ã, ẽ…) : les nasales s’écrivent avec le tilde sous la voyelle (a̰, ḛ…).',
  ny_au_lieu_de_ɲ: '« ny » trouvé : l’alphabet officiel écrit « ɲ ».',
  ng_au_lieu_de_ŋ: '« ng » en fin de syllabe : l’alphabet officiel écrit « ŋ ».',
  ɲ_au_lieu_de_ny: '« ɲ » trouvé : en kanouri, l’alphabet officiel écrit « ny ».',
  schwa_mal_code:
    '« ə » trouvé : copiez la lettre « ǝ » de la fiche d’orthographe (elle se ressemble, mais l’ordinateur la voit autrement).',
  r_barre_en_deux:
    'r barré écrit en deux signes : copiez la lettre « ɍ » de la fiche d’orthographe.',
  gamma_grec: '« γ » grec trouvé : copiez la lettre « ɣ » de la fiche d’orthographe.',
  apostrophes_melangees: "Deux sortes d’apostrophes (’ et ').",
  espaces_en_trop: 'Espaces en trop.',
  caractere_inattendu: 'Caractère inhabituel pour cette langue.',
};
