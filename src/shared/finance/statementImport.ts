import { parseBrlCents, assertCents } from './money';
import { shiftDays, todayInSpace } from './calendar';

export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024;
export const STATEMENT_MAX_ROWS = 10_000;
export type StatementRowStatus = 'posted' | 'pending' | 'informational' | 'invalid';
export type CsvColumn = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'externalId' | 'balance' | 'status' | 'installment' | 'originalCurrency' | 'originalAmount' | 'documentNumber';
export interface StatementCsvProfile {
  encoding?: 'auto' | 'utf-8' | 'windows-1252' | 'iso-8859-1';
  delimiter?: 'auto' | ';' | ',' | '\t';
  header?: boolean;
  inverseSigns?: boolean;
  decimalSeparator?: 'auto' | ',' | '.';
  columns: Partial<Record<CsvColumn, number>>;
}
export interface StatementImportRow {
  lineNumber: number; postedOn: string | null; amountCents: number | null; description: string;
  externalId?: string; documentNumber?: string; status: StatementRowStatus; error?: string;
  installmentNumber?: number; installmentCount?: number; originalCurrency?: string; originalAmountCents?: number;
}
export interface StatementImportPayload {
  format: 'csv' | 'ofx'; accountType: 'bank' | 'card'; fileName: string; fileSha256: string; fileBytesBase64: string;
  /** Transient RPC input: the server stores only HMAC + final digits. Do not cache this object. */
  externalAccountIdentity?: string; externalInstitution?: string; otherAccountReason?: string;
  periodStart: string | null; periodEnd: string | null; generatedOn: string;
  statementBalanceCents?: number; balanceOn?: string; profile?: StatementCsvProfile;
  rows: StatementImportRow[];
}
export interface CsvStatementPreview { encoding: string; delimiter: ';' | ',' | '\t'; headers: string[]; sample: string[][]; suggestedColumns: Partial<Record<CsvColumn, number>> }
export interface StatementParseOptions { fileName: string; timeZone?: string; generatedOn?: string; profile?: StatementCsvProfile; inverseSigns?: boolean }
type NormalizedStatement = Pick<StatementImportPayload, 'accountType' | 'periodStart' | 'periodEnd' | 'generatedOn' | 'rows' | 'externalAccountIdentity' | 'externalInstitution' | 'statementBalanceCents' | 'balanceOn'>;

export function normalizeStatementDescription(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/(?:^|\s)(?:PIX\s+|PAG\*\s*|COMPRA CARTAO\s+)/g, ' ').replace(/\d{6,}|[^A-Z0-9]+/g, ' ').trim();
}

/** Normalize separator text, then use the same integer-only money parser as manual entry. */
export function parseStatementCents(value: string, decimal: 'auto' | ',' | '.' = 'auto'): number {
  let text = value.trim().replace(/^(?:R\$|BRL|\$)\s*/i, '').replace(/\s/g, '');
  if (/^\(.+\)$/.test(text)) text = `-${text.slice(1, -1)}`;
  text = text.replace(/^\+/, '');
  const minus = text.startsWith('-') ? '-' : ''; text = text.replace(/^-/, '');
  if (!/^[\d.,]+$/.test(text)) throw new Error('Valor ilegível.');
  let separator = decimal;
  if (separator === 'auto') {
    if (text.includes(',') && text.includes('.')) separator = text.lastIndexOf(',') > text.lastIndexOf('.') ? ',' : '.';
    else if (text.includes(',')) separator = /^\d{1,3}(?:,\d{3})+$/.test(text) && !text.startsWith('0,') ? '.' : ',';
    else if (/^\d{1,3}(?:\.\d{3})+$/.test(text) && !text.startsWith('0.')) separator = ',';
    else separator = '.';
  }
  const thousands = separator === ',' ? '.' : ',';
  const pieces = text.split(separator);
  if (pieces.length > 2 || (pieces.length === 2 && !/^\d{1,2}$/.test(pieces[1]))) throw new Error('Valor precisa ter no máximo duas casas decimais.');
  const whole = pieces[0];
  if (whole.includes(thousands) && !(new RegExp(`^\\d{1,3}(?:\\${thousands}\\d{3})+$`)).test(whole)) throw new Error('Separador de milhar inválido.');
  const normalized = `${minus}${whole.split(thousands).join('')}${pieces.length === 2 ? `,${pieces[1]}` : ''}`;
  return parseBrlCents(normalized);
}

