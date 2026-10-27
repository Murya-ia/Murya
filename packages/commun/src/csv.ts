// Lecture d'un fichier CSV (export Google Sheets) : virgules ou points-virgules, guillemets,
// retours à la ligne dans une cellule, marque BOM d'Excel. Sans bibliothèque externe.

/** Découpe un texte CSV en lignes de cellules. */
export function parseCsv(text: string): string[][] {
  const content = text.replace(/^\uFEFF/, ''); // BOM ajouté par certains tableurs
  const lineEnd = content.indexOf('\n');
  const firstLine = lineEnd === -1 ? content : content.slice(0, lineEnd);
  // Excel en français exporte souvent avec des points-virgules.
  const separator =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const c = content[i]!;
    if (quoted) {
      if (c === '"' && content[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === separator) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && content[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ''));
}

/**
 * Transforme les lignes en objets d'après la première ligne (en-têtes, en minuscules,
 * sans accents ni espaces superflus : « Relu par » → « relu_par »).
 */
export function csvToObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) =>
    h
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // retire les accents
      .replace(/\s+/g, '_'),
  );
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])));
}
