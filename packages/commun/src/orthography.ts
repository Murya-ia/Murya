// Alertes d'orthographe pour le zarma, d'après l'arrêté n° 0215/MEN/SP-CNRE du 19/10/1999
// (voir docs/architecture.md, « Orthographe zarma »). Ce ne sont que des ALERTES : l'équipe
// tranche, et note sa décision dans la liste des mots décidés.

export type OrthographyAlert =
  | 'tilde_au_dessus' // ã ẽ ĩ õ ũ : les nasales s'écrivent avec le tilde SOUS la voyelle (a̰ ḛ…)
  | 'ny_au_lieu_de_ɲ'
  | 'ng_au_lieu_de_ŋ'
  | 'apostrophes_melangees' // ’ et ' dans le même texte
  | 'espaces_en_trop'
  | 'caractere_inattendu';

/** Lettres et signes attendus dans une phrase zarma (après normalisation NFC). */
const ALLOWED =
  /^[a-zA-Z\u00e0-\u00ff\u014a\u014b\u0272\u019d\u1e1a-\u1e1b\u1e2c-\u1e2d\u1e74-\u1e75\u0300-\u0302\u0330\s.,;:!?'\u2019\u00ab\u00bb"()\-\u2013\u20140-9]*$/u;

export function orthographyAlerts(text: string): OrthographyAlert[] {
  const alerts: OrthographyAlert[] = [];
  const nfc = text.normalize('NFC');
  if (/[ãẽĩõũÃẼĨÕŨ]|[aeiouAEIOU]\u0303/u.test(nfc)) alerts.push('tilde_au_dessus');
  if (/ny/i.test(nfc)) alerts.push('ny_au_lieu_de_ɲ');
  if (/ng(?![aeiouɛɔ])/i.test(nfc) || /ng$/i.test(nfc)) alerts.push('ng_au_lieu_de_ŋ');
  if (nfc.includes("'") && nfc.includes('’')) alerts.push('apostrophes_melangees');
  if (/\s{2,}/.test(nfc) || nfc !== nfc.trim()) alerts.push('espaces_en_trop');
  if (!ALLOWED.test(nfc)) alerts.push('caractere_inattendu');
  return alerts;
}

export const ORTHOGRAPHY_ALERT_TEXT: Record<OrthographyAlert, string> = {
  tilde_au_dessus:
    'Tilde au-dessus (ã, ẽ…) : les nasales s’écrivent avec le tilde sous la voyelle (a̰, ḛ…).',
  ny_au_lieu_de_ɲ: '« ny » trouvé : l’alphabet officiel écrit « ɲ ».',
  ng_au_lieu_de_ŋ: '« ng » en fin de syllabe : l’alphabet officiel écrit « ŋ ».',
  apostrophes_melangees: "Deux sortes d’apostrophes (’ et ').",
  espaces_en_trop: 'Espaces en trop.',
  caractere_inattendu: 'Caractère inhabituel pour le zarma.',
};
