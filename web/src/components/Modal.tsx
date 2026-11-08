// The entity modal frame (DESIGN.md `## 컴포넌트` — 에이전트 · 사람 모달): a dialog over the
// scrim, the close button focused first, closed by Esc, the close button or a press outside, and
// focus handed back to whatever opened it. The agent and person modals and the landing's team
// modal all use it.
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';
import { ICON } from '../icons';

export function Modal({ label, onClose, className = '', children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const { t } = useI18n();
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const dialog = useRef<HTMLDivElement>(null);
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
      <div className={`dialog is-wide entity-modal ${className}`.trim()} ref={dialog} role="dialog" aria-modal="true" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn entity-modal-close" aria-label={t('common.close')} title={t('common.close')} onClick={onClose} autoFocus>
          <ICON.close size={18} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
