-- Essai de charge : efface les voix d'essai et tout ce qu'elles ont produit (audios en base,
-- vérifications en attente, invitations). Les fichiers dans R2 (dossier « zz/ ») sont
-- supprimés automatiquement après un jour (règle de cycle de vie du bucket).
-- La langue « zz », son accord et ses phrases restent, inactifs, pour le prochain essai.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f nettoyer.sql

begin;

delete from public.jobs j
where j.kind = 'verifier_audio'
  and exists (
    select 1 from public.recordings r join public.speakers s on s.id = r.speaker_id
    where s.language_code = 'zz' and r.id::text = j.payload->>'recording_id');

-- En cascade : identités, accords, lots, audios et leurs vérifications.
delete from public.speakers where language_code = 'zz';
delete from public.invites where language_code = 'zz';
update public.sentences set pending_reads = 0, validated_reads = 0 where language_code = 'zz';

commit;

select
  (select count(*) from public.speakers where language_code = 'zz') as voix_restantes,
  (select count(*) from public.jobs j where j.kind = 'verifier_audio' and j.status = 'en_attente'
     and not exists (select 1 from public.recordings r where r.id::text = j.payload->>'recording_id'))
    as verifications_orphelines;
