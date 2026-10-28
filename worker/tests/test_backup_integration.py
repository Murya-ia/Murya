"""Test de restauration de bout en bout, sur le vrai Postgres de Supabase (spec §8.3 :
« test de restauration documenté »). Lancé par la CI (job « Sauvegarde et restauration ») ;
ignoré ailleurs, faute de base.

    sauvegarde → base entièrement effacée (migrations rejouées) → restauration → vérifications
"""

import datetime as dt
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from pyrage import x25519

from murya_worker import backup, restore
from murya_worker.stores import DirStore

DB_URL = os.environ.get("MURYA_TEST_DB_URL", "")
REPO = Path(__file__).resolve().parents[2]
ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

pytestmark = pytest.mark.skipif(
    not DB_URL or not shutil.which("pg_dump") or not shutil.which("supabase"),
    reason="base Supabase locale absente (test lancé par la CI)",
)


def sql(query: str) -> str:
    return backup.psql(DB_URL, query)


def reset_database() -> None:
    subprocess.run(["supabase", "db", "reset", "--local"], cwd=REPO, check=True, capture_output=True)


SEED = f"""
insert into auth.users (id, email) values ('{ADMIN}', 'admin@test.murya');
insert into public.team_members (user_id, display_name, roles) values ('{ADMIN}', 'Admin', '{{admin}}');
insert into public.sentences (language_code, code, text) values ('dje', 'S0001', 'Ay ga koy habu.');
with v as (
  insert into public.speakers (language_code, number, recruiter_id, gender)
  select 'dje', public.next_speaker_number('dje'), '{ADMIN}', 'femme' from generate_series(1, 2)
  returning id, number
)
insert into prive.identities (speaker_id, full_name, contact)
select id, 'Nom de ' || number, '+227 ' || number from v;
insert into public.recordings (id, speaker_id, sentence_id, sentence_version, take, kind,
                               storage_key, upload_status, received_at, qc_status)
select gen_random_uuid(), s.id, t.id, 1, 1, 'varie',
       format('dje/varie/%s/dje_%s_S0001_1.wav', s.number, s.number), 'recu', now(), 'valide'
from public.speakers s, public.sentences t where t.code = 'S0001';
insert into public.audit_log (actor_kind, action) values ('systeme', 'essai_sauvegarde');
"""


def test_sauvegarde_puis_restauration_dans_une_base_vide(tmp_path):
    reset_database()
    subprocess.run(["psql", DB_URL, "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", SEED], check=True, capture_output=True)
    before = json.loads(sql(backup.COUNT_QUERY))
    numbers = sql("select string_agg(number, ',' order by number) from public.speakers").split(",")
    assert numbers == ["V001", "V002"]

    key = x25519.Identity.generate()
    audio, identities, dest = DirStore(tmp_path / "audio"), DirStore(tmp_path / "id"), DirStore(tmp_path / "b2")
    for number in numbers:
        audio.put(f"dje/varie/{number}/dje_{number}_S0001_1.wav", number.encode())
    today = dt.date(2026, 11, 3)
    report = backup.run_backup(DB_URL, audio, identities, dest, [key.to_public()], today)
    assert report["lignes"] == sum(before.values())

    # Après la sauvegarde, V002 est retirée (l'API laisse sa trace dans le stockage)…
    audio.put("retraits/dje/V002.json", json.dumps({
        "langue": "dje", "numero": "V002", "date": "2026-11-03T15:00:00Z", "par": ADMIN,
        "cles_identites": [],
    }).encode())
    # … puis catastrophe : la base est perdue (ici : effacée, migrations rejouées).
    reset_database()
    assert sql("select count(*) from public.speakers") == "0"

    report = restore.run_restore(dest, key, DB_URL, live_audio=audio)
    assert report["voix_retirees_a_nouveau"] == ["V002"]
    after = json.loads(sql(backup.COUNT_QUERY))
    # Tout est revenu, sauf la voix retirée depuis la sauvegarde.
    assert after["public.speakers"] == before["public.speakers"] - 1
    assert after["prive.identities"] == before["prive.identities"] - 1
    assert after["public.team_members"] == before["public.team_members"]
    assert after["auth.users"] == before["auth.users"]
    assert sql("select full_name from prive.identities") == "Nom de V001"
    assert sql("select speaker_number from public.withdrawals") == "V002"
    assert sql("select validated_reads from public.sentences where code = 'S0001'") == "0"  # jamais incrémenté ici
    assert sql("select count(*) from public.audit_log where action = 'essai_sauvegarde'") == "1"
    assert sql("select count(*) from public.audit_log where action = 'retrait_reapplique'") == "1"
    # Une voix créée après la restauration reçoit bien un nouveau numéro (V003).
    assert sql("select public.next_speaker_number('dje')") == "V003"
