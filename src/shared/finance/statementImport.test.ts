import { describe, expect, it } from 'vitest';
import { inspectCsvStatement, normalizeStatementDescription, parseCsvStatement, parseOfxDate, parseOfxStatement, parseStatementCents, parseStatementDate, parseStatementFile, statementInstallment, STATEMENT_MAX_BYTES, STATEMENT_MAX_ROWS, type StatementCsvProfile } from './statementImport';

const profile: StatementCsvProfile = { delimiter: ';', header: true, columns: { date: 0, description: 1, amount: 2 } };
const csv = 'Data;Descrição;Valor\r\n05/10/2026;CAFE;-8,50\r\n05/10/2026;CAFE PADARIA;-8,50';
const ofx = (transactions: string, card = false) => `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n<OFX><SIGNONMSGSRSV1><SONRS><DTSERVER>20261007120000[-3:BRT]</SONRS></SIGNONMSGSRSV1><${card ? 'CCSTMTRS' : 'STMTRS'}><CURDEF>BRL<${card ? 'CCACCTFROM' : 'BANKACCTFROM'}><BANKID>077<ACCTID>0123456789</${card ? 'CCACCTFROM' : 'BANKACCTFROM'}><BANKTRANLIST><DTSTART>20261001000000<DTEND>20261007235959${transactions}</BANKTRANLIST><LEDGERBAL><BALAMT>983.00<DTASOF>20261007120000[-3:BRT]</LEDGERBAL><AVAILBAL><BALAMT>99999.00<DTASOF>20261007</AVAILBAL></${card ? 'CCSTMTRS' : 'STMTRS'}></OFX>`;
const transaction = '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261005090000[-3:BRT]<TRNAMT>-8.50<FITID>coffee-1<NAME>CAFÉ<MEMO>PADARIA &amp; CIA<CHECKNUM>ABC</STMTTRN>';

describe('statement money and dates', () => {
  it.each([['19,90', 1990], ['19.90', 1990], ['1.234,5', 123450], ['1,234.50', 123450], ['0,07', 7], ['-8,50', -850], ['(8.50)', -850], ['R$ +12,00', 1200], ['1.234', 123400], ['1,234', 123400]])('parses %s using integer cents', (text, cents) => expect(parseStatementCents(text)).toBe(cents));
  it('refuses excess decimals rather than rounding and enforces safe integer cents', () => {
    expect(() => parseStatementCents('19.999', '.')).toThrow();
    expect(() => parseStatementCents('19,999', ',')).toThrow();
    expect(() => parseStatementCents('90071992547409.92', '.')).toThrow();
    expect(() => parseStatementCents('1,2,3')).toThrow();
  });
  it('supports written dates with two-digit years and refuses calendar overflow', () => {
    expect(parseStatementDate('05/10/2026')).toBe('2026-10-05');
    expect(parseStatementDate('05/10/26')).toBe('2026-10-05');
    expect(parseStatementDate('2026-10-05')).toBe('2026-10-05');
    expect(() => parseStatementDate('31/02/2026')).toThrow();
  });
  it('converts explicit OFX offsets to the space timezone before selecting the day', () => {
    expect(parseOfxDate('20261005010000[0:GMT]', 'America/Sao_Paulo')).toBe('2026-10-04');
    expect(parseOfxDate('20261005010000')).toBe('2026-10-05');
    expect(parseOfxDate('20261005010000[-3:BRT]', 'Asia/Tokyo')).toBe('2026-10-05');
    expect(() => parseOfxDate('20260231')).toThrow();
    expect(() => parseOfxDate('20261005250000[-3]')).toThrow();
  });
  it('normalizes matching descriptions without using them as identity', () => {
    expect(normalizeStatementDescription('PIX Café São João 123456789')).toBe('CAFE SAO JOAO');
    expect(normalizeStatementDescription('PAG*Padaria')).toBe('PADARIA');
    expect(statementInstallment('LOJA TV PARC 03/12')).toEqual({ installmentNumber: 3, installmentCount: 12 });
    expect(statementInstallment('PARCELA 3 DE 12')).toEqual({ installmentNumber: 3, installmentCount: 12 });
    expect(statementInstallment('Compra em 05/10/2026')).toBeUndefined();
  });
});

