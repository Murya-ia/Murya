"""Accès à Supabase (fonctions SQL « worker_* ») et au stockage R2.

Le worker n'utilise que la clé secrète Supabase et les clés R2, lues dans les variables
d'environnement (jamais dans le code). Il ne manipule aucune donnée personnelle : seulement
des identifiants, des clés de fichiers et des mesures.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Variable d'environnement manquante : {name}")
    return value


class Supabase:
    """Appelle les fonctions SQL réservées au rôle « service » (PostgREST /rpc)."""

    def __init__(self, url: str, secret_key: str) -> None:
        self.url = url.rstrip("/")
        self.secret_key = secret_key

    def rpc(self, function: str, args: dict[str, Any]) -> Any:
        request = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/{function}",
            data=json.dumps(args).encode(),
            headers={"apikey": self.secret_key, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            raise RuntimeError(f"Supabase {function} : HTTP {error.code} {detail}") from error
        return json.loads(body) if body else None


class Storage:
    """Lecture des audios dans R2 (API compatible S3)."""

    def __init__(self, account_id: str, bucket: str, access_key: str, secret_key: str) -> None:
        import boto3  # importé ici : les tests des vérifications n'en ont pas besoin

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
