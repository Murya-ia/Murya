-- Lien direct audio → phrase. Jusqu'ici un audio ne pointait que vers la VERSION de la phrase
-- lue (sentence_versions) ; PostgREST ne pouvait donc pas joindre `recordings` et `sentences`,
-- et l'écoute du test d'une voix (page Voix) échouait avec l'erreur PGRST200.
-- Toutes les lignes existantes respectent déjà ce lien (la version pointe vers la phrase).
alter table public.recordings
  add constraint recordings_sentence_id_fkey
  foreign key (sentence_id) references public.sentences(id);
