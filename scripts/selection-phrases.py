"""Choisit environ 3 000 phrases variées dans une base générée (« Moment, sujet + action »)
et corrige leur français, au format d'import de l'espace équipe.

    python scripts/selection-phrases.py <base.csv> <sortie.csv> [cible=3000]

- Toutes les phrases écrites à la main (sans doublon) sont gardées.
- Chaque action (« prépare le repas », « va courir le matin »…) est gardée une ou deux fois,
  avec un sujet et une personne qui changent (je, tu, nous, vous, ils, le voisin…), le verbe
  conjugué correctement (table des verbes irréguliers ci-dessous) et les pronoms et
  possessifs accordés (se → me/te/nous/vous, son → mon/ton/notre/votre/leur).
- Quand la conjugaison n'est pas sûre (verbe inconnu, verbe en -é-er, adjectif à accorder),
  le sujet reste à la 3e personne du singulier, comme dans la base : rien n'est inventé.
"""

import csv
import itertools
import re
import sys
from collections import Counter, defaultdict

SOURCE, SORTIE = sys.argv[1], sys.argv[2]
CIBLE = int(sys.argv[3]) if len(sys.argv) > 3 else 3000
rows = list(csv.DictReader(open(SOURCE, encoding="utf-8-sig", newline="")))

MOMENT = re.compile(r"^(Aujourd’hui|Demain|Ce matin|Cet après-midi), (.+)$")
SUJETS_BASE = sorted(
    "je|j’|tu|nous|vous|mon frère|ma sœur|mon ami|mon amie|le responsable|la responsable|"
    "le voisin|la voisine|le client|la cliente|le professeur|l’enseignant|l’enseignante|mon père|"
    "ma mère|les enfants|les habitants|le chauffeur|la vendeuse|le vendeur|le médecin|"
    "l’infirmière|le collègue|la collègue|le chef|la cheffe".split("|"),
    key=len,
    reverse=True,
)

# Sujets à la 3e personne du singulier (masculins d'abord : utiles quand un adjectif suit).
MASCULINS = ["mon frère", "le voisin", "mon père", "le chauffeur", "le médecin", "le vendeur", "mon ami", "le professeur", "le collègue", "le chef", "le client", "le responsable"]
FEMININS = ["ma sœur", "la voisine", "ma mère", "l’infirmière", "la vendeuse", "mon amie", "l’enseignante", "la collègue", "la cheffe", "la cliente", "la responsable"]
PLURIELS = ["les enfants", "les habitants", "mes parents", "les voisins", "les élèves", "nos amis"]

# Verbes irréguliers : 3e pers. du singulier → je, tu, nous, vous, ils.
IRREG = {
    "va": "vais vas allons allez vont", "fait": "fais fais faisons faites font",
    "doit": "dois dois devons devez doivent", "peut": "peux peux pouvons pouvez peuvent",
    "veut": "veux veux voulons voulez veulent", "prend": "prends prends prenons prenez prennent",
    "met": "mets mets mettons mettez mettent", "dit": "dis dis disons dites disent",
    "lit": "lis lis lisons lisez lisent", "écrit": "écris écris écrivons écrivez écrivent",
    "boit": "bois bois buvons buvez boivent", "vient": "viens viens venons venez viennent",
    "tient": "tiens tiens tenons tenez tiennent", "sort": "sors sors sortons sortez sortent",
    "part": "pars pars partons partez partent", "dort": "dors dors dormons dormez dorment",
    "sert": "sers sers servons servez servent", "sait": "sais sais savons savez savent",
    "voit": "vois vois voyons voyez voient", "reçoit": "reçois reçois recevons recevez reçoivent",
    "est": "suis es sommes êtes sont", "a": "ai as avons avez ont",
    "connaît": "connais connais connaissons connaissez connaissent",
    "suit": "suis suis suivons suivez suivent", "vit": "vis vis vivons vivez vivent",
    "court": "cours cours courons courez courent", "croit": "crois crois croyons croyez croient",
    "conduit": "conduis conduis conduisons conduisez conduisent",
    "sourit": "souris souris sourions souriez sourient",
    "éteint": "éteins éteins éteignons éteignez éteignent",
    "attend": "attends attends attendons attendez attendent",
    "répond": "réponds réponds répondons répondez répondent",
    "vend": "vends vends vendons vendez vendent", "entend": "entends entends entendons entendez entendent",
    "perd": "perds perds perdons perdez perdent", "descend": "descends descends descendons descendez descendent",
    "rend": "rends rends rendons rendez rendent", "défend": "défends défends défendons défendez défendent",
}
PREFIXES = ["re", "ré", "com", "ap", "sur", "sou", "pro", "per", "ob", "dé", "en", "ad", "main", "con", "pré", "pres", "tra"]
VERBES_IR = {  # 2e groupe : finit → finis, finissons…
    "finit", "choisit", "réfléchit", "remplit", "réussit", "agit", "grandit", "nourrit", "réunit",
    "fournit", "investit", "garantit", "bâtit", "obéit", "avertit", "accomplit", "établit",
    "guérit", "ralentit", "saisit", "définit", "unit", "applaudit", "enrichit", "élargit", "subit",
}
ETRE_LIKE = {"est", "reste", "semble", "devient", "paraît", "sont"}  # un adjectif suit : accord


