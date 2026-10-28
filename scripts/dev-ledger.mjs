import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import assert from 'node:assert/strict';

const status = JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command','npx supabase status -o json 2>$null'],{ encoding:'utf8',windowsHide:true }));
assert.equal(new URL(status.API_URL).hostname,'127.0.0.1','This launcher only supports local Supabase');
process.env.VITE_SUPABASE_URL = status.API_URL;
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.VITE_FINANCIAL_MODEL = 'ledger';
const server = await createServer({ configFile:'vite.pwa.config.ts',server:{ host:'127.0.0.1',port:4179,strictPort:true } });
await server.listen();
console.log('Novo modelo local: http://127.0.0.1:4179/financias/');
console.log('Use uma conta do Supabase local. Este ambiente não contém os dados de produção.');
process.on('SIGINT',async () => { await server.close(); process.exit(0); });
process.on('SIGTERM',async () => { await server.close(); process.exit(0); });
