"""Restauration d'une sauvegarde (spec §8.3). Mode d'emploi pas à pas : docs/sauvegardes.md.

1. La base cible doit déjà avoir le bon schéma (migrations du dépôt appliquées, à la version
   indiquée dans le manifeste) : on n'y charge que les données.
2. Les tables de nos schémas sont vidées, puis les données de la sauvegarde sont chargées, en
   une seule transaction (si quelque chose échoue, rien n'est changé).
3. Les voix retirées APRÈS la date de la sauvegarde sont retirées à nouveau, grâce aux traces
   « retraits/… » (celles de la sauvegarde, et celles du stockage en ligne s'il est encore là).
4. Le nombre de lignes de chaque table est comparé au manifeste.
5. Sur demande, les fichiers (audios, consentements oraux) sont recopiés, déchiffrés, vers
   des buckets.

Lancement (exemple) :
    python -m murya_worker.restore --cle C:\\chemin\\cle-sauvegarde.txt --base "postgresql://…"
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import subprocess
from typing import Any, Callable

import pyrage
from pyrage import x25519

from .backup import COUNT_QUERY, DUMP_NAME, MANIFEST_NAME, backup_dates, psql
from .stores import Store


def load_identity(path: str) -> x25519.Identity:
    """Lit la clé privée (ligne « AGE-SECRET-KEY-… ») dans le fichier texte des admins."""
    with open(path, encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if line.startswith("AGE-SECRET-KEY-"):
                return x25519.Identity.from_str(line)
    raise SystemExit(f"Aucune clé privée « AGE-SECRET-KEY-… » dans {path}")


def decrypt(data: bytes, identity: x25519.Identity) -> bytes:
    return pyrage.decrypt(data, [identity])


def choose_backup(store: Store, day: dt.date | None) -> str:
    """Dossier de la sauvegarde à restaurer : la plus récente, ou celle du jour demandé."""
    candidates: dict[dt.date, str] = {}
    for prefix in ("base/hebdo/", "base/quotidien/"):
        for date in backup_dates(store, prefix):
            candidates[date] = f"{prefix}{date.isoformat()}/"
    if not candidates:
        raise SystemExit("Aucune sauvegarde de la base dans ce bucket.")
    if day is None:
        return candidates[max(candidates)]
    if day not in candidates:
        available = ", ".join(d.isoformat() for d in sorted(candidates))
        raise SystemExit(f"Pas de sauvegarde le {day.isoformat()}. Disponibles : {available}")
    return candidates[day]


def load_sql(db_url: str, sql: bytes, tables: list[str]) -> None:
    """Vide nos tables puis charge les données, en une transaction. `session_replication_role`
    coupe les déclencheurs et les contrôles de clés étrangères pendant le chargement (méthode
    recommandée par Supabase)."""
    ours = [t for t in tables if t.startswith(("public.", "prive."))]
    prelude = "set session_replication_role = replica;\n"
    if ours:
        prelude += "truncate " + ", ".join(ours) + " cascade;\n"
    subprocess.run(
        ["psql", db_url, "--no-psqlrc", "--quiet", "--single-transaction",
         "--set", "ON_ERROR_STOP=1", "--file", "-"],
        input=prelude.encode() + sql,
        check=True,
        capture_output=True,
    )


def reapply_sql(marker: dict[str, Any]) -> str:
    def literal(value: Any) -> str:
        return "null" if value is None else "'" + str(value).replace("'", "''") + "'"

    return (
        "select public.restore_reapply_withdrawal("
        f"{literal(marker['langue'])}, {literal(marker['numero'])}, "
        f"{literal(marker.get('par'))}::uuid, {literal(marker.get('date'))}::timestamptz)"
    )


def backup_markers(store: Store, identity: x25519.Identity) -> list[dict[str, Any]]:
    """Traces de retrait copiées dans la sauvegarde (fichiers/audio/retraits/…)."""
    return [
        json.loads(decrypt(store.get(key), identity))
        for key in store.list("fichiers/audio/retraits/")
        if key.endswith(".json.age")
    ]


def restore_files(
    store: Store, identity: x25519.Identity, prefix: str, target: Store, withdrawn: set[str]
) -> int:
    """Recopie déchiffrée des fichiers ; jamais ceux d'une voix retirée."""
    count = 0
    for key in store.list(prefix):
        original = key[len(prefix) : -len(".age")]
        parts = original.split("/")
        if len(parts) >= 3 and parts[2] in withdrawn:
            continue
        target.put(original, decrypt(store.get(key), identity))
        count += 1
    return count


