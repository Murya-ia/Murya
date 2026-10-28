"""Sauvegarde de nuit (spec §8.3) : la base, les audios et les consentements oraux, chiffrés,
vers un second fournisseur (Backblaze B2). Voir docs/sauvegardes.md.

Ce qui est écrit dans le bucket de sauvegarde :
    base/quotidien/AAAA-MM-JJ/donnees.sql.gz.age   la base (7 derniers jours)
    base/quotidien/AAAA-MM-JJ/manifeste.json       date, version du schéma, nombre de lignes
    base/hebdo/AAAA-MM-JJ/…                         copie du dimanche (4 dernières semaines)
    fichiers/audio/<clé R2>.age                     un fichier par audio (et par trace de retrait)
    fichiers/identites/<clé R2>.age                 consentements oraux

Tout est chiffré avec « age » (clé publique dans AGE_RECIPIENTS) : sans la clé privée, gardée
par les admins, une sauvegarde est illisible. Le manifeste n'est pas chiffré : il ne contient
que des nombres.

Une voix retirée disparaît des sauvegardes : ses fichiers sont effacés du bucket de
sauvegarde la nuit suivante (grâce aux traces « retraits/… » laissées par l'API), et les
copies de la base qui la contiennent sont supprimées au bout de 4 semaines au plus.

Lancement :  python -m murya_worker.backup
"""

from __future__ import annotations

import datetime as dt
import gzip
import json
import subprocess
from typing import Any, Callable

import pyrage
from pyrage import x25519

from .stores import Store

DAILY_KEEP_DAYS = 7
WEEKLY_KEEP_DAYS = 28
# Fichiers à ne pas sauvegarder : page de preuve (effacés après 7 jours) et essais de charge
# (langue « zz », effacés après 1 jour).
EXCLUDED_PREFIXES = ("preuve/", "zz/")
DUMP_NAME = "donnees.sql.gz.age"
MANIFEST_NAME = "manifeste.json"

# Les données de nos schémas et les comptes de l'équipe (Supabase Auth). Le schéma lui-même
# vient des migrations du dépôt (voir docs/sauvegardes.md).
DUMP_TABLES = ["public.*", "prive.*", "auth.users", "auth.identities"]

# Nombre exact de lignes de chaque table sauvegardée, en une seule requête.
COUNT_QUERY = """
select coalesce(json_object_agg(t.name, t.n), '{}')
from (
  select format('%s.%s', table_schema, table_name) as name,
         (xpath('/row/n/text()', query_to_xml(
           format('select count(*) as n from %I.%I', table_schema, table_name),
           false, true, '')))[1]::text::bigint as n
  from information_schema.tables
  where table_type = 'BASE TABLE'
    and (table_schema in ('public', 'prive')
         or (table_schema = 'auth' and table_name in ('users', 'identities')))
  order by 1
) t
"""
VERSION_QUERY = "select coalesce(max(version), '') from supabase_migrations.schema_migrations"


def recipients(value: str) -> list[x25519.Recipient]:
    """Clés publiques age (« age1… »), séparées par des virgules."""
    keys = [part.strip() for part in value.split(",") if part.strip()]
    if not keys:
        raise SystemExit("AGE_RECIPIENTS est vide : aucune clé pour chiffrer.")
    return [x25519.Recipient.from_str(key) for key in keys]


def encrypt(data: bytes, keys: list[x25519.Recipient]) -> bytes:
    return pyrage.encrypt(data, keys)


