// Traduction des textes de l'appli des voix en zarma, par l'équipe, dans un tableur.
//
//   node scripts/traductions.mjs exporter   → docs/traduction-zarma.csv (à ouvrir dans Google Sheets)
//   node scripts/traductions.mjs importer   ← docs/traduction-zarma.csv (rempli) → apps/voix/src/i18n/dje.json
//
// Une case zarma vide garde le texte français (l'appli l'affiche en attendant). Les mots entre
// accolades, comme {n}, sont remplacés par l'appli (un nombre, un numéro) : ils doivent rester
// tels quels dans la traduction.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const FR = join(ROOT, 'apps/voix/src/i18n/fr.json');
const DJE = join(ROOT, 'apps/voix/src/i18n/dje.json');
const CSV = join(ROOT, 'docs/traduction-zarma.csv');

/** Où le texte apparaît, pour aider la personne qui traduit. */
const CONTEXT = {
  commun: 'Boutons et messages utilisés sur plusieurs écrans',
  langue: 'Premier écran : choix de la langue',
  accueil: "Page d'accueil (personne sans lien d'invitation)",
  erreur: "Messages d'erreur",
  consentement: "Écran de l'accord (cases à cocher)",
  rappel: "Rappel de l'accord, quelques jours plus tard",
  fiche: 'Écran « Quelques questions » (sexe, âge, région, langue)',
  region: 'Noms des régions du Niger (liste à choisir)',
  langues: 'Noms des langues (liste « langue maternelle »)',
  tutoriel: 'Écran du tutoriel (vidéo et conseils)',
  enregistrement: "Écran d'enregistrement d'une phrase",
  micro: "Messages sur l'accès au micro du téléphone",
  attente: 'Après le test : attente de la réponse de l’équipe',
  fin: 'Fin : toutes les phrases sont enregistrées',
  seance: 'Voix principale : début de séance (audio de référence)',
  verification: 'Voix principale : séance finie, en attente de vérification',
  repetition: 'Mode « écouter puis répéter » (personnes qui ne lisent pas)',
};

const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join(' ');

function csvCell(value) {
  return /[",\n;]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Lecture d'un CSV (virgules ou points-virgules, guillemets doublés), tel que l'exporte un tableur. */
function parseCsv(text) {
  const separator = text.split('\n')[0].includes(';') ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const fr = JSON.parse(readFileSync(FR, 'utf8'));
const command = process.argv[2];

if (command === 'exporter') {
  const dje = JSON.parse(readFileSync(DJE, 'utf8'));
  const lines = [['cle', 'ou', 'francais', 'zarma'].join(',')];
  for (const [key, text] of Object.entries(fr)) {
    const where = CONTEXT[key.split('.')[0]] ?? '';
    lines.push([key, where, text, dje[key] ?? ''].map(csvCell).join(','));
  }
  // BOM : Excel et Google Sheets reconnaissent ainsi les accents.
  writeFileSync(CSV, `﻿${lines.join('\n')}\n`);
  console.log(`${Object.keys(fr).length} textes écrits dans docs/traduction-zarma.csv`);
} else if (command === 'importer') {
  const rows = parseCsv(readFileSync(CSV, 'utf8').replace(/^﻿/, ''));
  const header = rows.shift().map((c) => c.trim().toLowerCase());
  const [keyCol, djeCol] = [header.indexOf('cle'), header.indexOf('zarma')];
  const dje = {};
  const problems = [];
  for (const row of rows) {
    const key = row[keyCol]?.trim();
    const text = row[djeCol]?.normalize('NFC').trim() ?? '';
    if (!key || !text) continue;
    if (!(key in fr)) problems.push(`${key} : clé inconnue (ligne à ne pas modifier)`);
    else if (placeholders(text) !== placeholders(fr[key])) {
      problems.push(
        `${key} : garder exactement ${placeholders(fr[key]) || 'aucun mot entre accolades'}`,
      );
    } else dje[key] = text;
  }
  writeFileSync(DJE, `${JSON.stringify(dje, null, 2)}\n`);
  console.log(`${Object.keys(dje).length} textes en zarma sur ${Object.keys(fr).length}.`);
  if (problems.length) {
    console.log(`\nÀ corriger dans le tableau (${problems.length}) :`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
  }
} else {
  console.log('Usage : node scripts/traductions.mjs exporter | importer');
}