def run_restore(
    store: Store,
    identity: x25519.Identity,
    db_url: str,
    day: dt.date | None = None,
    live_audio: Store | None = None,
    files_to: tuple[Store, Store] | None = None,
    load: Callable[[str, bytes, list[str]], None] = load_sql,
    query: Callable[[str, str], str] = psql,
) -> dict[str, Any]:
    folder = choose_backup(store, day)
    manifest = json.loads(store.get(folder + MANIFEST_NAME))
    sql = gzip.decompress(decrypt(store.get(folder + DUMP_NAME), identity))
    load(db_url, sql, list(manifest["lignes"]))

    markers = {(m["langue"], m["numero"]): m for m in backup_markers(store, identity)}
    if live_audio is not None:
        from .backup import withdrawal_markers

        markers.update({(m["langue"], m["numero"]): m for m in withdrawal_markers(live_audio)})
    reapplied = [
        number
        for (_, number), marker in sorted(markers.items())
        if query(db_url, reapply_sql(marker)) == "t"
    ]

    counts = json.loads(query(db_url, COUNT_QUERY) or "{}")
    differences = {
        table: {"sauvegarde": expected, "restauree": counts.get(table)}
        for table, expected in manifest["lignes"].items()
        if counts.get(table) != expected
    }
    report: dict[str, Any] = {
        "sauvegarde": folder,
        "migration_attendue": manifest.get("migration"),
        "lignes_restaurees": sum(v for v in counts.values() if v),
        "voix_retirees_a_nouveau": reapplied,
        "differences": differences,
    }
    if files_to is not None:
        withdrawn = {number for (_, number) in markers}
        audio_target, identity_target = files_to
        report["audios_recopies"] = restore_files(
            store, identity, "fichiers/audio/", audio_target, withdrawn
        )
        report["consentements_oraux_recopies"] = restore_files(
            store, identity, "fichiers/identites/", identity_target, set()
        )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Restaure une sauvegarde Murya (docs/sauvegardes.md).")
    parser.add_argument("--cle", required=True, help="fichier texte contenant la clé privée AGE-SECRET-KEY-…")
    parser.add_argument("--base", required=True, help="adresse de la base cible (postgresql://…)")
    parser.add_argument("--date", type=dt.date.fromisoformat, help="date de la sauvegarde (AAAA-MM-JJ), sinon la plus récente")
    parser.add_argument("--fichiers", action="store_true", help="recopier aussi les fichiers vers les buckets R2 (variables R2_*)")
    args = parser.parse_args()

    from .services import env
    from .stores import S3Store

    store = S3Store(
        env("B2_ENDPOINT"), env("B2_BUCKET"), env("B2_KEY_ID"), env("B2_APPLICATION_KEY"),
        region=env("B2_REGION"),
    )
    files_to = None
    live_audio = None
    if args.fichiers:
        account = env("R2_ACCOUNT_ID")
        r2_key, r2_secret = env("R2_ACCESS_KEY_ID"), env("R2_SECRET_ACCESS_KEY")
        live_audio = S3Store.r2(account, env("R2_BUCKET_AUDIO"), r2_key, r2_secret)
        files_to = (live_audio, S3Store.r2(account, env("R2_BUCKET_IDENTITES"), r2_key, r2_secret))
    report = run_restore(
        store, load_identity(args.cle), args.base, args.date, live_audio=live_audio, files_to=files_to
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
