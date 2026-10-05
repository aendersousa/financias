import { formatCurrency } from './format';

export const HIDDEN_CURRENCY = 'R$ ••••';

export function formatDisplayedCurrency(value: number, hidden: boolean): string {
  return hidden ? HIDDEN_CURRENCY : formatCurrency(value);
}

export function readPrivacyMode(): boolean {
  try { return localStorage.getItem('financias:privacy') === 'hidden'; }
  catch { return false; }
}

export function persistPrivacyMode(hidden: boolean): void {
  try { localStorage.setItem('financias:privacy', hidden ? 'hidden' : 'visible'); }
  catch { /* Privacy still works when the browser disables persistent storage. */ }
}
