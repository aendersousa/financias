import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { parseBrlCents, assertCents } from '../../../shared/finance/money';

export interface CurrencyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'defaultValue'> {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onValueChange?: (cents: number, formatted: string) => void;
  allowNegative?: boolean;
  prefix?: string;
  wrapperClassName?: string;
}

export function parseCurrencyParts(input: string | number): { isNegative: boolean; integer: string; fraction: string } | null {
  const str = typeof input === 'number' ? input.toFixed(2).replace('.', ',') : String(input ?? '');
  let text = str.replace(/^R\$\s*/i, '').trim();
  if (!text) return null;

  const isNegative = text.startsWith('-');
  if (isNegative) text = text.slice(1);
  text = text.replace(/[^\d.,]/g, '');
  if (!text) return null;

  let intStr = '';
  let fracStr = '';

  if (text.includes(',')) {
    const [before, after = ''] = text.split(',');
    intStr = before.replace(/\./g, '');
    fracStr = after.slice(0, 2);
  } else if (text.includes('.')) {
    const parts = text.split('.');
    if (parts.length === 2 && parts[1].length <= 2) {
      intStr = parts[0];
      fracStr = parts[1].slice(0, 2);
    } else {
      intStr = text.replace(/\./g, '');
      fracStr = '';
    }
  } else {
    intStr = text;
    fracStr = '';
  }

  intStr = intStr.replace(/^0+(?=\d)/, '');
  if (!intStr) intStr = '0';
  fracStr = fracStr.padEnd(2, '0');

  return { isNegative, integer: intStr, fraction: fracStr };
}

export function cleanCurrencyInput(val: string, allowNegative = false): string {
  if (!val) return '';
  let text = val.replace(/^R\$\s*/i, '').trim();

  const isNegative = allowNegative && text.startsWith('-');
  if (isNegative) {
    text = text.slice(1);
  }

  // Allow only digits, comma and dot
  text = text.replace(/[^\d.,]/g, '');

  // Strip leading zeros before any other digit (e.g. "01870" -> "1870")
  text = text.replace(/^0+(?=\d)/, '');

  return (isNegative ? '-' : '') + text;
}

export function formatCurrencyString(input: string | number, allowNegative = false): string {
  if (input === '' || input === null || input === undefined) return '';
  const parts = parseCurrencyParts(input);
  if (!parts) return '';
  const { isNegative, integer, fraction } = parts;
  const formattedInt = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sign = isNegative && allowNegative && (integer !== '0' || fraction !== '00') ? '-' : '';
  return `${sign}${formattedInt},${fraction}`;
}

export function parseCurrencyToNumber(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  if (!input) return 0;
  const parts = parseCurrencyParts(String(input));
  if (!parts) return 0;
  const val = Number(`${parts.isNegative ? '-' : ''}${parts.integer}.${parts.fraction}`);
  return isNaN(val) ? 0 : val;
}

export function parseCurrencyToCents(input: string | number | null | undefined): number {
  if (typeof input === 'number') return Math.round(input * 100);
  if (!input) return 0;
  const formatted = formatCurrencyString(input, true);
  if (!formatted) return 0;
  try {
    return parseBrlCents(formatted);
  } catch {
    const num = parseCurrencyToNumber(input);
    return assertCents(Math.round(num * 100));
  }
}

export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(function CurrencyInput(
  {
    value,
    defaultValue,
    onChange,
    onValueChange,
    onBlur,
    onFocus,
    placeholder = '0,00',
    allowNegative = false,
    prefix = 'R$',
    className = '',
    wrapperClassName = '',
    disabled = false,
    required = false,
    ...rest
  },
  forwardedRef
) {
  const isControlled = value !== undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current!);

  const initialDisplay = () => {
    const raw = isControlled ? value : defaultValue;
    if (raw === undefined || raw === null || raw === '') return '';
    return typeof raw === 'number' ? formatCurrencyString(raw, allowNegative) : cleanCurrencyInput(String(raw), allowNegative);
  };

  const [displayValue, setDisplayValue] = useState<string>(initialDisplay);

  useEffect(() => {
    if (isControlled) {
      if (value === undefined || value === null || value === '') {
        setDisplayValue('');
      } else {
        const cleaned = typeof value === 'number' ? formatCurrencyString(value, allowNegative) : cleanCurrencyInput(String(value), allowNegative);
        setDisplayValue(cleaned);
      }
    }
  }, [value, isControlled, allowNegative]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = cleanCurrencyInput(e.target.value, allowNegative);
    if (!isControlled) {
      setDisplayValue(cleaned);
    }
    if (onChange) {
      // Pass synthetic event with the cleaned value
      e.target.value = cleaned;
      onChange(e);
    }
    if (onValueChange) {
      const cents = parseCurrencyToCents(cleaned);
      onValueChange(cents, cleaned);
    }
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    // If the value is 0 or 0,00, select all so typing immediately replaces it
    if (e.target.value === '0' || e.target.value === '0,00' || e.target.value === '0.00') {
      e.target.select();
    }
    if (onFocus) onFocus(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const current = e.target.value.trim();
    if (current) {
      const formatted = formatCurrencyString(current, allowNegative);
      if (formatted && formatted !== current) {
        if (!isControlled) {
          setDisplayValue(formatted);
        }
        e.target.value = formatted;
        if (onChange) {
          onChange(e);
        }
        if (onValueChange) {
          onValueChange(parseCurrencyToCents(formatted), formatted);
        }
      }
    }
    if (onBlur) onBlur(e);
  };

  return (
    <div className={`relative flex items-center ${wrapperClassName}`}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 select-none text-xs font-semibold text-slate-400 dark:text-slate-500"
      >
        {prefix}
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={isControlled ? displayValue : undefined}
        defaultValue={!isControlled ? displayValue : undefined}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={`field-input w-full !pl-9 ${className}`}
        {...rest}
      />
    </div>
  );
});

export default CurrencyInput;

