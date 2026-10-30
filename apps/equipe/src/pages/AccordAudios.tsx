// Audios de l'accord (spec §3.2), pour les admins : l'accord lu à voix haute par l'équipe, dans
// la langue de travail et en français, que les personnes qui lisent peu écoutent dans l'appli. On peut les
// ajouter ou les remplacer à tout moment, sans changer le texte publié de l'accord.

import { useCallback, useEffect, useState } from 'react';
import { consentAudioUrl, sendConsentAudio } from '../lib/api';
import { errorText, useTeam } from '../lib/team';
import type { Language } from '../supabase';

/** Les quatre audios : accord complet et rappel court, dans la langue et en français. */
function slots(langue: Language) {
  const name = langue.name_fr.toLowerCase();
  return [
    { language: langue.code, kind: 'complet', label: `Accord complet, en ${name}` },
    { language: 'fr', kind: 'complet', label: 'Accord complet, en français' },
    { language: langue.code, kind: 'rappel', label: `Rappel court, en ${name}` },
    { language: 'fr', kind: 'rappel', label: 'Rappel court, en français' },
  ];
}

interface Stored {
  ui_language: string;
  kind: string;
  uploaded_at: string;
}

export function AccordAudios() {
  const { client, session, langue } = useTeam();
  const [version, setVersion] = useState<{ id: number; version: number } | null>(null);
  const [stored, setStored] = useState<Stored[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [listening, setListening] = useState<{ slot: string; url: string } | null>(null);

  const load = useCallback(async () => {
    const { data } = await client
      .from('consent_versions')
      .select('id, version')
      .eq('language_code', langue.code)
      .not('published_at', 'is', null)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: number; version: number }>();
    setVersion(data ?? null);
    if (data) {
      const audios = await client
        .from('consent_audios')
        .select('ui_language, kind, uploaded_at')
        .eq('consent_version_id', data.id);
      setStored((audios.data as Stored[]) ?? []);
    }
  }, [client, langue.code]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!version) return null;

  async function upload(language: string, kind: string, file: File | undefined) {
    if (!file || !version) return;
    const slot = `${language}-${kind}`;
    setBusy(slot);
    setMessage(null);
    const form = new FormData();
    form.set('version_id', String(version.id));
    form.set('langue', language);
    form.set('type', kind);
    form.set('fichier', file);
    try {
      await sendConsentAudio(session, form);
      setMessage({ ok: true, text: 'Audio enregistré : les voix l’entendent dès maintenant.' });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: errorText(e as Error) });
    }
    setBusy(null);
  }

  async function listen(language: string, kind: string) {
    if (!version) return;
    try {
      const url = await consentAudioUrl(session, version.id, language, kind);
      setListening({ slot: `${language}-${kind}`, url });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e as Error) });
    }
  }

  return (
    <section className="carte">
      <div className="titre-ligne">
        <h2>Audios de l’accord</h2>
        <span className="etape">version {version.version}</span>
      </div>
      <p className="aide">
        Pour les personnes qui lisent peu : quelqu’un de l’équipe lit l’accord à voix haute,
        s’enregistre avec son téléphone, et envoie le fichier ici. Dans l’appli, un bouton « Écouter
        » le fait entendre.
      </p>
      {message && <p className={`message ${message.ok ? 'succes' : 'erreur'}`}>{message.text}</p>}
      <ul className="liste-audios-accord">
        {slots(langue).map(({ language, kind, label }) => {
          const slot = `${language}-${kind}`;
          const current = stored.find((s) => s.ui_language === language && s.kind === kind);
          return (
            <li key={slot}>
              <div>
                <strong>{label}</strong>
                <p className="aide">
                  {current
                    ? `Envoyé le ${new Date(current.uploaded_at).toLocaleDateString('fr-FR')}`
                    : 'Pas encore enregistré'}
                </p>
                {listening?.slot === slot && (
                  <audio controls autoPlay src={listening.url} className="audio-accord" />
                )}
              </div>
              <div className="actions">
                {current && (
                  <button className="petit secondaire" onClick={() => void listen(language, kind)}>
                    Écouter
                  </button>
                )}
                <label className="bouton-fichier">
                  {busy === slot ? 'Envoi…' : current ? 'Remplacer' : 'Envoyer un audio'}
                  <input
                    type="file"
                    accept="audio/*"
                    disabled={busy !== null}
                    onChange={(e) => void upload(language, kind, e.target.files?.[0])}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