describe('CSV reading and preview', () => {
  it('preserves identical coffee multiplicity and changed descriptions', () => {
    const result = parseCsvStatement(csv, profile, '2026-10-10');
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(row => row.amountCents)).toEqual([-850, -850]);
    expect(result.rows.map(row => row.status)).toEqual(['posted', 'posted']);
    expect(result.periodStart).toBe('2026-10-05');
  });
  it('decodes BOM and detects semicolon, comma and tab outside quoted fields', () => {
    const bytes = new TextEncoder().encode(`\uFEFF${csv}`);
    const preview = inspectCsvStatement(bytes);
    expect(preview.delimiter).toBe(';');
    expect(preview.encoding).toBe('utf-8');
    expect(preview.suggestedColumns).toEqual({ date: 0, description: 1, amount: 2 });
    expect(inspectCsvStatement(new TextEncoder().encode('Date,Description,Amount\n2026-10-05,"SHOP, CAFE",-8.50')).delimiter).toBe(',');
    expect(inspectCsvStatement(new TextEncoder().encode('Data\tDescrição\tValor\n05/10/2026\tCAFE\t-8,50')).delimiter).toBe('\t');
  });
  it('detects Windows-1252 and permits an explicit encoding override', () => {
    const bytes = Uint8Array.from([...new TextEncoder().encode('Data;Descri'), 0xe7, 0xe3, ...new TextEncoder().encode('o;Valor\n05/10/2026;CAF'), 0xc9, ...new TextEncoder().encode(';-8,50')]);
    const preview = inspectCsvStatement(bytes);
    expect(preview.encoding).toBe('windows-1252');
    expect(preview.headers[1]).toBe('Descrição');
    expect(preview.sample[0][1]).toBe('CAFÉ');
    expect(inspectCsvStatement(bytes, { ...profile, encoding: 'iso-8859-1' }).sample[0][1]).toBe('CAFÉ');
  });
  it('handles escaped quotes, embedded delimiters and quoted line breaks', () => {
    const result = parseCsvStatement('Data;Descrição;Valor\n05/10/2026;"CAFE; ""PADARIA""\nCENTRO";-8,50', profile, '2026-10-10');
    expect(result.rows[0].description).toBe('CAFE; "PADARIA"\nCENTRO');
    expect(result.rows[0].amountCents).toBe(-850);
  });
  it('supports debit/credit columns, reversed signs and balance from the newest date', () => {
    const result = parseCsvStatement('Data;Descrição;Débito;Crédito;Saldo\n06/10/2026;CAFE;8,50;;991,50\n05/10/2026;SALARIO;;100,00;1000,00\n06/10/2026;CAFE 2;8,50;;983,00', { ...profile, columns: { date: 0, description: 1, debit: 2, credit: 3, balance: 4 } }, '2026-10-10');
    expect(result.rows.map(row => row.amountCents)).toEqual([-850, 10000, -850]);
    expect(result.statementBalanceCents).toBe(98300);
    expect(result.balanceOn).toBe('2026-10-06');
    expect(parseCsvStatement(csv, { ...profile, inverseSigns: true }, '2026-10-10').rows[0].amountCents).toBe(850);
  });
  it('keeps informational, repeated headers, pending, future and malformed rows out of posted facts', () => {
    const result = parseCsvStatement('Data;Descrição;Valor;Situação\n;SALDO ANTERIOR;100,00;\nData;Descrição;Valor;Situação\n05/10/2026;CAFE;-8,50;Pendente\n11/10/2026;FUTURO;-8,50;\n31/02/2026;ERRO;-8,50;\n05/10/2026;ERRO VALOR;8,999;', { ...profile, decimalSeparator: ',', columns: { ...profile.columns, status: 3 } }, '2026-10-10');
    expect(result.rows.map(row => row.status)).toEqual(['informational', 'informational', 'pending', 'pending', 'invalid', 'invalid']);
    expect(result.rows[4].error).toBeTruthy();
  });
  it('requires a valid mapping and refuses unclosed CSV quotes', () => {
    expect(() => parseCsvStatement(csv, { columns: {} })).toThrow('Mapeie');
    expect(() => parseCsvStatement('Data;Descrição;Valor\n05/10/2026;"CAFE;-8,50', profile)).toThrow('aspas');
  });
  it('supports a headerless saved profile', () => {
    expect(parseCsvStatement('05/10/26;CAFE;-8,50', { ...profile, header: false }, '2026-10-10').rows[0].amountCents).toBe(-850);
  });
});

