import { LOCALE_NAMES, LOCALES, useI18n, type Locale } from '../i18n';

/** Language switch for screens before login (this device only). */
export function LocalePicker() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="locale-picker">
      <span>{t('settings.language')}</span>
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
