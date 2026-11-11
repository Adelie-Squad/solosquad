import { LOCALE_NAMES, LOCALES, useI18n, type Locale } from '../i18n';

/** Language switch for screens before login (this device only). `bare` = no visible label (the
 * landing's top bar — each language is named in itself, so the select says what it is). */
export function LocalePicker({ bare = false }: { bare?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`locale-picker ${bare ? 'is-bare' : ''}`.trim()}>
      {!bare && <span>{t('settings.language')}</span>}
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={bare ? t('settings.language') : undefined}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
