import { useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { formatDisplayedCurrency } from './privacy';

export function useCurrencyFormatter() {
  const hidden = useAppStore((state) => state.privacyMode);
  return useCallback((value: number) => formatDisplayedCurrency(value, hidden), [hidden]);
}