function isoDay(value: string): string { shiftDays(value, 0); return value; }
export function parseStatementDate(value: string): string {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isoDay(text);
  const match = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(text);
  if (!match) throw new Error('Data ilegível.');
  const written = Number(match[3]), year = match[3].length === 2 ? written + (written < 70 ? 2000 : 1900) : written;
  return isoDay(`${year}-${match[2]}-${match[1]}`);
}
export function parseOfxDate(value: string, timeZone = 'America/Sao_Paulo'): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})?(\d{2})?)?(?:\.\d+)?(?:\[([+-]?\d+(?:\.\d+)?)(?::[^\]]*)?\])?$/.exec(value.trim());
  if (!match) throw new Error('Data OFX ilegível.');
  const day = isoDay(`${match[1]}-${match[2]}-${match[3]}`), hour = Number(match[4] ?? 0), minute = Number(match[5] ?? 0), second = Number(match[6] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) throw new Error('Horário OFX inválido.');
  if (match[7] === undefined) return day;
  const offset = Number(match[7]);
  if (!Number.isFinite(offset) || Math.abs(offset) > 14) throw new Error('Fuso OFX inválido.');
  const instant = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, second) - offset * 60 * 60 * 1000;
  return todayInSpace(timeZone, new Date(instant));
}
export function statementInstallment(value: string): { installmentNumber: number; installmentCount: number } | undefined {
  const match = /(?:PARC(?:ELA)?\s*)?(\d{1,3})\s*(?:\/|\s+DE\s+)\s*(\d{1,3})(?!\d|\s*\/)/i.exec(value);
  if (!match) return undefined;
  const number = Number(match[1]), count = Number(match[2]);
  return number > 0 && number <= count && count <= 999 ? { installmentNumber: number, installmentCount: count } : undefined;
}
function nonMovement(description: string): boolean { return /^(?:SALDO (?:ANTERIOR|INICIAL|FINAL|DO DIA|DISPONIVEL)|TOTAL (?:DA FATURA|DO EXTRATO)|CABECALHO)(?:\s|$)/.test(normalizeStatementDescription(description)); }
function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, entity => {
    const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
    const point = entity.slice(2, -1).toLowerCase().startsWith('x') ? Number.parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  });
}
function tag(text: string, name: string): string | undefined { return decodeEntities(new RegExp(`<${name}(?:\\s[^>]*)?>\\s*([^<]*)`, 'i').exec(text)?.[1]?.trim() ?? '') || undefined; }

export function parseOfxStatement(text: string, options: Omit<StatementParseOptions, 'fileName'> = {}): NormalizedStatement {
  if (!/<OFX(?:\s[^>]*)?>/i.test(text) || !/<(?:STMTRS|CCSTMTRS)(?:\s[^>]*)?>/i.test(text)) throw new Error('Arquivo OFX de conta ou cartão não reconhecido.');
  const timeZone = options.timeZone ?? 'America/Sao_Paulo';
  const accountType = /<CCSTMTRS(?:\s[^>]*)?>/i.test(text) ? 'card' : 'bank';
  if ((tag(text, 'CURDEF') ?? 'BRL').toUpperCase() !== 'BRL') throw new Error('A moeda do extrato precisa ser BRL.');
  const generatedOn = options.generatedOn ?? (tag(text, 'DTSERVER') ? parseOfxDate(tag(text, 'DTSERVER')!, timeZone) : todayInSpace(timeZone));
  const blocks = [...text.matchAll(/<STMTTRN(P)?(?:\s[^>]*)?>([\s\S]*?)(?:<\/STMTTRN(?:P)?>|(?=<STMTTRN(?:P)?(?:\s[^>]*)?>)|(?=<\/(?:BANKTRANLIST|BANKTRANLISTP|CCSTMTRS|STMTRS)>))/gi)];
  if (blocks.length > STATEMENT_MAX_ROWS) throw new Error('O extrato pode ter no máximo 10.000 linhas.');
  const rows = blocks.map((block, index): StatementImportRow => {
    const part = block[2], description = [tag(part, 'NAME'), tag(part, 'MEMO')].filter(Boolean).join(' · ') || 'Sem descrição';
    const base = { lineNumber: index + 1, description, externalId: tag(part, 'FITID'), documentNumber: tag(part, 'CHECKNUM') ?? tag(part, 'REFNUM'), ...statementInstallment(description) };
    if (nonMovement(description)) return { ...base, postedOn: null, amountCents: null, status: 'informational' };
    try {
      const postedOn = parseOfxDate(tag(part, 'DTPOSTED') ?? tag(part, 'DTTRAN') ?? '', timeZone);
      const parsed = parseStatementCents(tag(part, 'TRNAMT') ?? '', '.');
      const amountCents = assertCents(parsed * (options.inverseSigns ? -1 : 1));
      if (!amountCents) throw new Error('Movimento sem valor.');
      return { ...base, postedOn, amountCents, status: block[1] || /PEND|PROCESS/i.test(tag(part, 'STATUS') ?? tag(part, 'TRNTYPE') ?? '') || postedOn > generatedOn ? 'pending' : 'posted' };
    } catch (error) { return { ...base, postedOn: null, amountCents: null, status: 'invalid', error: error instanceof Error ? error.message : 'Linha ilegível.' }; }
  });
  const date = (name: string) => tag(text, name) ? parseOfxDate(tag(text, name)!, timeZone) : null;
  const balanceBlock = /<LEDGERBAL(?:\s[^>]*)?>([\s\S]*?)<\/LEDGERBAL>/i.exec(text)?.[1];
  const balanceOn = balanceBlock && tag(balanceBlock, 'DTASOF') ? parseOfxDate(tag(balanceBlock, 'DTASOF')!, timeZone) : undefined;
  const statementBalanceCents = balanceBlock && tag(balanceBlock, 'BALAMT') && balanceOn ? parseStatementCents(tag(balanceBlock, 'BALAMT')!, '.') : undefined;
  const posted = rows.flatMap(row => row.postedOn ? [row.postedOn] : []).sort();
  return { accountType, generatedOn, rows, externalAccountIdentity: tag(text, 'ACCTID'), externalInstitution: [tag(text, 'BANKID'), tag(text, 'ORG'), tag(text, 'FID')].filter(Boolean).join(' / ') || undefined,
    periodStart: date('DTSTART') ?? posted[0] ?? null, periodEnd: date('DTEND') ?? posted.at(-1) ?? null, balanceOn, statementBalanceCents };
}

