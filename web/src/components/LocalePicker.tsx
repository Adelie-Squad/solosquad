import { LOCALE_NAMES, LOCALES, useI18n, type Locale } from '../i18n';

/** Language switch for screens before login (this device only). No visible label — each
 * language is named in itself, so the select says what it is; the name stays for screen readers. */
export function LocalePicker() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="locale-picker is-bare">
      <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t('settings.language')}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
