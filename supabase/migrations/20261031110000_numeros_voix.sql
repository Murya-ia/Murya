-- Numéros de voix au-delà de V999. `lpad(…, 3, '0')` COUPE un texte plus long que 3 : la voix
-- n° 1000 recevait « V100 », déjà pris, et ne pouvait pas s'inscrire. On garde au moins trois
-- chiffres (V001…V999), puis V1000, V1001…
create or replace function public.next_speaker_number(p_language text) returns text
language sql volatile set search_path = '' as $$
  update public.languages set speaker_seq = speaker_seq + 1 where code = p_language
  returning 'V' || case when speaker_seq < 1000 then lpad(speaker_seq::text, 3, '0')
                        else speaker_seq::text end;
$$;