describe('OFX SGML/XML and file payload', () => {
  it('reads OFX1 fields and uses LEDGERBAL instead of AVAILBAL', () => {
    const result = parseOfxStatement(ofx(transaction));
    expect(result.accountType).toBe('bank');
    expect(result.rows[0]).toMatchObject({ postedOn: '2026-10-05', amountCents: -850, description: 'CAFÉ · PADARIA & CIA', externalId: 'coffee-1', documentNumber: 'ABC', status: 'posted' });
    expect(result.statementBalanceCents).toBe(98300);
    expect(result.externalAccountIdentity).toBe('0123456789');
  });
  it('reads OFX2 XML card signs and structured installments', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><OFX><CREDITCARDMSGSRSV1><CCSTMTRS><CURDEF>BRL</CURDEF><BANKTRANLIST><STMTTRN><DTPOSTED>20261005</DTPOSTED><TRNAMT>100.00</TRNAMT><FITID>p3</FITID><MEMO>LOJA TV PARC 03/12</MEMO></STMTTRN></BANKTRANLIST></CCSTMTRS></CREDITCARDMSGSRSV1></OFX>';
    const result = parseOfxStatement(xml, { generatedOn: '2026-10-10', inverseSigns: true });
    expect(result.accountType).toBe('card');
    expect(result.rows[0]).toMatchObject({ amountCents: -10000, installmentNumber: 3, installmentCount: 12, externalId: 'p3' });
  });
  it('keeps pending OFX rows and malformed amounts available for review', () => {
    const result = parseOfxStatement(ofx('<STMTTRNP><DTTRAN>20261006<TRNAMT>-500.00<NAME>HOTEL</STMTTRNP><STMTTRN><DTPOSTED>20261009<TRNAMT>-437.80<NAME>HOTEL</STMTTRN><STMTTRN><DTPOSTED>20261005<TRNAMT>1.001<NAME>ERROR</STMTTRN>'));
    expect(result.rows.map(row => row.status)).toEqual(['pending', 'pending', 'invalid']);
  });
  it('rejects unsupported base currency and an unrelated document', () => {
    expect(() => parseOfxStatement(ofx(transaction).replace('BRL', 'USD'))).toThrow('BRL');
    expect(() => parseOfxStatement('<html>bank</html>')).toThrow('OFX');
  });
  it('hashes exact original bytes and supplies the normalized camelCase RPC contract', async () => {
    const bytes = new TextEncoder().encode(csv), result = await parseStatementFile(bytes, { fileName: 'cafes.csv', profile, generatedOn: '2026-10-10' });
    expect(result.fileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(atob(result.fileBytesBase64)).toBe(String.fromCharCode(...bytes));
    expect(result.profile?.encoding).toBe('utf-8');
    expect(result.rows).toHaveLength(2);
    await expect(parseStatementFile(bytes, { fileName: 'cafes.csv' })).rejects.toThrow('mapeamento');
  });
  it('enforces original bytes and maximum candidate count', async () => {
    await expect(parseStatementFile(new Uint8Array(STATEMENT_MAX_BYTES + 1), { fileName: 'large.csv', profile })).rejects.toThrow('10 MB');
    const rows = Array.from({ length: STATEMENT_MAX_ROWS + 1 }, () => '05/10/2026;CAFE;-8,50').join('\n');
    expect(() => parseCsvStatement(`Data;Descrição;Valor\n${rows}`, profile, '2026-10-10')).toThrow('10.000');
  });
});
