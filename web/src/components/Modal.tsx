// The modal frame (DESIGN.md `## 컴포넌트` — 에이전트 · 구성원 모달 · 구성원 추가): a dialog over the
// scrim, the close button focused first (or, for a form, its first field), Tab kept inside,
// closed by Esc, the close button or a press outside, and focus handed back to whatever opened
// it. The agent and member modals, the add-member form and the landing's team modal use it.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { useScrollLock } from './scrollLock';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab wrap around inside `node` — the page behind cannot take focus. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault: () => void }, node: HTMLElement | null) {
  if (e.key !== 'Tab' || !node) return;
  const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const at = document.activeElement;
  if (e.shiftKey && (at === first || !node.contains(at))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (at === last || !node.contains(at))) {
    e.preventDefault();
    first.focus();
  }
}

export function Modal({
  label,
  onClose,
  className = '',
  focusFirstField = false,
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  /** A form: focus its first field instead of the close button. */
  focusFirstField?: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  useScrollLock();
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusFirstField) return;
    dialog.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, [focusFirstField]);
  useEffect(() => {
    const back = opener.current;
    const node = dialog.current;
    return () => {
      // only on a real close: StrictMode's trial unmount leaves the dialog in place
      setTimeout(() => {
        if (node?.isConnected) return;
        if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
      }, 0);
    };
  }, []);
  // portalled to <body>: a transformed ancestor (the landing's slides) would otherwise pin the
  // fixed overlay to itself instead of the viewport
  return createPortal(
    <div className="command-overlay is-modal" onMouseDown={onClose}>
      <div
        className={`dialog is-wide entity-modal ${className}`.trim()}
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, dialog.current)}
      >
        <button type="button" className="icon-btn entity-modal-close" aria-label={t('common.close')} title={t('common.close')} onClick={onClose} autoFocus={!focusFirstField}>
          <ICON.close size={18} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
