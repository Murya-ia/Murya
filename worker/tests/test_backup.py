"""Tests des sauvegardes et de la restauration, sans base de données (dossiers locaux et
fausse base). Le test de bout en bout avec un vrai Postgres est dans test_backup_integration.py.
"""

import datetime as dt
import gzip
import json

import pytest
from pyrage import x25519

from murya_worker import backup, restore
from murya_worker.stores import DirStore

KEY = x25519.Identity.generate()
PUBLIC = [KEY.to_public()]
SUNDAY = dt.date(2026, 11, 1)


@pytest.fixture
def stores(tmp_path):
    audio = DirStore(tmp_path / "r2-audio")
    identities = DirStore(tmp_path / "r2-identites")
    dest = DirStore(tmp_path / "b2")
    audio.put("dje/varie/V001/dje_V001_S0001_1.wav", b"voix 1")
    audio.put("dje/varie/V002/dje_V002_S0001_1.wav", b"voix 2")
    audio.put("dje/principale/V002/dje_V002_S0002_1.wav", b"voix 2 principale")
    audio.put("preuve/essai.wav", b"page de preuve")
    identities.put("consentements-oraux/inv-2/accord.m4a", b"accord oral")
    return audio, identities, dest


def fake_query(db_url, query):
    if query == backup.VERSION_QUERY:
        return "20261030090000"
    if query == backup.COUNT_QUERY:
        return json.dumps({"public.speakers": 2, "prive.identities": 2})
    raise AssertionError(query)


def run(stores, today=SUNDAY):
    audio, identities, dest = stores
    return backup.run_backup(
        "postgresql://test", audio, identities, dest, PUBLIC, today,
        dump=lambda url: b"INSERT INTO public.speakers VALUES (1);",
        query=fake_query,
    )


def test_tout_est_chiffre_et_seul_le_manifeste_est_lisible(stores):
    report = run(stores)
    _, _, dest = stores
    keys = list(dest.list())
    assert "base/quotidien/2026-11-01/manifeste.json" in keys
    assert "base/hebdo/2026-11-01/donnees.sql.gz.age" in keys  # le dimanche
    for key in keys:
        if key.endswith(".age"):
            assert b"voix" not in dest.get(key)
            assert b"INSERT" not in dest.get(key)
    dump = gzip.decompress(restore.decrypt(dest.get("base/quotidien/2026-11-01/donnees.sql.gz.age"), KEY))
    assert dump == b"INSERT INTO public.speakers VALUES (1);"
    manifest = json.loads(dest.get("base/quotidien/2026-11-01/manifeste.json"))
    assert manifest["migration"] == "20261030090000"
    assert manifest["lignes"] == {"public.speakers": 2, "prive.identities": 2}
    assert report["audios"] == {"total": 3, "copies": 3}
    assert report["consentements_oraux"] == {"total": 1, "copies": 1}


def test_la_page_de_preuve_n_est_pas_sauvegardee_et_rien_n_est_recopie(stores):
    run(stores)
    second = run(stores, SUNDAY + dt.timedelta(days=1))
    _, _, dest = stores
    assert not any("preuve" in key for key in dest.list())
    assert second["audios"] == {"total": 3, "copies": 0}
    assert "base/hebdo/2026-11-02/manifeste.json" not in list(dest.list())


def test_garde_7_jours_et_4_semaines(stores):
    _, _, dest = stores
    for days in range(40):
        run(stores, SUNDAY - dt.timedelta(days=days))
    run(stores, SUNDAY)
    daily = backup.backup_dates(dest, "base/quotidien/")
    weekly = backup.backup_dates(dest, "base/hebdo/")
    assert daily == [SUNDAY - dt.timedelta(days=d) for d in range(6, -1, -1)]
    assert weekly == [SUNDAY - dt.timedelta(weeks=w) for w in range(3, -1, -1)]