def run_quiet(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Lance psql ou pg_dump. En cas d'échec, affiche leur message d'erreur (jamais l'adresse
    de la base, qui contient le mot de passe)."""
    result = subprocess.run(command, capture_output=True, **kwargs)
    if result.returncode != 0:
        error = result.stderr if isinstance(result.stderr, str) else result.stderr.decode(errors="replace")
        raise SystemExit(f"{command[0]} a échoué : {error.strip()[-800:]}")
    return result


def psql(db_url: str, query: str) -> str:
    result = run_quiet(
        ["psql", db_url, "--no-psqlrc", "--tuples-only", "--no-align", "--command", query], text=True
    )
    return result.stdout.strip()


def dump_database(db_url: str) -> bytes:
    """Données seulement, en INSERT qui ignorent les lignes déjà présentes : la restauration
    se fait dans une base où les migrations ont déjà créé les tables (et quelques lignes)."""
    command = [
        "pg_dump",
        "--data-only",
        "--no-owner",
        "--no-privileges",
        # INSERT avec le nom des colonnes : la restauration marche même si l'ordre des
        # colonnes diffère (ex. tables de Supabase Auth mises à jour entre-temps).
        "--column-inserts",
        "--rows-per-insert=500",
        "--on-conflict-do-nothing",
        *[f"--table={table}" for table in DUMP_TABLES],
        db_url,
    ]
    # La sortie reste en mémoire : jamais écrite dans un fichier ni dans les journaux.
    return run_quiet(command).stdout


def backup_dates(store: Store, prefix: str) -> list[dt.date]:
    """Dates des sauvegardes présentes sous `prefix` (ex. « base/quotidien/ »)."""
    dates = set()
    for key in store.list(prefix):
        folder = key[len(prefix) :].split("/", 1)[0]
        try:
            dates.add(dt.date.fromisoformat(folder))
        except ValueError:
            continue
    return sorted(dates)


def rotate(store: Store, today: dt.date) -> int:
    """Supprime les copies de la base trop anciennes. Renvoie le nombre de fichiers effacés."""
    removed = 0
    for prefix, keep_days in (("base/quotidien/", DAILY_KEEP_DAYS), ("base/hebdo/", WEEKLY_KEEP_DAYS)):
        for day in backup_dates(store, prefix):
            if (today - day).days >= keep_days:
                keys = list(store.list(f"{prefix}{day.isoformat()}/"))
                store.delete(keys)
                removed += len(keys)
    return removed


def backup_database(
    dump: bytes,
    manifest: dict[str, Any],
    dest: Store,
    keys: list[x25519.Recipient],
    today: dt.date,
) -> list[str]:
    """Écrit la copie du jour (et celle de la semaine le dimanche). Renvoie les dossiers écrits."""
    compressed = gzip.compress(dump)
    encrypted = encrypt(compressed, keys)
    manifest = {**manifest, "taille_compressee": len(compressed)}
    folders = [f"base/quotidien/{today.isoformat()}/"]
    if today.weekday() == 6:  # dimanche
        folders.append(f"base/hebdo/{today.isoformat()}/")
    for folder in folders:
        dest.put(folder + DUMP_NAME, encrypted)
        dest.put(folder + MANIFEST_NAME, json.dumps(manifest, indent=2, ensure_ascii=False).encode())
    return folders


def mirror(source: Store, dest: Store, dest_prefix: str, keys: list[x25519.Recipient]) -> dict[str, int]:
    """Copie chiffrée des fichiers qui ne sont pas encore sauvegardés. Les fichiers d'une voix
    sont toujours nouveaux (chaque prise a sa propre clé) : on ne recopie jamais un fichier."""
    already = set(dest.list(dest_prefix))
    copied = total = 0
    for key in source.list():
        if key.startswith(EXCLUDED_PREFIXES):
            continue
        total += 1
        target = f"{dest_prefix}{key}.age"
        if target not in already:
            dest.put(target, encrypt(source.get(key), keys))
            copied += 1
    return {"total": total, "copies": copied}


def withdrawal_markers(source: Store) -> list[dict[str, Any]]:
    """Traces laissées par l'API à chaque retrait (« retraits/{langue}/{numéro}.json »)."""
    return [json.loads(source.get(key)) for key in source.list("retraits/") if key.endswith(".json")]


def forget_withdrawn(markers: list[dict[str, Any]], dest: Store) -> int:
    """Efface du bucket de sauvegarde les fichiers des voix retirées. Renvoie le nombre effacé."""
    removed = 0
    existing_identities = set(dest.list("fichiers/identites/")) if markers else set()
    for marker in markers:
        lang, number = marker["langue"], marker["numero"]
        keys: list[str] = []
        for kind in ("varie", "principale"):
            keys += list(dest.list(f"fichiers/audio/{lang}/{kind}/{number}/"))
        keys += [
            target
            for key in marker.get("cles_identites", [])
            if (target := f"fichiers/identites/{key}.age") in existing_identities
        ]
        if keys:
            dest.delete(keys)
            removed += len(keys)
    return removed


def run_backup(
    db_url: str,
    audio: Store,
    identities: Store,
    dest: Store,
    keys: list[x25519.Recipient],
    today: dt.date,
    dump: Callable[[str], bytes] = dump_database,
    query: Callable[[str, str], str] = psql,
) -> dict[str, Any]:
    """Sauvegarde complète. Renvoie un compte rendu sans aucune donnée personnelle."""
    manifest = {
        "date": today.isoformat(),
        "migration": query(db_url, VERSION_QUERY),
        "lignes": json.loads(query(db_url, COUNT_QUERY) or "{}"),
        "format": "pg_dump --data-only --column-inserts --on-conflict-do-nothing, gzip, age",
    }
    folders = backup_database(dump(db_url), manifest, dest, keys, today)
    audio_stats = mirror(audio, dest, "fichiers/audio/", keys)
    identity_stats = mirror(identities, dest, "fichiers/identites/", keys)
    markers = withdrawal_markers(audio)
    return {
        "date": today.isoformat(),
        "base": folders,
        "lignes": sum(manifest["lignes"].values()),
        "audios": audio_stats,
        "consentements_oraux": identity_stats,
        "voix_retirees": len(markers),
        "fichiers_de_voix_retirees_effaces": forget_withdrawn(markers, dest),
        "anciennes_copies_effacees": rotate(dest, today),
    }


def main() -> None:
    from .services import env
    from .stores import S3Store

    account = env("R2_ACCOUNT_ID")
    r2_key, r2_secret = env("R2_ACCESS_KEY_ID"), env("R2_SECRET_ACCESS_KEY")
    report = run_backup(
        db_url=env("SUPABASE_DB_URL"),
        audio=S3Store.r2(account, env("R2_BUCKET_AUDIO"), r2_key, r2_secret),
        identities=S3Store.r2(account, env("R2_BUCKET_IDENTITES"), r2_key, r2_secret),
        dest=S3Store(
            env("B2_ENDPOINT"), env("B2_BUCKET"), env("B2_KEY_ID"), env("B2_APPLICATION_KEY"),
            region=env("B2_REGION"),
        ),
        keys=recipients(env("AGE_RECIPIENTS")),
        today=dt.datetime.now(dt.timezone.utc).date(),
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