def irreg(v):
    if v in IRREG:
        return IRREG[v].split()
    for p in PREFIXES:  # apprend, comprend, revient, obtient, permet, promet…
        if v.startswith(p) and v[len(p):] in IRREG and v[len(p):] not in ("a", "est"):
            return [p + x for x in IRREG[v[len(p):]].split()]
    if v in VERBES_IR:
        s = v[:-1]
        return [s + "s", s + "s", s + "ssons", s + "ssez", s + "ssent"]
    return None


def conjugue(v, pers):
    """Verbe à la 3e pers. du singulier → la personne voulue, ou None si pas sûr."""
    k = {"je": 0, "tu": 1, "nous": 2, "vous": 3, "ils": 4}[pers]
    formes = irreg(v)
    if formes:
        return formes[k]
    if not v.endswith("e") or len(v) < 3:
        return None
    # 1er groupe (et ouvre, offre, accueille…) : prépare → prépares, préparons…
    if pers == "je":
        return v
    if pers == "tu":
        return v + "s"
    if pers == "ils":
        return v + "nt"
    if "è" in v[-5:] or "é" in v[-4:-1]:
        return None  # achète/achetons, préfère/préférons : on ne prend pas de risque
    stem = v[:-1]
    if stem.endswith(("oi", "ui", "ai")):  # nettoie → nettoyons, essuie, paie
        stem = stem[:-1] + "y"
    elif stem.endswith("ell") or stem.endswith("ett"):  # appelle → appelons, jette → jetons
        stem = stem[:-1]
    if pers == "nous":
        if stem.endswith("g"):
            return stem + "eons"
        if stem.endswith("c"):
            return stem[:-1] + "çons"
        return stem + "ons"
    return stem + "ez"


VOYELLE = re.compile(r"^[aeéèêiîoôuyh]", re.I)
REFL = {"je": "me", "tu": "te", "nous": "nous", "vous": "vous", "ils": "se", "il": "se"}
POSS = {
    "je": {"son": "mon", "sa": "ma", "ses": "mes"},
    "tu": {"son": "ton", "sa": "ta", "ses": "tes"},
    "nous": {"son": "notre", "sa": "notre", "ses": "nos"},
    "vous": {"son": "votre", "sa": "votre", "ses": "vos"},
    "ils": {"son": "leur", "sa": "leur", "ses": "leurs"},
}


def elide(mot, suivant):
    if VOYELLE.match(suivant) and mot in ("je", "me", "te", "se", "ne", "le", "la"):
        return mot[0] + "’"
    return mot


def phrase(sujet, pers, action):
    """Réécrit « sujet + action » pour la personne pers ; None si on n'est pas sûr."""
    mots = action.split(" ")
    # Pronoms devant le verbe : se/s’, ne/n’, te, le, la, les, lui, leur, en, y.
    i = 0
    while i < len(mots) - 1 and (
        mots[i] in ("se", "ne", "te", "le", "la", "les", "lui", "leur", "en", "y")
        or re.match(r"^[stnl]’", mots[i])
    ):
        if re.match(r"^[stnl]’", mots[i]):
            break  # s’occupe : le verbe est collé, traité plus bas
        i += 1
    tete = mots[i]
    colle = ""
    m = re.match(r"^([stnl])’(.+)$", tete)
    if m:
        colle, tete = m.group(1), m.group(2)
    verbe = tete.rstrip(".,!?")
    ponct = tete[len(verbe):]
    if pers != "il":
        nv = conjugue(verbe, pers)
        if nv is None:
            return None
    else:
        nv = verbe
    if pers in ("nous", "vous", "ils") and verbe in ETRE_LIKE:
        return None  # l'adjectif qui suit devrait s'accorder
    # Reconstruit les pronoms devant le verbe (accord du réfléchi).
    avant = []
    for w in mots[:i]:
        avant.append(REFL[pers] if w == "se" else w)
    if colle == "s":
        avant.append(REFL[pers])
    elif colle:
        avant.append({"t": "te", "n": "ne", "l": "le"}[colle])
    if pers == "tu" and ("te" in avant or "t’" in avant):
        return None  # « tu te souhaites la bienvenue » n'a pas de sens
    # Un « se » juste après le verbe va avec le sujet (« doit se reposer » → « dois me
    # reposer ») ; plus loin, il n'est pas le sien (« ce qui se passe » reste ainsi).
    apres = mots[i + 1:]
    if apres and apres[0] == "se":
        apres = [REFL[pers]] + apres[1:]
    elif apres and apres[0].startswith("s’"):
        apres = [REFL[pers][0] + "’" + apres[0][2:]] + apres[1:]
    corps = avant + [nv + ponct] + apres
    if pers in POSS:
        corps = [POSS[pers].get(w, w) for w in corps]
    # Élisions : je/me/te/se/ne devant une voyelle ; ma/ta devant une voyelle → mon/ton.
    res = [sujet] + corps
    out = []
    for k, w in enumerate(res):
        suivant = res[k + 1] if k + 1 < len(res) else ""
        if w in ("ma", "ta") and VOYELLE.match(suivant) and not suivant.lower().startswith("h"):
            w = {"ma": "mon", "ta": "ton"}[w]
        if w in ("je", "me", "te", "se", "ne") and suivant and VOYELLE.match(suivant):
            out.append(w[0] + "’" + suivant)
            res[k + 1] = ""
            continue
        if w:
            out.append(w)
    texte = " ".join(x for x in out if x)
    texte = re.sub(r"’ ", "’", texte)
    return texte[0].upper() + texte[1:]


