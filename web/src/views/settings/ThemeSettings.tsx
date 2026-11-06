import { useI18n, type MessageKey } from '../../i18n';
import { ICON, type LucideIcon } from '../../icons';
import { useTheme, type ThemePref } from '../../theme';

const CHOICES: { id: ThemePref; label: MessageKey; icon: LucideIcon }[] = [
  { id: 'system', label: 'theme.system', icon: ICON.system },
  { id: 'light', label: 'theme.light', icon: ICON.light },
  { id: 'dark', label: 'theme.dark', icon: ICON.dark },
];

/** Settings › Display: system · light · dark, applied at once and kept on this device. */
export function ThemeSettings() {
  const { t } = useI18n();
  const { pref, theme, setPref } = useTheme();
  return (
    <section className="panel settings-body">
      <div className="field">
        <span>{t('theme.title')}</span>
        <div className="segmented" role="radiogroup" aria-label={t('theme.title')}>
          {CHOICES.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={pref === c.id}
              className={`with-icon ${pref === c.id ? 'is-active' : ''}`}
              onClick={() => setPref(c.id)}
              data-testid={`theme-${c.id}`}
            >
              <c.icon />
              {t(c.label)}
            </button>
          ))}
        </div>
        <small className="dash-hint">
          {pref === 'system' ? t('theme.followingSystem', { now: t(theme === 'dark' ? 'theme.dark' : 'theme.light') }) : t('theme.deviceOnly')}
        </small>
      </div>
    </section>
  );
}
