import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const source = await readFile(new URL('./index.ts',import.meta.url),'utf8');
const code = ts.transpileModule(source,{ compilerOptions:{ target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None } }).outputText;
const env = new Map();
let handler,requests = [],failure = false;
runInNewContext(code,{ Deno:{ env:{ get:key => env.get(key) },serve:callback => { handler = callback; } },crypto:webcrypto,TextEncoder,Response,Request,AbortSignal,
  fetch:async (url,options) => { requests.push({ url,options }); return failure ? new Response('internal error',{ status:500 }) : Response.json({ notifications:'refreshed' }); }
});
const request = (method = 'POST',secret) => new Request('https://test.local/maintenance',{ method,headers:secret ? { 'x-maintenance-secret':secret } : {} });
assert.equal((await handler(request('GET'))).status,405);
assert.equal((await handler(request())).status,503);
env.set('DAILY_MAINTENANCE_SECRET','short'); env.set('SUPABASE_SERVICE_ROLE_KEY','server-test-key'); env.set('SUPABASE_URL','https://supabase.test/');
assert.equal((await handler(request())).status,503);
env.set('DAILY_MAINTENANCE_SECRET','test-secret-at-least-thirty-two-characters');
assert.equal((await handler(request())).status,401);
assert.equal((await handler(request('POST','wrong-secret'))).status,401);
assert.equal(requests.length,0,'Unauthorized requests never contact privileged RPC');
const response = await handler(request('POST',env.get('DAILY_MAINTENANCE_SECRET')));
assert.equal(response.status,200);
assert.deepEqual(await response.json(),{ result:{ notifications:'refreshed' } });
assert.equal(requests[0].url,'https://supabase.test/rest/v1/rpc/job_daily_maintenance');
assert.equal(requests[0].options.headers['Content-Profile'],'api');
assert.equal(requests[0].options.headers.Authorization,'Bearer server-test-key');
failure = true;
const failed = await handler(request('POST',env.get('DAILY_MAINTENANCE_SECRET')));
assert.equal(failed.status,502);
assert.deepEqual(await failed.json(),{ error:'Daily maintenance failed',status:500 });
console.log('Daily maintenance endpoint: authorization, configuration, privileged RPC and error handling checks passed.');