# ------------------------------------------------------------------ tri des lignes
libres, actions = [], defaultdict(list)
for r in rows:
    fr = r["Phrase française"].strip()
    m = MOMENT.match(fr)
    sujet = None
    if m:
        reste = m.group(2)
        for s in SUJETS_BASE:
            if reste.lower().startswith(s + " ") or (s.endswith("’") and reste.lower().startswith(s)):
                sujet = s
                break
    if not sujet:
        libres.append(r)
        continue
    actions[(r["Catégorie"].strip(), reste[len(sujet):].strip())].append(r["ID"].strip())

# Une action vue moins de 10 fois n'en est pas une (ex. « Aujourd’hui, nous sommes lundi. »).
for (cat, act), ids in list(actions.items()):
    if len(ids) < 10:
        for r in rows:
            if r["ID"].strip() in ids:
                libres.append(r)
        del actions[(cat, act)]

vues, sortie = set(), []
for r in libres:
    fr = r["Phrase française"].strip()
    if fr.lower() in vues:
        continue
    vues.add(fr.lower())
    sortie.append({"id": r["ID"].strip(), "fr": fr, "theme": r["Catégorie"].strip(), "note": ""})

# ------------------------------------------------------------------ actions
PERSONNES = itertools.cycle(["il", "je", "il_f", "tu", "nous", "il", "vous", "ils", "il_f", "je"])
masc, fem, plur = itertools.cycle(MASCULINS), itertools.cycle(FEMININS), itertools.cycle(PLURIELS)
MOMENTS = itertools.cycle(["", "Aujourd’hui, ", "", "Demain, ", "Ce matin, ", "", "Ce soir, "])
SUJET_DE = {"je": "je", "tu": "tu", "nous": "nous", "vous": "vous"}

liste = sorted(actions.items())
besoin = max(0, CIBLE - len(sortie))
variantes = 2 if besoin >= 2 * len(liste) else 1
deux = set(range(0, len(liste), max(1, len(liste) // max(1, besoin - len(liste))))) if variantes == 1 and besoin > len(liste) else set()
stats = Counter()
for n, ((cat, act), ids) in enumerate(liste):
    nb = variantes if variantes == 2 else (2 if n in deux else 1)
    utilisees = set()
    for v in range(nb):
        texte = None
        for _ in range(10):
            p = next(PERSONNES)
            if p in utilisees and v > 0:
                continue
            if p == "il":
                sujet, pers = next(masc), "il"
            elif p == "il_f":
                if any(x in act.split() for x in ETRE_LIKE):
                    continue  # adjectif probablement au masculin dans la base
                sujet, pers = next(fem), "il"
            elif p == "ils":
                sujet, pers = next(plur), "ils"
            else:
                sujet, pers = SUJET_DE[p], p
            texte = phrase(sujet, pers, act)
            if texte:
                utilisees.add(p)
                break
        if not texte:
            texte, pers = phrase(next(masc), "il", act), "il"
        moment = "" if "aujourd’hui" in act.lower() or "demain" in act.lower() else next(MOMENTS)
        if moment:
            texte = moment + texte[0].lower() + texte[1:] if not texte.startswith(("Je", "J’", "Tu", "Nous", "Vous")) else moment + texte[0].lower() + texte[1:]
        stats[pers] += 1
        sortie.append({"id": ids[v % len(ids)], "fr": texte, "theme": cat, "note": "corrigée (sujet et accords)"})

with open(SORTIE, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    w.writerow(["ID", "Zarma", "Français", "Thème", "Auteur", "Relu par", "Statut", "Test", "Remarque"])
    for s in sorted(sortie, key=lambda s: (s["theme"], s["id"])):
        w.writerow([s["id"], "", s["fr"], s["theme"], "", "", "À écrire", "non", s["note"]])

print(f"{len(sortie)} phrases → {SORTIE}")
print(f"  écrites à la main : {sum(1 for s in sortie if not s['note'])}")
print(f"  tirées des {len(liste)} actions : {sum(1 for s in sortie if s['note'])}  (personnes : {dict(stats)})")
print(f"  thèmes : {len({s['theme'] for s in sortie})}")