function csvRecords(text: string, separator: string): string[][] {
  const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') { if (quoted && text[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted; }
    else if (!quoted && (char === separator || char === '\n' || char === '\r')) {
      row.push(cell); cell = '';
      if (char !== separator) { if (row.some(value => value.trim())) rows.push(row.splice(0)); else row.length = 0; if (char === '\r' && text[index + 1] === '\n') index++; }
    } else cell += char;
    if (rows.length > STATEMENT_MAX_ROWS + 1) throw new Error('O extrato pode ter no máximo 10.000 linhas.');
  }
  if (quoted) throw new Error('CSV com aspas sem fechamento.');
  row.push(cell); if (row.some(value => value.trim())) rows.push(row);
  return rows;
}
function detectedDelimiter(text: string): ';' | ',' | '\t' {
  const counts = { ';': 0, ',': 0, '\t': 0 }; let quoted = false;
  for (const char of text) { if (char === '"') quoted = !quoted; if (!quoted && (char === '\n' || char === '\r')) break; if (!quoted && char in counts) counts[char as keyof typeof counts]++; }
  return (Object.keys(counts) as (';' | ',' | '\t')[]).sort((a, b) => counts[b] - counts[a])[0];
}
function decodeStatement(bytes: Uint8Array, encoding: StatementCsvProfile['encoding'] = 'auto'): { text: string; encoding: string } {
  if (bytes.length === 0 || bytes.length > STATEMENT_MAX_BYTES) throw new Error('Selecione um arquivo de até 10 MB.');
  if (encoding !== 'auto') return { text: new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, ''), encoding };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''), encoding: 'utf-8' }; }
  catch { return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }; }
}
const columnAliases: Record<CsvColumn, RegExp> = {
  date: /^(?:DATA|DATE|DTPOSTED|DATA LANCAMENTO)$/, description: /^(?:DESCRICAO|DESCRIPTION|HISTORICO|MEMO|NOME)$/, amount: /^(?:VALOR|AMOUNT|TRNAMT)$/, debit: /^(?:DEBITO|DEBIT|SAIDA)$/, credit: /^(?:CREDITO|CREDIT|ENTRADA)$/,
  externalId: /^(?:FITID|ID|IDENTIFICADOR)$/, balance: /^(?:SALDO|BALANCE)$/, status: /^(?:STATUS|SITUACAO)$/, installment: /^(?:PARCELA|PARCELAMENTO)$/, originalCurrency: /^(?:MOEDA ORIGINAL|CURRENCY)$/, originalAmount: /^(?:VALOR ORIGINAL|ORIGINAL AMOUNT)$/, documentNumber: /^(?:DOCUMENTO|CHECKNUM|REFNUM)$/
};
export function inspectCsvStatement(bytes: Uint8Array, profile?: StatementCsvProfile): CsvStatementPreview {
  const decoded = decodeStatement(bytes, profile?.encoding ?? 'auto');
  const delimiter = profile?.delimiter && profile.delimiter !== 'auto' ? profile.delimiter : detectedDelimiter(decoded.text);
  const records = csvRecords(decoded.text, delimiter), header = profile?.header ?? true;
  const headers = header ? records[0] ?? [] : (records[0] ?? []).map((_, index) => `Coluna ${index + 1}`);
  const suggestedColumns: Partial<Record<CsvColumn, number>> = {};
  if (header) for (const key of Object.keys(columnAliases) as CsvColumn[]) { const index = headers.findIndex(name => columnAliases[key].test(normalizeStatementDescription(name))); if (index >= 0) suggestedColumns[key] = index; }
  return { encoding: decoded.encoding, delimiter, headers, sample: records.slice(header ? 1 : 0, header ? 6 : 5), suggestedColumns };
}
export function parseCsvStatement(text: string, profile: StatementCsvProfile, generatedOn = todayInSpace()): NormalizedStatement {
  const delimiter = profile.delimiter && profile.delimiter !== 'auto' ? profile.delimiter : detectedDelimiter(text);
  const records = csvRecords(text.replace(/^\uFEFF/, ''), delimiter), header = profile.header ?? true, headings = header ? records.shift() : undefined;
  const columns = profile.columns;
  if (columns.date === undefined || columns.description === undefined || columns.amount === undefined && (columns.debit === undefined || columns.credit === undefined)) throw new Error('Mapeie data, descrição e valor ou débito e crédito.');
  if (records.length > STATEMENT_MAX_ROWS) throw new Error('O extrato pode ter no máximo 10.000 linhas.');
  const value = (row: string[], key: CsvColumn) => columns[key] === undefined ? '' : row[columns[key]!] ?? '';
  let balanceOn: string | undefined, statementBalanceCents: number | undefined;
  const rows = records.map((record, index): StatementImportRow => {
    const description = value(record, 'description'), base = { lineNumber: index + 1, description, externalId: value(record, 'externalId') || undefined, documentNumber: value(record, 'documentNumber') || undefined, ...statementInstallment(value(record, 'installment') || description) };
    if (headings && headings.every((cell, column) => cell === record[column]) || nonMovement(description)) return { ...base, postedOn: null, amountCents: null, status: 'informational' };
    try {
      const postedOn = parseStatementDate(value(record, 'date')); let amountCents: number;
      if (columns.amount !== undefined) amountCents = parseStatementCents(value(record, 'amount'), profile.decimalSeparator);
      else { const debit = Math.abs(parseStatementCents(value(record, 'debit') || '0', profile.decimalSeparator)), credit = Math.abs(parseStatementCents(value(record, 'credit') || '0', profile.decimalSeparator)); if (debit && credit) throw new Error('Linha tem débito e crédito ao mesmo tempo.'); amountCents = credit - debit; }
      amountCents = assertCents(amountCents * (profile.inverseSigns ? -1 : 1)); if (!amountCents) throw new Error('Movimento sem valor.');
      if (value(record, 'balance') && (!balanceOn || postedOn >= balanceOn)) { statementBalanceCents = parseStatementCents(value(record, 'balance'), profile.decimalSeparator); balanceOn = postedOn; }
      const originalCurrency = value(record, 'originalCurrency') || undefined;
      const originalAmountCents = value(record, 'originalAmount') ? parseStatementCents(value(record, 'originalAmount'), profile.decimalSeparator) : undefined;
      return { ...base, postedOn, amountCents, originalCurrency, originalAmountCents, status: /PEND|PROCESS|AUTORIZ/i.test(value(record, 'status')) || postedOn > generatedOn ? 'pending' : 'posted' };
    } catch (error) { return { ...base, postedOn: null, amountCents: null, status: 'invalid', error: error instanceof Error ? error.message : 'Linha ilegível.' }; }
  });
  const dates = rows.flatMap(row => row.postedOn ? [row.postedOn] : []).sort();
  return { accountType: 'bank', periodStart: dates[0] ?? null, periodEnd: dates.at(-1) ?? null, generatedOn, rows, balanceOn, statementBalanceCents };
}
export async function parseStatementFile(bytes: Uint8Array, options: StatementParseOptions): Promise<StatementImportPayload> {
  const decoded = decodeStatement(bytes, options.profile?.encoding ?? 'auto');
  const format = /<OFX(?:\s[^>]*)?>/i.test(decoded.text) ? 'ofx' : 'csv';
  const generatedOn = options.generatedOn ?? todayInSpace(options.timeZone);
  let normalized: NormalizedStatement;
  if (format === 'ofx') normalized = parseOfxStatement(decoded.text, { timeZone: options.timeZone, generatedOn: options.generatedOn, inverseSigns: options.inverseSigns ?? options.profile?.inverseSigns });
  else { if (!options.profile) throw new Error('Confirme o mapeamento das colunas do CSV antes de importar.'); normalized = parseCsvStatement(decoded.text, options.profile, generatedOn); }
  let binary = ''; for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  const hashBytes = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  const fileSha256 = [...new Uint8Array(hashBytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { ...normalized, format, fileName: options.fileName, fileSha256, fileBytesBase64: btoa(binary), profile: format === 'csv' ? { ...options.profile!, encoding: decoded.encoding as StatementCsvProfile['encoding'] } : undefined };
}
