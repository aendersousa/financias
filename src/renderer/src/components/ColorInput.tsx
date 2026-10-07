import { useEffect, useRef, useState } from 'react';
import { Clipboard, Check } from 'lucide-react';

export function parseColorToHex(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  // 1. Hex: #820ad1, #820, 820ad1, 820
  const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    return `#${hex.toLowerCase()}`;
  }

  // 2. rgb(...) or rgba(...)
  const rgbFuncMatch = trimmed.match(/rgba?\s*\(\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})/i);
  if (rgbFuncMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbFuncMatch[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(rgbFuncMatch[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(rgbFuncMatch[3], 10)));
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  }

  // 3. Labeled formats like r: 130, g: 10, b: 209 or R=130 G=10 B=209
  const labeledRgbMatch = trimmed.match(/r[=:\s]*(\d{1,3})\s*[,;]?\s*g[=:\s]*(\d{1,3})\s*[,;]?\s*b[=:\s]*(\d{1,3})/i);
  if (labeledRgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(labeledRgbMatch[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(labeledRgbMatch[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(labeledRgbMatch[3], 10)));
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  }

  // 4. Raw numbers like "130, 10, 209" or "130 10 209" or "130,10,209"
  const rawRgbMatch = trimmed.match(/(\d{1,3})\s*[\s,]\s*(\d{1,3})\s*[\s,]\s*(\d{1,3})/);
  if (rawRgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rawRgbMatch[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(rawRgbMatch[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(rawRgbMatch[3], 10)));
    return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
  }

  return null;
}

export function hexToRgbString(hex: string): string {
  const match = hex.replace('#', '').match(/^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!match) return '';
  const r = parseInt(match[1], 16);
  const g = parseInt(match[2], 16);
  const b = parseInt(match[3], 16);
  return `${r}, ${g}, ${b}`;
}

export interface ColorInputProps {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (colorHex: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function ColorInput({
  id,
  name,
  value,
  defaultValue = '#0ea5e9',
  onChange,
  disabled = false,
  className = ''
}: ColorInputProps) {
  const initial = value ?? defaultValue;
  const [currentColor, setCurrentColor] = useState(initial);
  const [textValue, setTextValue] = useState(() => hexToRgbString(initial));
  const [justPasted, setJustPasted] = useState(false);
  const colorPickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value !== undefined && value !== currentColor) {
      setCurrentColor(value);
      setTextValue(hexToRgbString(value));
    }
  }, [value]);

  const updateColor = (newHex: string) => {
    setCurrentColor(newHex);
    setTextValue(hexToRgbString(newHex));
    onChange?.(newHex);
  };

  const handleTextChange = (raw: string) => {
    setTextValue(raw);
    const parsedHex = parseColorToHex(raw);
    if (parsedHex) {
      setCurrentColor(parsedHex);
      onChange?.(parsedHex);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    const parsedHex = parseColorToHex(pasted);
    if (parsedHex) {
      e.preventDefault();
      updateColor(parsedHex);
      setJustPasted(true);
      setTimeout(() => setJustPasted(false), 1500);
    }
  };

  const handleQuickPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsedHex = parseColorToHex(text);
      if (parsedHex) {
        updateColor(parsedHex);
        setJustPasted(true);
        setTimeout(() => setJustPasted(false), 1500);
      }
    } catch {
      colorPickerRef.current?.focus();
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        {/* Color picker circle/swatch */}
        <div className="relative shrink-0">
          <input
            ref={colorPickerRef}
            id={id}
            type="color"
            disabled={disabled}
            value={currentColor}
            onChange={(e) => updateColor(e.target.value)}
            className="h-9 w-10 cursor-pointer rounded-lg border border-slate-300 p-0.5 dark:border-slate-700 bg-white dark:bg-slate-800"
            title="Escolher cor visualmente"
          />
        </div>

        {/* Text input to paste RGB or HEX all at once */}
        <div className="relative flex-1 sm:w-44">
          <input
            type="text"
            disabled={disabled}
            value={textValue}
            onChange={(e) => handleTextChange(e.target.value)}
            onPaste={handlePaste}
            onBlur={() => {
              setTextValue(hexToRgbString(currentColor));
            }}
            placeholder="Ex: 130, 10, 209"
            className="field-input w-full py-1.5 pl-2.5 pr-8 text-xs font-mono"
            title="Cole o RGB (ex: 130, 10, 209) ou código HEX"
          />

          {/* Quick paste button inside the text input */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => void handleQuickPaste()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            title="Colar da área de transferência"
          >
            {justPasted ? <Check size={14} className="text-emerald-500" /> : <Clipboard size={14} />}
          </button>
        </div>

        {/* Format pill showing HEX */}
        <span className="hidden sm:inline-block rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {currentColor.toUpperCase()}
        </span>

        {/* Hidden input for standard form submissions */}
        {name && <input type="hidden" name={name} value={currentColor} />}
      </div>
      <span className="text-[10px] text-slate-400 dark:text-slate-500">
        Cole o RGB (ex: <strong>130, 10, 209</strong>) ou HEX
      </span>
    </div>
  );
}
