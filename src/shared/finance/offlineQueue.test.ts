import { describe,expect,it } from 'vitest';
import { failureKind,flushQuickEntries,quickEntryRequest,retryDelay,validateQuickEntry,type QueueItem,type QueueStore } from './offlineQueue';

const make = (id: string): QueueItem => ({ clientUuid:id,userId:'u',spaceId:'s',createdAt:`2026-10-02T12:40:0${id}Z`,state:'pending',attempts:0,nextAttemptAt:null,lastReason:null,content:{ kind:'expense',amountCents:4500,description:'Almoço',occurredOn:'2026-10-02',categoryId:'rest',categoryLedgerId:'r',accountId:'wallet',accountLedgerId:'w' } });
function memory(rows: QueueItem[]): QueueStore & { rows: Map<string,QueueItem> } {
  const values = new Map(rows.map(row => [row.clientUuid,row]));
  return { rows:values,list:async user => [...values.values()].filter(row => row.userId===user),put:async row => { values.set(row.clientUuid,row); },remove:async row => { values.delete(row.clientUuid); } };
}
describe('fila de lançamentos rápidos',() => {
  it('CT-SYNC-001 conserva UUID e conteúdo quando a resposta se perde',async () => {
    const store = memory([make('1')]),requests: unknown[] = [],server = new Map<string,unknown>();
    const first = new Date('2026-10-02T12:40:00Z');
    await flushQuickEntries(store,'u',async item => { const request = quickEntryRequest(item); requests.push(request); server.set(item.clientUuid,request); return { message:'Resposta perdida' }; },first);
    expect(store.rows.get('1')?.state).toBe('pending');
    await flushQuickEntries(store,'u',async item => { requests.push(quickEntryRequest(item)); expect(quickEntryRequest(item)).toEqual(server.get(item.clientUuid)); return null; },new Date(first.getTime()+5000));
    expect(requests[0]).toEqual(requests[1]); expect(server.size).toBe(1); expect(store.rows.size).toBe(0);
  });
  it('não envia outro usuário e continua após recusa por mês fechado',async () => {
    const store = memory([make('2'),make('1'),{ ...make('3'),userId:'outro' }]),order: string[] = [];
    const result = await flushQuickEntries(store,'u',async item => { order.push(item.clientUuid); return item.clientUuid==='1' ? { code:'23514',message:'Mês fechado' } : null; },new Date('2026-10-02T13:00:00Z'));
    expect(order).toEqual(['1','2']); expect(result).toEqual({ sent:1,rejected:1,waitingForLogin:false }); expect(store.rows.get('1')?.lastReason).toBe('Mês fechado'); expect(store.rows.has('3')).toBe(true);
  });
  it('sessão expirada conserva os registros até o próximo login',async () => {
    const store = memory([make('1'),make('2')]);
    expect((await flushQuickEntries(store,'u',async () => ({ status:401,message:'Sessão expirada' }))).waitingForLogin).toBe(true);
    expect(store.rows.get('1')?.state).toBe('pending'); expect(store.rows.get('2')?.attempts).toBe(0);
  });
  it('aguarda retry e limita o intervalo em cinco minutos',async () => {
    const store = memory([{ ...make('1'),nextAttemptAt:'2026-10-03T00:00:00Z' }]);
    expect((await flushQuickEntries(store,'u',async () => null,new Date('2026-10-02T20:00:00Z'))).sent).toBe(0);
    expect(retryDelay(50)).toBe(300000); expect(retryDelay(1)).toBe(5000);
  });
  it('conflito permanece para revisão; acesso revogado não vira retry infinito',() => {
    expect(failureKind({ code:'23505',message:'UUID conflitante' })).toBe('rejected');
    expect(failureKind({ code:'42501',message:'Acesso removido' })).toBe('rejected');
    expect(failureKind({ status:503,code:'PGRST000',message:'Indisponível' })).toBe('temporary');
  });
  it('fatura da compra em uma vez é definida pelo servidor',() => {
    const item = { ...make('1'),content:{ ...make('1').content,kind:'card_purchase' as const,cardId:'card' } };
    expect(quickEntryRequest(item).args).toMatchObject({ p_client_uuid:'1',p_installments:1,p_on:'2026-10-02' });
    expect(quickEntryRequest(item).args).not.toHaveProperty('p_statement');
  });
  it('não aceita valores fracionados, datas inexistentes ou conta ausente',() => {
    for (const change of [{ amountCents:4.5 },{ amountCents:0 },{ occurredOn:'2026-02-30' },{ accountLedgerId:undefined }]) expect(() => validateQuickEntry({ ...make('1').content,...change })).toThrow();
  });
});
