// A field that takes digits only (2026-11-13 — the registration number and the phone): whatever is
// typed or pasted, only the digits stay (full-width ones too), capped at `max`, and `format` puts
// the hyphens in as they are typed. With `letters` (2026-11-14 — China's 统一社会信用代码, another
// country's number) upper-case letters stay too: what is typed is upper-cased, spaces and hyphens
// drop out. An IME (Korean, Chinese) composes on its own: while it is composing the text is left
// alone, and it is cleaned when the composition ends. The caret stays after the same character when
// a hyphen comes or goes. The value the form keeps is the cleaned characters.
import { forwardRef, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { codeOf, digitsOf } from '../../../marketing/scripts/lib/company-no.mjs';

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'maxLength'>;

export interface DigitsInputProps extends Native {
  /** the digits (and, with `letters`, upper-case letters) */
  value: string;
  onDigits: (digits: string) => void;
  /** how the value is shown (hyphens) */
  format: (digits: string) => string;
  max: number;
  /** letters too (upper-cased) */
  letters?: boolean;
}

/** The place in `shown` just after its `n`th kept character. */
function caretAfter(shown: string, n: number, kept: RegExp): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < shown.length; i++) {
    if (kept.test(shown[i]) && ++seen === n) return i + 1;
  }
  return shown.length;
}

export const DigitsInput = forwardRef<HTMLInputElement, DigitsInputProps>(function DigitsInput({ value, onDigits, format, max, letters = false, onCompositionStart, onCompositionEnd, ...rest }, outer) {
  const own = useRef<HTMLInputElement | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const caret = useRef<number | null>(null);
  const shown = composing ?? format(value);
  const clean = letters ? codeOf : digitsOf;
  const kept = letters ? /[0-9A-Z]/ : /\d/;

  useLayoutEffect(() => {
    const el = own.current;
    if (caret.current === null || !el || document.activeElement !== el) return;
    const at = caretAfter(el.value, caret.current, kept);
    el.setSelectionRange(at, at);
    caret.current = null;
  });

  const take = (text: string, at: number | null) => {
    const chars = clean(text).slice(0, max);
    caret.current = at === null ? null : Math.min(clean(text.slice(0, at)).length, chars.length);
    onDigits(chars);
  };

  return (
    <input
      {...rest}
      ref={(el) => {
        own.current = el;
        if (typeof outer === 'function') outer(el);
        else if (outer) outer.current = el;
      }}
      type="text"
      inputMode={letters ? 'text' : 'numeric'}
      autoCapitalize={letters ? 'characters' : rest.autoCapitalize}
      autoComplete={rest.autoComplete ?? 'off'}
      spellCheck={false}
      value={shown}
      onCompositionStart={(e) => {
        setComposing(e.currentTarget.value);
        onCompositionStart?.(e);
      }}
      onCompositionEnd={(e) => {
        setComposing(null);
        take(e.currentTarget.value, e.currentTarget.selectionStart);
        onCompositionEnd?.(e);
      }}
      onChange={(e) => {
        if (composing !== null || (e.nativeEvent as InputEvent).isComposing) {
          setComposing(e.target.value);
          return;
        }
        take(e.target.value, e.target.selectionStart);
      }}
    />
  );
});
