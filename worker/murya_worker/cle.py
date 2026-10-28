"""Crée la paire de clés des sauvegardes (format age).

    python -m murya_worker.cle C:\\chemin\\cle-sauvegarde-murya.txt

- La clé PRIVÉE est écrite dans le fichier indiqué, et nulle part ailleurs (ni à l'écran, ni
  dans un journal). C'est elle qui permet de relire les sauvegardes : à garder précieusement,
  avec une copie hors de l'ordinateur (clé USB…).
- La clé PUBLIQUE est affichée : elle va dans la variable AGE_RECIPIENTS de GitHub. Elle sert
  seulement à chiffrer ; on peut la montrer sans risque.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path

from pyrage import x25519


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage : python -m murya_worker.cle <fichier où écrire la clé privée>")
    path = Path(sys.argv[1])
    if path.exists():
        raise SystemExit(f"{path} existe déjà : je ne l'écrase pas (on perdrait l'ancienne clé).")
    identity = x25519.Identity.generate()
    public = str(identity.to_public())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "# Clé des sauvegardes Murya — À GARDER PRÉCIEUSEMENT, NE JAMAIS LA PARTAGER.\n"
        f"# Créée le {dt.date.today().isoformat()}.\n"
        f"# Clé publique correspondante : {public}\n"
        f"{identity}\n",
        encoding="utf-8",
    )
    print(f"Clé privée écrite dans : {path}")
    print(f"Clé publique (à mettre dans AGE_RECIPIENTS) : {public}")


if __name__ == "__main__":
    main()
