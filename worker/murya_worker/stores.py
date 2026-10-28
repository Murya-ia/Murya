"""Stockages de fichiers vus de la même façon : R2 et Backblaze B2 (API compatible S3), ou un
dossier local (tests, essais de restauration).
"""

from __future__ import annotations

from pathlib import Path
from typing import Iterator, Protocol


class Store(Protocol):
    def list(self, prefix: str = "") -> Iterator[str]: ...

    def get(self, key: str) -> bytes: ...

    def put(self, key: str, data: bytes) -> None: ...

    def delete(self, keys: list[str]) -> None: ...


class S3Store:
    """Un bucket R2 ou B2."""

    def __init__(self, endpoint: str, bucket: str, access_key: str, secret_key: str, region: str = "auto") -> None:
        import boto3

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
        )

    @classmethod
    def r2(cls, account_id: str, bucket: str, access_key: str, secret_key: str) -> "S3Store":
        return cls(f"https://{account_id}.r2.cloudflarestorage.com", bucket, access_key, secret_key)

    def list(self, prefix: str = "") -> Iterator[str]:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                yield item["Key"]

    def get(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def put(self, key: str, data: bytes) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data)

    def delete(self, keys: list[str]) -> None:
        # Au plus 1 000 clés par requête.
        for i in range(0, len(keys), 1000):
            batch = [{"Key": key} for key in keys[i : i + 1000]]
            self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": batch, "Quiet": True})


class DirStore:
    """Un dossier : chaque clé est un chemin relatif."""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise ValueError(f"clé hors du dossier : {key}")
        return path

    def list(self, prefix: str = "") -> Iterator[str]:
        for path in sorted(self.root.rglob("*")):
            if path.is_file():
                key = path.relative_to(self.root).as_posix()
                if key.startswith(prefix):
                    yield key

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            self._path(key).unlink(missing_ok=True)
