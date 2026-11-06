import { errorText } from '../api/errors';
import { useI18n } from '../i18n';
import { ICON } from '../icons';

export function Loading() {
  const { t } = useI18n();
  return <div className="panel empty">{t('common.loading')}</div>;
}

/** What a failed request means to a person, by its code (decision 57): outside the
 * assignments or gone = "no such page" (`not_found` — the server answers both the same), a
 * workspace whose runtime is down = "not started yet", a network the office does not accept
 * = the network notice. */
export function QueryError({ error }: { error: unknown }) {
  const { t } = useI18n();
  return (
    <div className="panel empty" role="alert">
      {errorText(error, t)}
    </div>
  );
}

/** "Saved." after a form — the check carries the colour, the word carries the meaning. */
export function SavedLine({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <p className="ok-line with-icon" role="status">
      <ICON.done />
      {text ?? t('common.saved')}
    </p>
  );
}

/** A widget or screen this web cannot draw — visible, never a crash (I30 · K35). */
export function Placeholder({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="panel placeholder" data-testid="placeholder">
      <strong className="with-icon">
        <ICON.warn />
        {title}
      </strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}
