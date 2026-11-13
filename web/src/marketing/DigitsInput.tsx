// A field that takes digits only (2026-11-13 — the registration number and the phone): whatever is
// typed or pasted, only the digits stay (full-width ones too), capped at `max`, and `format` puts
// the hyphens in as they are typed. An IME (Korean, Chinese) composes on its own: while it is
// composing the text is left alone, and it is cleaned when the composition ends. The caret stays
// after the same digit when a hyphen comes or goes. The value the form keeps is the digits.
import { forwardRef, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { digitsOf } from '../../../marketing/scripts/lib/company-no.mjs';

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'inputMode' | 'maxLength'>;

export interface DigitsInputProps extends Native {
  /** the digits */
  value: string;
  onDigits: (digits: string) => void;
  /** how the digits are shown (hyphens) */
  format: (digits: string) => string;
  max: number;
}

/** How many digits come before `caret` in `text`. */
const digitsBefore = (text: string, caret: number) => digitsOf(text.slice(0, caret)).length;

/** The place in `shown` just after its `n`th digit. */
function caretAfter(shown: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < shown.length; i++) {
    if (/\d/.test(shown[i]) && ++seen === n) return i + 1;
  }
  return shown.length;
}

export const DigitsInput = forwardRef<HTMLInputElement, DigitsInputProps>(function DigitsInput({ value, onDigits, format, max, onCompositionStart, onCompositionEnd, ...rest }, outer) {
  const own = useRef<HTMLInputElement | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const caret = useRef<number | null>(null);
  const shown = composing ?? format(value);

  useLayoutEffect(() => {
    const el = own.current;
    if (caret.current === null || !el || document.activeElement !== el) return;
    const at = caretAfter(el.value, caret.current);
    el.setSelectionRange(at, at);
    caret.current = null;
  });

  const take = (text: string, at: number | null) => {
    const digits = digitsOf(text).slice(0, max);
    caret.current = at === null ? null : Math.min(digitsBefore(text, at), digits.length);
    onDigits(digits);
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
      inputMode="numeric"
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
