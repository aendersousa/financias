/** BRL inputs are parsed as text; ledger amounts are always integer cents. */
export function assertCents(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError('Valor fora do intervalo de centavos inteiros.');
  return value;
}

export function parseBrlCents(input: string): number {
  const text = input.trim().replace(/^R\$\s*/, '');
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) {
    throw new Error('Informe um valor como 1.234,56.');
  }
  const negative = text.startsWith('-');
  const [integer, fraction = ''] = text.replace(/^-/, '').replaceAll('.', '').split(',');
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
  return assertCents(Number(negative ? -cents : cents));
}

export function formatBrlCents(value: number): string {
  assertCents(value);
  const cents = BigInt(value);
  const absolute = cents < 0n ? -cents : cents;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0n ? '-' : ''}R$ ${whole},${(absolute % 100n).toString().padStart(2, '0')}`;
}

/** Section 8.8: largest remainder, with explicit deterministic tie order. */
export function allocateCents(total: number, weights: readonly number[], tieOrder = weights.map((_, index) => index)): number[] {
  assertCents(total);
  if (weights.length === 0 || tieOrder.length !== weights.length || new Set(tieOrder).size !== weights.length || tieOrder.some((index) => !Number.isInteger(index) || index < 0 || index >= weights.length)) {
    throw new RangeError('Ordem de desempate inválida.');
  }
  const exactWeights = weights.map((weight) => BigInt(assertCents(weight)));
  const weightTotal = exactWeights.reduce((sum, weight) => sum + weight, 0n);
  if (weightTotal <= 0n) throw new RangeError('A soma dos pesos deve ser positiva.');
  const absolute = BigInt(total < 0 ? -total : total);
  const rows = exactWeights.map((weight, index) => {
    const product = absolute * weight;
    const quotient = product / weightTotal;
    const modulo = product % weightTotal;
    return { index, base: modulo < 0n ? quotient - 1n : quotient, remainder: modulo < 0n ? modulo + weightTotal : modulo };
  });
  const remaining = Number(absolute - rows.reduce((sum, row) => sum + row.base, 0n));
  const ranks = new Map(tieOrder.map((index, rank) => [index, rank]));
  const ordered = rows.filter((row) => exactWeights[row.index] !== 0n).sort((a, b) => a.remainder === b.remainder ? ranks.get(a.index)! - ranks.get(b.index)! : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index++) ordered[index].base += 1n;
  return rows.map((row) => assertCents(Number(row.base * (total < 0 ? -1n : 1n))));
}

/** D-006: the configured installment wins equal-remainder ties. */
export function splitInstallments(total: number, count: number, remainder: 'first' | 'last' = 'first'): number[] {
  assertCents(total);
  if (!Number.isSafeInteger(count) || count < 1 || count > 32767 || total < count) {
    throw new RangeError('As parcelas devem ser positivas e ter pelo menos um centavo.');
  }
  const order = Array.from({ length: count }, (_, index) => index);
  return allocateCents(total, Array<number>(count).fill(1), remainder === 'first' ? order : order.reverse());
}

/** Equal sharing: distribute remaining cents in participant order. */
export function divideCents(total: number, count: number): number[] {
  assertCents(total);
  if (!Number.isSafeInteger(count) || count < 1 || count > 32767) throw new RangeError('Quantidade inválida.');
  return allocateCents(total, Array<number>(count).fill(1));
}

export function sumCents(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + BigInt(assertCents(value)), 0n);
  return assertCents(Number(total));
}
