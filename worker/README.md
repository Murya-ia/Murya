# Worker Murya

Traitements en arrière-plan, pris dans la table `jobs` de la base :
pour l'instant les **vérifications audio côté serveur** (spec §6.2).

- `murya_worker/checks.py` : les vérifications (format, durée, silence, saturation, débit,
  coupure, rapport signal/bruit). Les seuils viennent du réglage `server_checks` en base.
- `murya_worker/main.py` : la boucle (plusieurs workers peuvent tourner en même temps).
- `murya_worker/services.py` : accès à Supabase et à R2.

## Lancer les tests

```bash
python -m venv .venv
```

```bash
.venv/Scripts/python -m pip install -r requirements-dev.txt
```

```bash
.venv/Scripts/python -m pytest -q
```

(Sous macOS ou Linux, remplacez `.venv/Scripts/` par `.venv/bin/`.)

## En ligne

Le workflow `.github/workflows/worker.yml` le lance toutes les 15 minutes sur GitHub Actions
(gratuit pour un dépôt public). Variables nécessaires : voir l'en-tête du workflow.
