"""Convertit une base de phrases (ID, Catégorie, Phrase française, Traduction zarma, …) au
format d'import de l'espace équipe (docs/modele-phrases.csv), sans rien perdre.

    python scripts/convertir-phrases.py <base.csv> <sortie.csv>

- Statut : « À écrire » tant que le zarma est vide, « À relire » s'il est rempli (un
  relecteur le passe ensuite à « Validée » : seules ces lignes sont importées).
- Doublons exacts (même phrase française) : « Refusée », avec l'ID de la première.
- Colonne « Remarque » (ignorée par l'import) : doublon, verbe mal accordé avec le sujet,
  moment répété (« Ce matin, … aujourd'hui »), pronom qui ne va pas avec le sujet.
"""

import csv
import re
import sys
from collections import Counter

SOURCE, SORTIE = sys.argv[1], sys.argv[2]
rows = list(csv.DictReader(open(SOURCE, encoding="utf-8-sig", newline="")))

MOMENT = re.compile(r"^(Aujourd’hui|Demain|Ce matin|Cet après-midi|Ce soir|Hier), (.+)$")
SUJET = re.compile(
    r"^(je|j’|tu|nous|vous|ils|elles|il|elle|on|les \w+|mes \w+|tes \w+|ses \w+|nos \w+|vos \w+"
    r"|leurs \w+|ces \w+|(?:le|la|mon|ma|ton|ta|son|sa|notre|votre|leur|ce|cette) \w+|l’\w+)\s+(.+)$"
)
PRONOMS = {"me", "m’", "te", "t’", "se", "s’", "nous", "vous", "le", "la", "les", "l’", "lui", "leur", "en", "y", "ne", "n’"}
REFLECHI = {"je": {"me", "m’"}, "j’": {"me", "m’"}, "tu": {"te", "t’"}, "nous": {"nous"}, "vous": {"vous"}}


def personne(sujet: str) -> str:
    if sujet in ("je", "j’"):
        return "je"
    if sujet in ("tu", "nous", "vous"):
        return sujet
    if sujet in ("ils", "elles") or re.match(r"^(les|mes|tes|ses|nos|vos|leurs|ces) ", sujet):
        return "ils"
    return "il"


def accord(pers: str, verbe: str) -> bool:
    """Le verbe conjugué va-t-il avec la personne ? (vérification simple, sans dictionnaire)"""
    v = verbe.lower().strip(".,!?")
    if pers == "je":
        return v.endswith(("e", "s", "x", "ai")) or v in ("peux", "veux", "vais")
    if pers == "tu":
        return v.endswith(("s", "x"))
    if pers == "nous":
        return v.endswith("ons") or v == "sommes"
    if pers == "vous":
        return v.endswith("ez") or v in ("êtes", "faites", "dites")
    if pers == "ils":
        return v.endswith(("ent", "ont"))
    return not v.endswith(("ons", "ez", "ent")) or v in ("ment", "sent", "vent", "dent")


def remarques(phrase: str) -> list[str]:
    notes = []
    m = MOMENT.match(phrase)
    if not m:
        return notes
    moment, reste = m.groups()
    if moment != "Aujourd’hui" and "aujourd’hui" in reste.lower():
        notes.append("moment répété")
    s = SUJET.match(reste)
    if not s:
        return notes
    sujet, suite = s.group(1).lower(), s.group(2).split()
    pers = personne(sujet)
    mots = [w.lower() for w in suite]
    # Pronoms (se, te, le…) avant le verbe.
    k = 0
    while k < len(mots) - 1 and (mots[k] in PRONOMS or re.match(r"^[mtsln]’", mots[k])):
        if mots[k] in ("se", "s’") and pers in REFLECHI:
            notes.append("pronom à accorder (se → " + "/".join(sorted(REFLECHI[pers])) + ")")
        k += 1
    verbe = re.sub(r"^[mtsln]’", "", mots[k]) if k < len(mots) else ""
    if verbe and not accord(pers, verbe):
        notes.append(f"verbe à accorder avec « {s.group(1)} »")
    if pers == "ils" and re.search(r"\b(ses|son|sa)\b", " ".join(mots)):
        notes.append("possessif à vérifier (ses → leurs ?)")
    return notes


premiere = {}
compte = Counter()
sortie = []
for r in rows:
    fr = r["Phrase française"].strip()
    zarma = r["Traduction zarma"].strip()
    cle = fr.lower()
    notes = remarques(fr)
    statut = "À relire" if zarma else "À écrire"
    if cle in premiere:
        statut = "Refusée"
        notes = [f"doublon de {premiere[cle]}"]
    else:
        premiere[cle] = r["ID"].strip()
    if r.get("Contexte / notes", "").strip():
        notes.append(r["Contexte / notes"].strip())
    compte[statut] += 1
    if notes and statut != "Refusée":
        compte["avec remarque"] += 1
    sortie.append(
        {
            "ID": r["ID"].strip(),
            "Zarma": zarma,
            "Français": fr,
            "Thème": r["Catégorie"].strip(),
            "Auteur": "",
            "Relu par": "",
            "Statut": statut,
            "Test": "non",
            "Remarque": " ; ".join(notes),
        }
    )

with open(SORTIE, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(sortie[0].keys()))
    w.writeheader()
    w.writerows(sortie)

print(f"{len(sortie)} lignes écrites dans {SORTIE}")
for k, n in compte.most_common():
    print(f"  {k} : {n}")