def test_une_voix_retiree_disparait_de_la_sauvegarde_la_nuit_suivante(stores):
    audio, identities, dest = stores
    run(stores)
    # Retrait de V002 : l'API efface ses fichiers et laisse une trace.
    audio.delete(["dje/varie/V002/dje_V002_S0001_1.wav", "dje/principale/V002/dje_V002_S0002_1.wav"])
    identities.delete(["consentements-oraux/inv-2/accord.m4a"])
    audio.put(
        "retraits/dje/V002.json",
        json.dumps({"langue": "dje", "numero": "V002", "date": "2026-11-01T12:00:00Z",
                    "par": None, "cles_identites": ["consentements-oraux/inv-2/accord.m4a"]}).encode(),
    )
    report = run(stores, SUNDAY + dt.timedelta(days=1))
    assert report["fichiers_de_voix_retirees_effaces"] == 3
    remaining = list(dest.list("fichiers/"))
    assert not any("V002/" in key or "inv-2" in key for key in remaining)
    assert "fichiers/audio/dje/varie/V001/dje_V001_S0001_1.wav.age" in remaining
    # La trace elle-même est sauvegardée (chiffrée) : elle servira à la restauration.
    assert "fichiers/audio/retraits/dje/V002.json.age" in remaining


def test_restauration_de_la_plus_recente_puis_retrait_reapplique(stores):
    audio, identities, dest = stores
    run(stores, SUNDAY - dt.timedelta(days=1))
    run(stores)
    audio.put(
        "retraits/dje/V001.json",
        json.dumps({"langue": "dje", "numero": "V001", "date": "2026-11-02T08:00:00Z",
                    "par": "11111111-1111-4111-8111-111111111111", "cles_identites": []}).encode(),
    )
    loaded, queries = [], []

    def load(db_url, sql, tables):
        loaded.append((sql, tables))

    def query(db_url, sql):
        queries.append(sql)
        if "restore_reapply_withdrawal" in sql:
            return "t"
        return json.dumps({"public.speakers": 1, "prive.identities": 2})

    target_audio, target_identities = DirStore(audio.root.parent / "neuf-audio"), DirStore(audio.root.parent / "neuf-id")
    report = restore.run_restore(
        dest, KEY, "postgresql://cible", live_audio=audio,
        files_to=(target_audio, target_identities), load=load, query=query,
    )
    assert report["sauvegarde"] == "base/quotidien/2026-11-01/"
    assert loaded == [(b"INSERT INTO public.speakers VALUES (1);", ["public.speakers", "prive.identities"])]
    assert report["voix_retirees_a_nouveau"] == ["V001"]
    assert "'V001'" in queries[0] and "'11111111-1111-4111-8111-111111111111'::uuid" in queries[0]
    assert report["differences"] == {"public.speakers": {"sauvegarde": 2, "restauree": 1}}
    # Les fichiers de la voix retirée ne sont pas recopiés ; les autres le sont, déchiffrés.
    restored = list(target_audio.list())
    assert "dje/varie/V002/dje_V002_S0001_1.wav" in restored
    assert not any("/V001/" in key for key in restored)
    assert target_audio.get("dje/varie/V002/dje_V002_S0001_1.wav") == b"voix 2"
    assert target_identities.get("consentements-oraux/inv-2/accord.m4a") == b"accord oral"


def test_choix_d_une_date_precise_ou_absente(stores):
    _, _, dest = stores
    run(stores, SUNDAY - dt.timedelta(days=2))
    run(stores)
    assert restore.choose_backup(dest, SUNDAY - dt.timedelta(days=2)) == "base/quotidien/2026-10-30/"
    with pytest.raises(SystemExit, match="Disponibles"):
        restore.choose_backup(dest, dt.date(2020, 1, 1))


def test_mauvaise_cle_refusee(stores, tmp_path):
    _, _, dest = stores
    run(stores)
    other = x25519.Identity.generate()
    with pytest.raises(Exception):
        restore.run_restore(dest, other, "postgresql://cible", load=lambda *a: None, query=lambda *a: "{}")


def test_fichier_de_cle(tmp_path, monkeypatch, capsys):
    from murya_worker import cle

    path = tmp_path / "cle.txt"
    monkeypatch.setattr("sys.argv", ["cle", str(path)])
    cle.main()
    output = capsys.readouterr().out
    assert "AGE-SECRET-KEY" not in output  # jamais affichée
    identity = restore.load_identity(str(path))
    assert str(identity.to_public()) in output
    with pytest.raises(SystemExit, match="existe déjà"):
        cle.main()
