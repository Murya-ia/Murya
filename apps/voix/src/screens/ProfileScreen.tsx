// Fiche de la voix (spec §3.3) : sexe, âge, région, langue maternelle, téléphone.

import { useEffect, useState, type FormEvent } from 'react';
import { Logo } from '@murya/commun/logo';
import type { Api } from '../data/api';
import { useT, type TextKey } from '../i18n/i18n';
import { ErrorMessage } from '../ui/ErrorMessage';

const GENDERS = ['femme', 'homme', 'non_precise'] as const;
const AGES = ['18-25', '26-40', '41-60', '60+'] as const;
const REGIONS = [
  'agadez',
  'diffa',
  'dosso',
  'maradi',
  'niamey',
  'tahoua',
  'tillaberi',
  'zinder',
  'autre_pays',
] as const;
const LANGUAGES = [
  'zarma',
  'haoussa',
  'peul',
  'tamasheq',
  'kanouri',
  'gourmantche',
  'toubou',
  'arabe',
  'francais',
  'autre',
] as const;

/** Chrome sur Android peut donner le modèle du téléphone ; Safari ne le donne pas. */
async function detectPhoneModel(): Promise<string> {
  const data = (
    navigator as Navigator & {
      userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ model?: string }> };
    }
  ).userAgentData;
  try {
    return (await data?.getHighEntropyValues(['model']))?.model ?? '';
  } catch {
    return '';
  }
}

export function ProfileScreen({ api, onDone }: { api: Api; onDone: () => void }) {
  const t = useT();
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [region, setRegion] = useState('');
  const [motherTongue, setMotherTongue] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void detectPhoneModel().then((model) => setPhone((current) => current || model));
  }, []);

  const complete = gender && age && region && motherTongue;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/voix/fiche', {
        sexe: gender,
        tranche_age: age,
        region,
        langue_maternelle: motherTongue,
        telephone: phone.trim() || undefined,
      });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Logo size={36} />
      <h1>{t('fiche.titre')}</h1>
      <p>{t('fiche.intro')}</p>
      <form className="formulaire" onSubmit={(e) => void submit(e)}>
        <fieldset className="choix-boutons">
          <legend>{t('fiche.sexe')}</legend>
          {GENDERS.map((g) => (
            <label key={g} className={gender === g ? 'choisi' : ''}>
              <input
                type="radio"
                name="sexe"
                checked={gender === g}
                onChange={() => setGender(g)}
              />
              {t(`fiche.sexe.${g}` as TextKey)}
            </label>
          ))}
        </fieldset>

        <fieldset className="choix-boutons">
          <legend>{t('fiche.age')}</legend>
          {AGES.map((a) => (
            <label key={a} className={age === a ? 'choisi' : ''}>
              <input type="radio" name="age" checked={age === a} onChange={() => setAge(a)} />
              {t(`fiche.age.${a}` as TextKey)}
            </label>
          ))}
        </fieldset>

        <div>
          <label htmlFor="region">{t('fiche.region')}</label>
          <select id="region" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{t('fiche.choisir')}</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {t(`region.${r}` as TextKey)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="langue">{t('fiche.langue_maternelle')}</label>
          <select
            id="langue"
            value={motherTongue}
            onChange={(e) => setMotherTongue(e.target.value)}
          >
            <option value="">{t('fiche.choisir')}</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(`langues.${l}` as TextKey)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="telephone">{t('fiche.telephone')}</label>
          <input
            id="telephone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={100}
          />
        </div>

        <ErrorMessage error={error} />
        <button type="submit" disabled={!complete || busy}>
          {t('fiche.enregistrer')}
        </button>
      </form>
    </main>
  );
}
